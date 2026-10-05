// Only session-owned context is trusted; pins, board owners and public profiles are not.
export function pinterestSessionFromPayload(payloads) {
  const identities = new Set();
  let signedOut = false;
  for (const data of Array.isArray(payloads) ? payloads : [payloads]) {
    if (!data || typeof data !== 'object') continue;
    const roots = [data, data.props, data.props?.pageProps].filter(Boolean);
    for (const root of roots) {
      const redux = root.initialReduxState;
      const contexts = [redux?.context, root.context, root.client_context].filter(Boolean);
      for (const context of contexts) {
        const flags = [context.isAuth, context.isAuthenticated, context.is_authenticated];
        if (flags.includes(false)) { signedOut = true; continue; }
        if (!flags.includes(true)) continue;
        const userId = typeof context.user === 'string' || typeof context.user === 'number'
          ? context.user : context.user?.id ?? context.userId ?? context.user_id;
        const user = typeof context.user === 'object' ? context.user : null;
        const stored = userId ? redux?.users?.[userId] ?? redux?.entities?.users?.[userId] : null;
        const username = user?.username || stored?.username;
        if (typeof username === 'string' && /^[\w.-]{1,100}$/.test(username)) identities.add(username);
      }
    }
  }
  if (identities.size === 1 && !signedOut) return { authenticated: true, username: [...identities][0] };
  return { authenticated: false, status: signedOut && !identities.size ? 'signed-out' : 'unknown' };
}

export function pinterestSessionFromHtml(html) {
  const payloads = [];
  for (const match of String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bid\s*=\s*["'](?:__PWS_DATA__|__PWS_INITIAL_PROPS__|__NEXT_DATA__)["']/i.test(match[1])) continue;
    try { payloads.push(JSON.parse(match[2])); } catch { /* Not a JSON state script. */ }
  }
  return pinterestSessionFromPayload(payloads);
}

// Read only the session context; response data may describe someone else's boards.
export async function probePinterestAccount({ cookieText, request, userAgent, signal }) {
  let url = new URL('https://www.pinterest.com/');
  for (let redirects = 0; redirects <= 3; redirects++) {
    const cookie = pinterestCookieHeaderForHost(cookieText, url.hostname);
    if (!/(?:^|; )_pinterest_sess=[^;]+/.test(cookie)) return { authenticated: false, status: 'signed-out' };
    const headers = { Cookie: cookie, 'User-Agent': userAgent, Accept: 'text/html', 'Accept-Encoding': 'identity' };
    const response = await request({ hostname: url.hostname, path: url.pathname + url.search, headers, signal });
    if (response.statusCode >= 300 && response.statusCode < 400 && response.location) {
      const next = pinterestRedirect(response.location, url);
      if (!next) break;
      url = next; continue;
    }
    if (response.statusCode !== 200) return pinterestHttpStatus(response.statusCode);
    const session = pinterestSessionFromHtml(response.body);
    if (session.authenticated || session.status === 'signed-out') return session;
    const query = new URLSearchParams({ source_url: '/', data: JSON.stringify({
      options: { filter: 'all', field_set_key: 'board_picker', allow_stale: true, from: 'app' }, context: {},
    }) });
    const fallback = await request({ hostname: url.hostname,
      path: `/resource/BoardPickerBoardsResource/get/?${query}`, signal,
      headers: { ...headers, Accept: 'application/json', Referer: url.origin + '/',
        'X-Requested-With': 'XMLHttpRequest', 'X-Pinterest-AppState': 'active' },
    });
    if (fallback.statusCode !== 200) return pinterestHttpStatus(fallback.statusCode);
    try { return pinterestSessionFromPayload(JSON.parse(fallback.body)); }
    catch { return { authenticated: false, status: 'unknown' }; }
  }
  return { authenticated: false, status: 'unknown' };
}

function pinterestHttpStatus(code) {
  return { authenticated: false, status: code === 401 ? 'signed-out'
    : code === 403 ? 'access-denied' : code === 429 ? 'rate-limited' : 'network-error' };
}

export function pinterestCookieHeaderForHost(text, hostname, now = Date.now()) {
  if (!(hostname === 'pinterest.com' || hostname.endsWith('.pinterest.com'))) return '';
  const values = [];
  for (let line of String(text).split(/\r?\n/)) {
    if (line.startsWith('#HttpOnly_')) line = line.slice(10);
    else if (line.startsWith('#')) continue;
    const [domain, includeSubdomains, path, secure, expires, name, value] = line.split('\t');
    if (!domain || !name || value === undefined || /[\r\n;]/.test(name + value)) continue;
    const host = domain.replace(/^\./, '').toLowerCase();
    if (!(host === 'pinterest.com' || host.endsWith('.pinterest.com'))) continue;
    if (hostname !== host && !(includeSubdomains === 'TRUE' && hostname.endsWith('.' + host))) continue;
    if (Number(expires) > 0 && Number(expires) * 1000 <= now) continue;
    if (path && path !== '/') continue;
    values.push(`${name}=${value}`);
  }
  return values.join('; ');
}
export function pinterestRedirect(location, current) {
  let next;
  try { next = new URL(location, current); } catch { return null; }
  if (next.protocol !== 'https:' || next.username || next.password || (next.port && next.port !== '443')) return null;
  if (!(next.hostname === 'pinterest.com' || next.hostname.endsWith('.pinterest.com'))) return null;
  return next;
}
