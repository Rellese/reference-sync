import { pacingMilliseconds, waitForPacing } from './request-pacing.js';
import { nodeApi } from './node-bridge.js';
import { throwIfAborted } from './job-control.js';

// Signed CDN URLs do not need the browser's cookies. Never forward cookies across redirects.
export async function downloadMedia(url, destination, { signal, agent, redirects = 5 } = {}) {
  throwIfAborted(signal);
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('MEDIA_HTTPS_REQUIRED');
  const partial = destination + '.part';
  const { fs, https } = nodeApi;
  try {
    return await new Promise((resolve, reject) => {
      let settled = false, output, activeResponse;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        if (error) {
          activeResponse?.destroy();
          // Await close: unlinking before the asynchronous open can leave a .part behind.
          if (output && !output.closed) {
            output.once('close', () => reject(error));
            output.destroy();
          } else reject(error);
        }
        else resolve(value);
      };
      const request = https.get(parsed, { agent, headers: { 'User-Agent': 'ReferenceSync/1.0.1' } }, response => {
        if (settled) { response.destroy(); return; }
        activeResponse = response;
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          if (!redirects) { finish(new Error('MEDIA_REDIRECT_LIMIT')); return; }
          downloadMedia(new URL(response.headers.location, parsed).href, destination,
            { signal, agent, redirects: redirects - 1 }).then(value => finish(null, value), finish);
          return;
        }
        if (status !== 200) { response.resume(); finish(new Error(`HTTP ${status}`)); return; }
        const mime = String(response.headers['content-type'] || '').toLowerCase();
        if (mime.includes('text/html') || mime.includes('application/json')) {
          response.resume(); finish(new Error('MEDIA_INVALID_CONTENT')); return;
        }
        let bytes = 0;
        output = fs.createWriteStream(partial, { mode: 0o600 });
        response.on('data', chunk => { bytes += chunk.length; });
        nodeApi.stream.pipeline(response, output, error => {
          if (settled) return;
          if (error) { finish(error); return; }
          const expected = Number(response.headers['content-length']);
          if (!bytes || (expected > 0 && bytes !== expected)) { finish(new Error('MEDIA_INCOMPLETE')); return; }
          try { fs.renameSync(partial, destination); finish(null, { bytes }); }
          catch (error) { finish(error); }
        });
      });
      const abort = () => { request.destroy(); finish(Object.assign(new Error('STOPPED'), { code: 'STOPPED' })); };
      request.setTimeout(60000, () => { request.destroy(); finish(new Error('MEDIA_TIMEOUT')); });
      request.on('error', error => finish(error));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  } catch (error) {
    try { fs.unlinkSync(partial); } catch { /* Only our incomplete file is removed. */ }
    throw error;
  }
}

export async function downloadMediaPlan({ plan, postDir, signal, control, profile }) {
  const agent = new nodeApi.https.Agent({ keepAlive: true, maxSockets: 2 });
  try {
    for (const component of plan) {
      throwIfAborted(signal);
      if (control) await control.checkpoint();
      const destination = nodeApi.path.join(postDir, `${component.componentIndex}.${component.extension}`);
      if (nodeApi.fs.existsSync(destination) && nodeApi.fs.statSync(destination).size > 0) continue;
      await waitForPacing(pacingMilliseconds(profile?.sleepRequest), signal);
      if (control) await control.checkpoint();
      await downloadMedia(component.url, destination, { signal, agent });
    }
    return { code: 0, stdout: '', stderr: '' };
  } catch (error) {
    throwIfAborted(signal);
    return { code: 1, stdout: '', stderr: error.message };
  } finally { agent.destroy(); }
}
