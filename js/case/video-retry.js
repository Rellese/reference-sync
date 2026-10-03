import {nodeApi} from '../node-bridge.js';
import {runGallery} from '../toolchain.js';
import {validateVideo} from '../downloaded-media.js';
import {throwIfAborted} from '../job-control.js';
import {downloadIssue} from '../download-outcome.js';
import {recoverEmbeddedVideo} from './vimeo-stream.js';

export function isRetryableVideoFailure(raw) {
 const errors=String(raw).split(/\r?\n/).filter(line=>/\[error\]/i.test(line));
 return errors.some(line=>/^\[downloader\.ytdl\]\[error\]/i.test(line)) && errors.every(line=>
  /^\[downloader\.ytdl\]\[error\]/i.test(line) || /^\[download\]\[error\] Failed to download \d+\.(?:mp4|mov|webm|mkv|m4v|avi)\s*$/i.test(line));
}

// Retry one rejected final video in a fresh directory. A broken staging file
// must not cause gallery-dl to skip the second attempt as "already downloaded".
export async function validateCaseVideo(file,{post,args,postDir,ffmpeg,signal,control,onLog,run=runGallery,validate=validateVideo,wait=waitForVideoRetry,recover=recoverEmbeddedVideo}={}) {
 try{await validate(file,{ffmpeg,signal});return;}
 catch(error){throwIfAborted(signal);if(!ffmpeg)throw error;onLog?.(error.message);}
 const {path}=nodeApi,number=path.basename(file).match(/^(\d+)\./)?.[1];
 if(!number)throw Error('Invalid video component');
 await retryVideo(number,{post,args,postDir,ffmpeg,signal,control,onLog,run,validate,wait,recover,name:path.basename(file)});
}

export function isVimeoHttp401(raw) {
 const errors=String(raw).split(/\r?\n/).filter(line=>/^\[downloader\.ytdl\]\[error\]/i.test(line));
 return isRetryableVideoFailure(raw) && errors.every(line=>/\[vimeo\].*HTTP Error 401\b/i.test(line));
}

// Vimeo can reject one player request and accept the same HTTPS request later.
// Each attempt permits one extraction pass, including with a restored job's
// older arguments. Do not multiply this budget by gallery-dl's retry loop.
// Do not retry other extraction errors, change cookies/TLS or loop indefinitely.
async function retryVideo(number,options) {
 for(let attempt=1;attempt<=3;attempt++) {
  try{return await retryVideoAttempt(number,options);}
  catch(error) {
   throwIfAborted(options.signal);
   if(error.code!=='VIMEO_HTTP_401')throw error;
   if(attempt===1) {
    try{const file=await retryEmbeddedVideo(number,options);if(file)return file;}
    catch(playerError){throwIfAborted(options.signal);if(playerError.code==='JOB_STOPPED')throw playerError;
     throw Error(`${error.message} ${playerError.message}`);}
   }
   if(attempt===3)throw error;
   options.onLog?.(`Видеоблок ${number}: Vimeo ответил 401. Повтор ${attempt+1}/3 через ${attempt*2} с.`);
   await options.wait(attempt*2000,{signal:options.signal,control:options.control});
  }
 }
}

async function retryEmbeddedVideo(number,options) {
 const {fs,path}=nodeApi,temporary=fs.mkdtempSync(path.join(options.postDir,'retry-player-'));
 try {
  const file=await options.recover(number,{...options,postDir:temporary});
  if(!file)return null;
  // A returned path is still untrusted until its identity, location, container
  // and complete decode pass. Never import fragments or a different component.
  if(path.dirname(file)!==temporary||!new RegExp(`^${number}\\.(mp4|mov|webm|mkv)$`,'i').test(path.basename(file))||!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())throw Error('Плеер вернул неверный видеофайл.');
  await options.validate(file,{ffmpeg:options.ffmpeg,signal:options.signal});
  await options.control?.checkpoint();throwIfAborted(options.signal);
  const destination=path.join(options.postDir,options.name || path.basename(file));
  fs.renameSync(file,destination);return destination;
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}

export async function waitForVideoRetry(milliseconds,{signal,control}={}) {
 for(let left=milliseconds;left>0;left-=250) {
  await control?.checkpoint();throwIfAborted(signal);
  await new Promise(resolve=>setTimeout(resolve,Math.min(250,left)));
 }
 await control?.checkpoint();throwIfAborted(signal);
}

async function retryVideoAttempt(number,{args,postDir,ffmpeg,signal,control,onLog,run,validate,name}) {
 number=Number(number);if(!Number.isSafeInteger(number)||number<1)throw Error('Invalid video component');
 const {fs,path}=nodeApi;
 await control?.checkpoint();throwIfAborted(signal);
 const temporary=fs.mkdtempSync(path.join(postDir,'retry-video-'));
 try{
  const retryArgs=[...args];
  const range=retryArgs.indexOf('--range');if(range>=0)retryArgs.splice(range,2);
  retryArgs[retryArgs.indexOf('--dest')+1]=temporary;
  retryArgs.splice(retryArgs.length-1,0,'--range',String(number),'-o','downloader.ytdl.retries=0');
  onLog?.(`Повторная загрузка видеоблока: ${number}`);
  const result=await run(retryArgs,{signal,onStderr:line=>onLog?.(line.trim())});throwIfAborted(signal);
  if(result.code!==0) {
   const raw=[result.stderr,result.stdout].filter(Boolean).join('\n');
   const error=Error(`Видеоблок ${number} не скачан: ${downloadIssue(raw).detail || 'ошибка повторной загрузки'}`);
   if(isVimeoHttp401(raw))error.code='VIMEO_HTTP_401';
   throw error;
  }
  const names=fs.readdirSync(temporary).filter(value=>new RegExp(`^${number}\\.(mp4|mov|webm|mkv|m4v|avi)$`,'i').test(value));
  const candidateName=name || (names.length===1 ? names[0] : '');
  if(!candidateName)throw Error(`Видеоблок ${number}: загрузчик не вернул готовый видеофайл. ${downloadIssue(result.stderr || result.stdout).detail}`.trim());
  const candidate=path.join(temporary,candidateName);
  await validate(candidate,{ffmpeg,signal});throwIfAborted(signal);
  const destination=path.join(postDir,candidateName);
  fs.renameSync(candidate,destination);
  return destination;
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}

// A failed downloader may leave no final file at all. Existing invalid videos
// already receive recovery above; do not start another recovery for those.
export async function retryMissingCaseVideos({post,files,existingFiles,args,postDir,ffmpeg,signal,control,onLog,run=runGallery,validate=validateVideo,wait=waitForVideoRetry,recover=recoverEmbeddedVideo}) {
 const selected=new Set((post.selectedComponents || post.components?.map(c=>c.index) || []).map(Number));
 const present=new Set(existingFiles.map(file=>Number(nodeApi.path.basename(file).match(/^(\d+)\./)?.[1])));
 const missing=(post.components || []).filter(c=>c.mediaType==='video'&&selected.has(Number(c.index))&&!present.has(Number(c.index)));
 const output=[...files],failures=[];let recovered=0;
 for(const component of missing) {
  try {
   if(!ffmpeg)throw Error(`Видеоблок ${component.index}: требуется FFmpeg`);
   output.push(await retryVideo(component.index,{post,args,postDir,ffmpeg,signal,control,onLog,run,validate,wait,recover}));recovered++;
  }catch(error){throwIfAborted(signal);if(error.code==='JOB_STOPPED')throw error;failures.push(error.message);onLog?.(error.message);}
 }
 return {files:output,recovered,failures};
}
