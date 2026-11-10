const fs=require('fs'),path=require('path'),os=require('os');
const {pathToFileURL}=require('url');
const {openZip,readEntry,extractEntry}=require('./zip.js');
const image=/^assets\/[1-9]\d*\.(jpg|jpeg|png|gif|webp|avif)$/;
const video=/^assets\/[1-9]\d*\.(mp4|webm|mov|m4v|mkv)$/;
function safeUrl(value) {
 try {const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
function validate(raw,entries) {
 if(raw?.format!=='reference-sync-case'||raw.version!==1)throw new Error('UNSUPPORTED_CASE');
 if(!Array.isArray(raw.blocks)||raw.blocks.length>10000)throw new Error('INVALID_CASE');
 const text=v=>typeof v==='string'?v.slice(0,200000):'';
 const dimension=v=>Number.isFinite(v)&&v>0?Math.min(v,100000):null;
 const ids=new Set();
 const blocks=raw.blocks.map((b,i)=>{
  if(!b||typeof b.id!=='string'||ids.has(b.id)||b.position!==i||!['text','image','gif','video','unsupported'].includes(b.kind)||!['text','local','unavailable','unsupported'].includes(b.status))throw new Error('INVALID_CASE');
  ids.add(b.id);
  if(b.status==='local'&&(!['image','gif','video'].includes(b.kind)||!(b.kind==='video'?video:image).test(b.asset)||!entries.has(b.asset)||!entries.get(b.asset).length))throw new Error('INVALID_CASE');
  return {id:String(i),kind:b.kind,status:b.status,asset:b.status==='local'?b.asset:'',text:text(b.text),width:dimension(b.width),height:dimension(b.height),alignment:['left','center','right','justify'].includes(b.alignment)?b.alignment:'left',links:(Array.isArray(b.links)?b.links:[]).slice(0,1000).map(l=>({url:safeUrl(l?.url),text:text(l?.text)})).filter(l=>l.url)};
 });
 return {title:text(raw.source?.title).slice(0,4096),author:text(raw.source?.author).slice(0,4096),sourceUrl:safeUrl(raw.source?.url),canvasWidth:dimension(raw.canvasWidth)||1400,cover:image.test(raw.cover)&&entries.has(raw.cover)?raw.cover:'',blocks};
}
async function openCase(file,{signal,onProgress,coverOnly=false,lazy=false}={}) {
 const zip=openZip(file);let root,closed=false;
 try {
  const manifest=validate(JSON.parse(readEntry(zip,'manifest.json').toString('utf8')),zip.entries);
  root=fs.mkdtempSync(path.join(os.tmpdir(),'reference-canvas-'));fs.chmodSync(root,0o700);
  const assets=new Map(),pending=new Map(),abort=new AbortController();
  const allowed=new Set(manifest.blocks.map(b=>b.asset).filter(Boolean));
  if(manifest.cover)allowed.add(manifest.cover);
  let queue=Promise.resolve(),disposed=false;
  function cleanup(){if(closed)return;closed=true;fs.closeSync(zip.fd);fs.rmSync(root,{recursive:true,force:true});signal?.removeEventListener('abort',dispose);}
  function dispose(){if(disposed)return;disposed=true;abort.abort();if(!pending.size)cleanup();else queue.finally(cleanup);}
  function loadAsset(name){
   if(disposed||signal?.aborted)return Promise.reject(new Error('CANCELLED'));
   if(!allowed.has(name))return Promise.reject(new Error('INVALID_CASE'));
   if(assets.has(name))return Promise.resolve(assets.get(name));
   if(pending.has(name))return pending.get(name);
   const task=queue.then(async()=>{
    if(disposed)throw new Error('CANCELLED');
    const destination=path.join(root,path.basename(name));
    try{await extractEntry(zip,zip.entries.get(name),destination,abort.signal);}
    catch(error){fs.rmSync(destination,{force:true});throw error;}
    const asset={path:destination,url:pathToFileURL(destination).href};assets.set(name,asset);return asset;
   });
   pending.set(name,task);queue=task.catch(()=>{}).finally(()=>pending.delete(name));return task;
  }
  signal?.addEventListener('abort',dispose,{once:true});
  const opened={manifest,assets,root,loadAsset,dispose};
  if(!lazy||coverOnly){
   const names=coverOnly?(manifest.cover?[manifest.cover]:[]):[...new Set(manifest.blocks.map(b=>b.asset).filter(Boolean))];
   try{for(const [i,name] of names.entries()){await loadAsset(name);onProgress?.({current:i+1,total:names.length});}}
   catch(error){dispose();await queue;throw error;}
  }
  if(signal?.aborted){dispose();throw new Error('CANCELLED');}
  return opened;
 }catch(error){
  // dispose may already have closed the descriptor after a failed extraction.
  if(!closed){closed=true;fs.closeSync(zip.fd);}
  if(root)fs.rmSync(root,{recursive:true,force:true});throw error;
 }
}
module.exports={openCase,validate,safeUrl};
