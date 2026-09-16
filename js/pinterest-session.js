// Only session-owned context is trusted; pins, board owners and public profiles are not.
export function pinterestSessionFromHtml(html) {
  const identities = new Set();
  let signedOut = false;
  for (const match of String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bid\s*=\s*["'](?:__PWS_DATA__|__PWS_INITIAL_PROPS__|__NEXT_DATA__)["']/i.test(match[1])) continue;
    let data;
    try { data = JSON.parse(match[2]); } catch { continue; }
    const roots = [data, data.props, data.props?.pageProps].filter(Boolean);
    for (const root of roots) {
      const redux = root.initialReduxState;
      const contexts = [redux?.context, root.context, root.client_context].filter(Boolean);
      for (const context of contexts) {
        const authenticated = context.isAuth ?? context.isAuthenticated;
        if (authenticated === false) { signedOut = true; continue; }
        if (authenticated !== true) continue;
        const userId = typeof context.user === 'string' ? context.user : context.user?.id ?? context.userId ?? context.user_id;
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
