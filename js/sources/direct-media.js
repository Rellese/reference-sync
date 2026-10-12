import {nodeApi,ensureDir,workRoot} from '../node-bridge.js';
import {toolchain} from '../toolchain.js';
import {validateVideo} from '../downloaded-media.js';
import {downloadMedia} from '../media-download.js';
import {throwIfAborted} from '../job-control.js';
import {diskSpaceError,isDiskFull} from '../disk-space.js';
import {waitForPacing} from '../request-pacing.js';
import {directMediaErrorReason} from './direct-media-errors.js';

export async function downloadDirectMedia(options,{code,title,target:parseTarget,mediaUrl,failure,extensions},{download=downloadMedia,validate=validateVideo}={}){
 if(!nodeApi.available)throw Error('Скачивание доступно только внутри Eagle');
 const {fs,path}=nodeApi,area=ensureDir(path.join(workRoot(),'staging'));
 if(fs.lstatSync(area).isSymbolicLink())throw Error('Unsafe staging directory');
 const canonical=fs.realpathSync(area),root=path.resolve(options.stagingRoot||path.join(canonical,code+'-'+Date.now()));
 if(![path.resolve(area),canonical].includes(path.dirname(root))||fs.existsSync(root)&&fs.lstatSync(root).isSymbolicLink())throw Error('Unsafe staging directory');
 const stagingRoot=ensureDir(path.join(canonical,path.basename(root)));await options.onStagingReady?.(stagingRoot);
 const results=[],agent=new nodeApi.https.Agent({keepAlive:true,maxSockets:2});
 try{
  for(const [position,post] of (options.posts||[]).entries()){
   await options.control?.checkpoint();throwIfAborted(options.signal);
   const target=parseTarget(post.url);if(target.type!=='POST'||post.postId!==code+':'+target.id)throw Error(code.toUpperCase()+'_RESPONSE');
   const directory=path.join(stagingRoot,code+'_'+target.id);
   if(fs.existsSync(directory)&&fs.lstatSync(directory).isSymbolicLink())throw Error('Unsafe staging directory');ensureDir(directory);
   await options.beforePost?.(post,stagingRoot,options.signal);
   options.onProgress?.({stage:'download',current:position+1,total:options.posts.length,post});
   const entry={post,files:[],error:null,issue:null};
   const indices=new Set(Array.isArray(post.selectedComponents)?post.selectedComponents:post.components.map(c=>c.index));
   for(const component of post.components.filter(c=>indices.has(c.index))){
    await options.control?.checkpoint();throwIfAborted(options.signal);
    if(!Number.isSafeInteger(component.index)||component.index<1||!extensions.includes(component.extension))throw Error(code.toUpperCase()+'_RESPONSE');
    const destination=path.join(directory,component.index+'.'+component.extension);
    if(fs.existsSync(destination)&&fs.lstatSync(destination).isSymbolicLink()||fs.existsSync(destination+'.part')&&fs.lstatSync(destination+'.part').isSymbolicLink())throw Error('Unsafe staging file');
    let stage='download';
    try{
     await waitForPacing(options.speedProfile==='safe'?2000:options.speedProfile==='balanced'?1000:0,options.signal);
     await options.control?.checkpoint();throwIfAborted(options.signal);
     await download(mediaUrl(component.url),destination,{signal:options.signal,agent,validateUrl:mediaUrl});
     stage='validation';
     await validate(destination,{ffmpeg:toolchain.ffmpeg,signal:options.signal});
     await options.control?.checkpoint();throwIfAborted(options.signal);entry.files.push(destination);
    }catch(error){
     throwIfAborted(options.signal);
     if(isDiskFull(error)||error.code==='DISK_SPACE_LOW')throw diskSpaceError();
     if(['JOB_STOPPED','STOPPED'].includes(error.code))throw error;
     if(/HTTP 429/.test(error.message))throw failure(code.toUpperCase()+'_RATE_LIMIT');
     if(/MEDIA_TIMEOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNREFUSED/.test(error.message+' '+error.code))throw failure(code.toUpperCase()+'_NETWORK');
     const reason=directMediaErrorReason(error,stage);
     options.onLog?.(`Компонент ${component.index}: ${reason}`);
     entry.error=`Не удалось скачать компонент ${title}. ${reason} Повторите загрузку публикации.`;
     entry.issue={unavailable:false,detail:entry.error,label:'Ошибка загрузки — можно повторить'};
    }
   }
   results.push(entry);if(entry.files.length)await options.onCompleted?.(entry);
  }
 }finally{agent.destroy();}
 return {stagingRoot,results};
}
