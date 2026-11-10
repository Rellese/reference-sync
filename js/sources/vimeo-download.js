import {nodeApi,ensureDir,workRoot} from '../node-bridge.js';
import {runEnginePython,toolchain} from '../toolchain.js';
import {validateVideo,finalMediaName} from '../downloaded-media.js';
import {throwIfAborted} from '../job-control.js';
import {diskSpaceError,isDiskFull} from '../disk-space.js';
import {withVimeoSession,requestVimeo} from './vimeo-session.js';
import {vimeoCheckpointScript} from './vimeo-python.js';
import {vimeoTarget} from './vimeo-target.js';

// Cookies can only be transmitted over HTTPS. Do not let a downloader redirect
// an authenticated request to HTTP or run an external network downloader.
export const vimeoDownloadScript=String.raw`
import json,sys,os,time,urllib.parse,urllib.request,errno,re
from yt_dlp import YoutubeDL
from yt_dlp.networking._urllib import UrllibRH
from yt_dlp.downloader.external import FFmpegFD
class Failure(Exception):pass
${vimeoCheckpointScript}
def safe_url(value):
 u=urllib.parse.urlsplit(value);host=u.hostname or ''
 if u.scheme!='https' or u.username or u.password or u.port or not any(host==base or host.endswith('.'+base) for base in ('vimeo.com','vimeocdn.com','akamaized.net')):raise Failure('VIMEO_URL')
class Guard(urllib.request.BaseHandler):
 handler_order=1
 def http_request(self,request):checkpoint();safe_url(request.full_url);return request
 https_request=http_request
class VimeoRH(UrllibRH):
 _SUPPORTED_URL_SCHEMES=('https',)
 def _create_instance(self,**kwargs):
  opener=super()._create_instance(**kwargs);opener.add_handler(Guard());return opener
 def _send(self,request):checkpoint();safe_url(request.url);return super()._send(request)
def no_external(*args,**kwargs):raise Failure('VIMEO_URL')
FFmpegFD.real_download=no_external
class Quiet:
 def debug(self,*args):pass
 def warning(self,*args):pass
 def error(self,*args):pass
def progress(value):checkpoint()
try:
 spec=json.load(open(sys.argv[1],encoding='utf8'));safe_url(spec['url'])
 opts={'outtmpl':os.path.join(spec['directory'],'1.%(ext)s'),'cookiefile':spec['cookies'],
  'ffmpeg_location':spec['ffmpeg'],'format':'bestvideo+bestaudio/best','merge_output_format':'mp4',
  'cachedir':False,'quiet':True,'no_warnings':True,'logger':Quiet(),'noplaylist':True,
  'retries':0,'extractor_retries':0,'fragment_retries':0,'socket_timeout':30,
  'concurrent_fragment_downloads':1,'hls_prefer_native':True,'skip_unavailable_fragments':False,
  'allowed_extractors':['vimeo'],'enable_file_urls':False,'overwrites':True,'continuedl':False,
  'progress_hooks':[progress],'postprocessor_hooks':[progress]}
 with YoutubeDL(opts) as ydl:
  ydl._request_director=ydl.build_request_director([VimeoRH])
  info=ydl.extract_info(spec['url'],download=True)
 if not info:raise Failure('VIMEO_DOWNLOAD')
 print(json.dumps({'success':True}))
except Failure as error:
 print(json.dumps({'error':str(error)}));sys.exit(1)
except Exception as error:
 # Never return raw yt-dlp exceptions, which can contain signed stream URLs.
 message=str(error)
 offline=any(marker in message.lower() for marker in ('timed out','connection refused','connection reset','network is unreachable','failed to resolve','name or service not known','nodename nor servname'))
 code='DISK_SPACE_LOW' if getattr(error,'errno',None)==errno.ENOSPC or 'No space left' in message or 'WinError 112' in message else 'VIMEO_RATE_LIMIT' if re.search(r'HTTP(?: Error)?\s*429\b|too many requests',message,re.I) else 'VIMEO_NETWORK' if offline else 'VIMEO_DOWNLOAD'
 print(json.dumps({'error':code}));sys.exit(1)
`;

function stagingDirectory(existing) {
 const {fs,path}=nodeApi,area=ensureDir(path.join(workRoot(),'staging'));
 if(fs.lstatSync(area).isSymbolicLink())throw Error('Unsafe staging directory');
 const canonical=fs.realpathSync(area),root=path.resolve(existing||path.join(area,'vimeo-'+Date.now()));
 if(![path.resolve(area),canonical].includes(path.dirname(root)))throw Error('Unsafe staging directory');
 const destination=path.join(canonical,path.basename(root));
 if(fs.existsSync(destination)&&fs.lstatSync(destination).isSymbolicLink())throw Error('Unsafe staging directory');
 return ensureDir(destination);
}

export async function downloadVimeo(options,{session=withVimeoSession,request=requestVimeo,run=runEnginePython,validate=validateVideo}={}) {
 if(!nodeApi.available)throw Error('Скачивание доступно только внутри Eagle');
 const {fs,path}=nodeApi,posts=options.posts||[];
 const stagingRoot=stagingDirectory(options.stagingRoot);
 await options.onStagingReady?.(stagingRoot);
 const results=[];
 await session(options,async next=>{
  for(const [index,post] of posts.entries()){
   await options.control?.checkpoint();throwIfAborted(options.signal);
   const target=vimeoTarget(post.url);
   if(target.type!=='VIDEO'||post.postId!=='vimeo:'+target.id)throw Error('VIMEO_RESPONSE');
   const directory=path.join(stagingRoot,'vimeo_'+target.id);
   if(fs.existsSync(directory)&&fs.lstatSync(directory).isSymbolicLink())throw Error('Unsafe staging directory');
   ensureDir(directory);
   await options.beforePost?.(post,stagingRoot,options.signal);
   options.onProgress?.({stage:'download',current:index+1,total:posts.length,post});
   const entry={post,files:[],error:null,issue:null};
   try{
    await request({operation:'download',url:target.url,directory,ffmpeg:toolchain.ffprobe?path.dirname(toolchain.ffmpeg):toolchain.ffmpeg},next,run,vimeoDownloadScript);
    const files=fs.readdirSync(directory).filter(name=>finalMediaName(name)&&/^1\./.test(name)).map(name=>path.join(directory,name));
    if(files.length!==1||fs.lstatSync(files[0]).isSymbolicLink())throw Error('Vimeo не вернул готовый видеофайл.');
    await validate(files[0],{ffmpeg:toolchain.ffmpeg,signal:options.signal});
    await options.control?.checkpoint();throwIfAborted(options.signal);
    entry.files=files;
   }catch(error){
    throwIfAborted(options.signal);
    if(isDiskFull(error)||error.code==='DISK_SPACE_LOW')throw diskSpaceError();
    if(['JOB_STOPPED','VIMEO_RATE_LIMIT','VIMEO_SESSION_INVALID','VIMEO_NETWORK'].includes(error.code))throw error;
    entry.error=error.message;entry.issue={unavailable:false,detail:error.message,label:'Ошибка загрузки — можно повторить'};
   }
   results.push(entry);
   if(entry.files.length)await options.onCompleted?.(entry);
  }
 });
 return {stagingRoot,results};
}
