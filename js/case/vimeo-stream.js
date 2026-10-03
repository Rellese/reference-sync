import {nodeApi,runCommand} from '../node-bridge.js';
import {runEnginePython,toolchain} from '../toolchain.js';
import {createPrivateCookieFile,verifyPrivateCookieFile,removePrivateCookieFile} from '../private-cookies.js';
import {makeStopError,throwIfAborted} from '../job-control.js';
import {embeddedVideoTarget,selectVimeoStream} from './vimeo-config.js';
import {captureVimeoConfig,embeddedPlayerAvailable} from './vimeo-player.js';

// A separate Python process receives only the selected CDN manifest/MP4. It
// never re-extracts the Vimeo page or loads browser cookies. All native requests
// and redirects are restricted before transmission to HTTPS Vimeo CDN hosts.
export const VIMEO_STREAM_SCRIPT = `import json,sys,os,urllib.request,urllib.parse
from yt_dlp import YoutubeDL
from yt_dlp.networking._urllib import UrllibRH
from yt_dlp.downloader.external import FFmpegFD
def safe_url(value):
 u=urllib.parse.urlsplit(value)
 if u.scheme!='https' or u.username or u.password or u.port or not (u.hostname=='vimeocdn.com' or (u.hostname or '').endswith('.vimeocdn.com')):raise ValueError('Unsafe stream URL')
class Guard(urllib.request.BaseHandler):
 handler_order=1
 def http_request(self,req):safe_url(req.full_url);return req
 https_request=http_request
class VimeoRH(UrllibRH):
 _SUPPORTED_URL_SCHEMES=('https',)
 def _create_instance(self,**kwargs):
  opener=super()._create_instance(**kwargs);opener.add_handler(Guard());return opener
 def _send(self,request):safe_url(request.url);return super()._send(request)
def no_external_download(*args,**kwargs):raise ValueError('Unsupported stream')
FFmpegFD.real_download=no_external_download
class Quiet:
 def debug(self,*args):pass
 def warning(self,*args):pass
 def error(self,*args):pass
def download():
 c=json.load(open(sys.argv[1],encoding='utf-8'));safe_url(c['url'])
 opts={'outtmpl':os.path.join(sys.argv[2],sys.argv[4]+'.%(ext)s'),'ffmpeg_location':sys.argv[3],
  'http_headers':{'Referer':c['referrer']},'allowed_extractors':['generic'],'cachedir':False,
  'quiet':True,'no_warnings':True,'logger':Quiet(),'retries':0,'extractor_retries':0,'fragment_retries':0,
  'socket_timeout':20,'noplaylist':True,'hls_prefer_native':True,'skip_unavailable_fragments':False,
  'concurrent_fragment_downloads':1,'merge_output_format':'mp4','enable_file_urls':False}
 with YoutubeDL(opts) as ydl:
  ydl._request_director=ydl.build_request_director([VimeoRH])
  info=ydl.extract_info(c['url'],download=True)
 if not info:raise ValueError('No video')
 return {'success':True}
if __name__=='__main__':
 try:print(json.dumps(download()),flush=True)
 except Exception as e:
  print(json.dumps({'success':False,'errorType':type(e).__name__}),flush=True);sys.exit(1)
`;

export function requireFullDuration(actual,expected) {
 if(!Number.isFinite(actual)||actual<=0||!Number.isFinite(expected)||expected<=0||Math.abs(actual-expected)>Math.max(1,expected*0.05))throw Error('Длительность файла не совпадает с полным видео.');
}

export async function downloadVimeoStream(stream,number,{postDir,ffmpeg,ffprobe=toolchain.ffprobe,signal,control,
 run=runEnginePython,probe=runCommand}={}) {
 const {fs,path}=nodeApi;
 if(!Number.isSafeInteger(Number(number))||Number(number)<1)throw Error('Invalid video component');
 number=Number(number);
 if(!ffmpeg||!ffprobe)throw Error('Для сохранения полного видеопотока требуются FFmpeg и FFprobe.');
 await control?.checkpoint();throwIfAborted(signal);
 const controller=new AbortController(),abort=()=>controller.abort();
 const monitor=setInterval(()=>{if(control?.isStopped)abort();},100);
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 let snapshot;
 try {
  snapshot=createPrivateCookieFile('vimeo-stream');
  fs.writeFileSync(snapshot,JSON.stringify({url:stream.url,referrer:stream.referrer}));verifyPrivateCookieFile(snapshot);
  const result=await run(VIMEO_STREAM_SCRIPT,[snapshot,postDir,path.dirname(ffmpeg),String(number)],{signal:controller.signal,timeout:180000});
  if(controller.signal.aborted)throw makeStopError();
  if(result.code!==0)throw Error('Не удалось сохранить полный видеопоток из плеера.');
  const names=fs.readdirSync(postDir).filter(name=>new RegExp(`^${number}\\.(mp4|mov|webm|mkv)$`,'i').test(name));
  if(names.length!==1)throw Error('Плеер не вернул готовый видеофайл.');
  const file=path.join(postDir,names[0]);
  const duration=await probe(ffprobe,['-v','error','-show_entries','format=duration','-of','json',file],{signal:controller.signal,timeout:30000});
  if(controller.signal.aborted)throw makeStopError();
  if(duration.code!==0)throw Error('Не удалось проверить длительность видео.');
  requireFullDuration(Number(JSON.parse(duration.stdout).format?.duration),stream.duration);
  await control?.checkpoint();throwIfAborted(signal);
  return file;
 }finally{clearInterval(monitor);signal?.removeEventListener('abort',abort);removePrivateCookieFile(snapshot);}
}

export async function recoverEmbeddedVideo(number,options,{available=embeddedPlayerAvailable,capture=captureVimeoConfig,download=downloadVimeoStream}={}) {
 const target=embeddedVideoTarget(options.post,number);
 if(!target||!available())return null;
 options.onLog?.(`Видеоблок ${number}: получение потока через встроенный плеер Eagle.`);
 const config=await capture(target,options),stream=selectVimeoStream(config,target);
 return download(stream,number,options);
}
