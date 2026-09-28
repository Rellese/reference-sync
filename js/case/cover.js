import {nodeApi} from '../node-bridge.js';

const MAX_BYTES = 8 * 1024 * 1024;
export function coverExtension(data) {
  if(data.length >= 8 && data.subarray(0,8).equals(nodeApi.Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if(data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return 'jpg';
  if(/^GIF8[79]a/.test(data.subarray(0,6).toString('ascii'))) return 'gif';
  if(data.length >= 12 && data.toString('ascii',0,4) === 'RIFF' && data.toString('ascii',8,12) === 'WEBP') return 'webp';
  return '';
}
function coverUrl(value) {
  const url = new URL(value);
  if(url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !url.hostname.endsWith('.behance.net')) throw new Error('Invalid Behance cover URL');
  return url;
}
// Only public Behance image hosts; no cookies, local files or arbitrary redirects.
export async function downloadCaseCover(value, {signal, timeout=15000, https=nodeApi.https}={}) {
  const deadline = Date.now() + timeout;
  async function request(value, redirects=0) {
    if(signal?.aborted) throw new Error('CANCELLED');
    const url = coverUrl(value);
    if(redirects > 3 || Date.now() >= deadline) throw new Error('Cover request limit exceeded');
    return new Promise((resolve,reject) => {
      let response, settled=false;
      const finish = (error,result) => {
        if(settled) return; settled=true;
        clearTimeout(timer);signal?.removeEventListener('abort',abort);
        if(error){response?.destroy();req.destroy();reject(error);}else resolve(result);
      };
      const abort = () => finish(new Error('CANCELLED'));
      const req = https.get(url,{headers:{Accept:'image/png,image/jpeg,image/webp,image/gif',Referer:'https://www.behance.net/'}},res => {
        response=res;
        if([301,302,303,307,308].includes(res.statusCode)) {
          const next=res.headers.location;res.destroy();
          if(!next)return finish(new Error('Missing cover redirect'));
          request(new URL(next,url).href,redirects+1).then(result=>finish(null,result),finish);return;
        }
        if(res.statusCode !== 200 || Number(res.headers['content-length']) > MAX_BYTES) return finish(new Error('Cover unavailable'));
        const chunks=[];let bytes=0;
        res.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX_BYTES)finish(new Error('Cover too large'));else chunks.push(chunk);});
        res.on('error',finish);res.on('aborted',()=>finish(new Error('Incomplete cover')));
        res.on('end',()=>{
          const data=nodeApi.Buffer.concat(chunks),extension=coverExtension(data);
          if(!extension)return finish(new Error('Invalid cover image'));
          finish(null,{data,extension});
        });
      });
      const timer=setTimeout(()=>finish(new Error('Cover timeout')),Math.max(1,deadline-Date.now()));
      req.on('error',finish);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    });
  }
  return request(value);
}
