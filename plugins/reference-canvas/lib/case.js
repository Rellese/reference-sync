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
async function openCase(file,{signal,onProgress,coverOnly=false}={}) {
 const zip=openZip(file);let root;
 try {
  const manifest=validate(JSON.parse(readEntry(zip,'manifest.json').toString('utf8')),zip.entries);
  root=fs.mkdtempSync(path.join(os.tmpdir(),'reference-canvas-'));fs.chmodSync(root,0o700);
  const assets=new Map(),names=coverOnly?(manifest.cover?[manifest.cover]:[]):[...new Set(manifest.blocks.map(b=>b.asset).filter(Boolean))];
  for(const [i,name] of names.entries()) {
   const destination=path.join(root,path.basename(name));
   await extractEntry(zip,zip.entries.get(name),destination,signal);
   assets.set(name,{path:destination,url:pathToFileURL(destination).href});
   onProgress?.({current:i+1,total:names.length});
  }
  if(signal?.aborted)throw new Error('CANCELLED');
  return {manifest,assets,root,dispose(){fs.rmSync(root,{recursive:true,force:true});}};
 }catch(error){if(root)fs.rmSync(root,{recursive:true,force:true});throw error;}
 finally{fs.closeSync(zip.fd);}
}
module.exports={openCase,validate,safeUrl};
