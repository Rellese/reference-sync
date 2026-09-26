// Behance's public-page check sets one literal cookie then reloads. Never eval
// page scripts. Keep the browser snapshot and challenge cookie local to one job.
import { nodeApi } from '../node-bridge.js';
import { runGallery } from '../toolchain.js';
import { browserCookieSpecForProfile } from '../browser-profiles.js';
import { throwIfAborted, makeStopError } from '../job-control.js';

export const BEHANCE_USER_AGENT = 'Mozilla/5.0';
const failure = () => new Error('Behance не разрешил получить данные проекта. Проверьте доступ в выбранном браузере и повторите поиск.');

export function behanceChallengeCookie(html) {
  const match = String(html).match(/document\.cookie\s*=\s*"js_challenge_value=([a-f0-9]{32,512}); Path=\/"\s*;/);
  return match?.[1] || '';
}

export function behanceCookieText(text, token = '') {
  const lines = String(text).split(/\r?\n/).filter(line => {
    const fields = line.replace(/^#HttpOnly_/, '').split('\t');
    const host = fields[0].replace(/^\./, '').toLowerCase();
    return fields.length === 7 && (host === 'behance.net' || host.endsWith('.behance.net')) &&
      (!token || fields[5] !== 'js_challenge_value');
  });
  if (token) lines.push(`www.behance.net\tFALSE\t/\tTRUE\t0\tjs_challenge_value\t${token}`);
  return '# Netscape HTTP Cookie File\n' + lines.join('\n') + '\n';
}

async function challengeFor(url, signal, redirects = 0) {
  throwIfAborted(signal);
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.behance.net' || parsed.port || parsed.username || parsed.password) throw failure();
  return new Promise((resolve, reject) => {
    let request;
    const abort = () => request?.destroy(makeStopError());
    const timer = setTimeout(() => request?.destroy(new Error('ETIMEDOUT')), 30000);
    const finish = (error, token) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(token);
    };
    request = nodeApi.https.get(url, {headers:{'User-Agent':BEHANCE_USER_AGENT}}, response => {
      response.on('error', error => finish(error));
      if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location && redirects < 3) {
        response.resume();
        try { finish(null, challengeFor(new URL(response.headers.location, url).href, signal, redirects + 1)); }
        catch (error) { finish(error); }
        return;
      }
      if (response.statusCode === 200) { response.resume(); finish(null, ''); return; }
      if (response.statusCode !== 403) { response.resume(); finish(failure()); return; }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 16384) request.destroy(failure());
      });
      response.on('end', () => {
        const token = behanceChallengeCookie(body);
        finish(token ? null : failure(), token);
      });
    });
    request.on('error', error => finish(error));
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) abort();
  });
}

export async function withBehanceSession(options, url, action) {
  throwIfAborted(options.signal);
  const {fs,path,os} = nodeApi;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-sync-behance-'));
  const cookieFile = path.join(directory, 'cookies.txt');
  try {
    if (options.cookieFile) fs.copyFileSync(options.cookieFile, cookieFile);
    else {
      const result = await runGallery(['--config-ignore','--no-input','--cookies-from-browser',
        browserCookieSpecForProfile(options.browser || 'chrome', options.browserProfile || ''),
        '--cookies-export',cookieFile,'--no-download','http://0/file.jpg'],
      {signal:options.signal,timeout:45000});
      if (result.code !== 0 || !fs.existsSync(cookieFile)) throw failure();
    }
    fs.chmodSync(cookieFile, 0o600);
    const scoped = behanceCookieText(fs.readFileSync(cookieFile, 'utf8'));
    fs.writeFileSync(cookieFile, scoped);
    const token = await challengeFor(url, options.signal);
    throwIfAborted(options.signal);
    fs.writeFileSync(cookieFile, behanceCookieText(scoped, token));
    return await action({...options,cookieFile});
  } finally {
    fs.rmSync(directory, {recursive:true,force:true});
  }
}
