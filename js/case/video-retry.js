import {nodeApi} from '../node-bridge.js';
import {runGallery} from '../toolchain.js';
import {validateVideo} from '../downloaded-media.js';
import {throwIfAborted} from '../job-control.js';

// Retry one rejected final video in a fresh directory. A broken staging file
// must not cause gallery-dl to skip the second attempt as "already downloaded".
export async function validateCaseVideo(file,{args,postDir,ffmpeg,signal,control,onLog,run=runGallery,validate=validateVideo}={}) {
 try{await validate(file,{ffmpeg,signal});return;}
 catch(error){throwIfAborted(signal);if(!ffmpeg)throw error;onLog?.(error.message);}
 const {fs,path}=nodeApi,number=path.basename(file).match(/^(\d+)\./)?.[1];
 if(!number)throw Error('Invalid video component');
 await control?.checkpoint();throwIfAborted(signal);
 const temporary=fs.mkdtempSync(path.join(postDir,'retry-video-'));
 try{
  const retryArgs=[...args];
  const range=retryArgs.indexOf('--range');if(range>=0)retryArgs.splice(range,2);
  retryArgs[retryArgs.indexOf('--dest')+1]=temporary;
  retryArgs.splice(retryArgs.length-1,0,'--range',number);
  onLog?.(`Повторная загрузка видеоблока: ${number}`);
  const result=await run(retryArgs,{signal});throwIfAborted(signal);
  if(result.code!==0)throw Error(`Не удалось повторно скачать видеоблок: ${number}`);
  const candidate=path.join(temporary,path.basename(file));
  await validate(candidate,{ffmpeg,signal});throwIfAborted(signal);
  fs.renameSync(candidate,file);
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
