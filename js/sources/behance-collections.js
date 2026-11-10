import { nodeApi } from '../node-bridge.js';
import { assertMatchingAccount } from '../session-account.js';
import { throwIfAborted, makeStopError } from '../job-control.js';
import { BEHANCE_USER_AGENT, withBehanceSession } from './behance-session.js';

export function parseBehancePage(html) {
  const match = String(html).match(/<script\b[^>]*\bid=["']beconfig-store_state["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('Не удалось прочитать список досок Behance.');
  return JSON.parse(match[1]);
}

// Only send this snapshot to Behance, respecting cookie host/path/expiry.
function cookieHeader(file, url) {
  return nodeApi.fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap(line => {
    const f = line.replace(/^#HttpOnly_/, '').split('\t');
    if (f.length !== 7) return [];
    const host = f[0].replace(/^\./, '').toLowerCase();
    if (url.hostname !== host && !(f[1] === 'TRUE' && url.hostname.endsWith('.' + host))) return [];
    if (!url.pathname.startsWith(f[2]) || (+f[4] && +f[4] < Date.now() / 1000)) return [];
    return [`${f[5]}=${f[6]}`];
  }).join('; ');
}

export async function readBehancePage(url, { cookieFile, signal, json }, redirects = 0) {
  throwIfAborted(signal);
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.hostname !== 'www.behance.net' || target.port || target.username || target.password) throw new Error('Недопустимый адрес Behance.');
  return new Promise((resolve, reject) => {
    let request;
    const abort = () => request?.destroy(makeStopError());
    let timer;
    const finish = (error, value) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    request = nodeApi.https.request({hostname:target.hostname, path:target.pathname + target.search, protocol:'https:', method:json ? 'POST' : 'GET', headers: {
      'User-Agent': BEHANCE_USER_AGENT, Cookie: cookieHeader(cookieFile, target),
      'Accept-Encoding': 'identity',
      ...(json ? {'Content-Type':'application/json', 'X-Requested-With':'XMLHttpRequest', 'X-BCP': cookieHeader(cookieFile, target).match(/(?:^|; )bcp=([^;]+)/)?.[1] || ''} : {}),
    } }, response => {
      response.on('error', error => finish(error));
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirects < 3) {
        response.resume();
        finish(null, readBehancePage(new URL(response.headers.location, target).href, {cookieFile, signal}, redirects + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume(); finish(new Error(`Behance: HTTP ${response.statusCode}`)); return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 16 * 1024 * 1024) request.destroy(new Error('Ответ Behance слишком большой.'));
      });
      response.on('end', () => finish(null, body));
    });
    timer = setTimeout(() => request?.destroy(new Error('ETIMEDOUT')), 30000);
    request.on('error', error => finish(error));
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) abort();
    else request.end(json ? JSON.stringify(json) : undefined);
  });
}

export async function collectBehanceBoards(options, read = readBehancePage) {
  const home = parseBehancePage(await read('https://www.behance.net/', options));
  const actual = home.user?.loggedInUser;
  assertMatchingAccount({username: actual?.username, authenticated: !!actual?.username, status: actual ? 'unknown' : 'signed-out'},
    {platform:'behance', title:'Behance', browser:options.browser});
  // Display names may contain spaces. Only the authenticated account's URL slug
  // is used; an old/manual username setting never selects someone else's boards.
  const username = String(actual.username);
  const base = `https://www.behance.net/${encodeURIComponent(username)}`;
  const initial = await read(`${base}/moodboards`, options);
  const data = initial.trim().startsWith('{') ? JSON.parse(initial) : parseBehancePage(initial);
  assertMatchingAccount({username:data.user?.loggedInUser?.username, authenticated:!!data.user?.loggedInUser?.username,
    status:data.user?.loggedInUser ? 'unknown':'signed-out'}, {platform:'behance',title:'Behance',username});
  let page = data.profile?.activeSection?.collections;
  const boards = new Map();
  const cursors = new Set();
  while (page) {
    throwIfAborted(options.signal);
    if (!Array.isArray(page.collections) || typeof page.hasMore !== 'boolean') throw new Error('Не удалось прочитать список досок Behance.');
    const before = boards.size;
    for (const board of page.collections) {
      const id = String(board.id || '');
      if (!/^\d+$/.test(id)) continue;
      boards.set(id, {id, name: board.label || board.title || `Behance ${id}`, type:'COLLECTION', parentId:'',
        url:`https://www.behance.net/collection/${id}/a`});
    }
    if (!page.hasMore) return [...boards.values()];
    if (boards.size === before) throw new Error('Behance повторил страницу досок. Повторите поиск.');
    const cursor = page.endCursor;
    if (!cursor || cursors.has(cursor)) throw new Error('Behance повторил страницу досок. Повторите поиск.');
    cursors.add(cursor);
    // Current Collections.vue uses user.moodboards(after: endCursor).
    const next = JSON.parse(await read('https://www.behance.net/v3/graphql', {...options, json:{
      query:'query ProfileMoodboardsByUsername($username: String, $first: Int, $after: String) { user(username: $username) { moodboards(first: $first, after: $after) { nodes { id label url } pageInfo { hasNextPage endCursor } } } }',
      variables:{username, first:24, after:cursor},
    }}));
    const connection = next.data?.user?.moodboards;
    if (next.errors || !connection) throw new Error('Не удалось прочитать список досок Behance.');
    page = {collections:connection.nodes, hasMore:connection.pageInfo?.hasNextPage, endCursor:connection.pageInfo?.endCursor};
  }
  throw new Error('Не удалось прочитать список досок Behance.');
}

export function listBehanceCollections(options) {
  return withBehanceSession(options, 'https://www.behance.net/', next => collectBehanceBoards(next));
}
