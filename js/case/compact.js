import {nodeApi,workRoot} from '../node-bridge.js';
import {verifyStoredZip} from '../archive-zip.js';
import {throwIfAborted} from '../job-control.js';
import {diskSpaceError} from '../disk-space.js';

// The verified archive replaces originals used only by the whole case. Retain
// every selected standalone block; the Eagle batch still runs after downloads.
export async function compactPackedCase(entry,root,{signal,onReady}={}){
 const {fs,path,Buffer}=nodeApi,originals=[...entry.files];
 const base=fs.realpathSync(path.join(workRoot(),'staging')),realRoot=fs.realpathSync(root);
 if(!realRoot.startsWith(base+path.sep)||fs.lstatSync(root).isSymbolicLink())throw new Error('Invalid case staging root');
 const directoryPath=path.join(root,String(entry.post.postId).replace(/[^\w.-]+/g,'_')),directory=fs.realpathSync(directoryPath);
 if(fs.realpathSync(path.dirname(entry.caseFile))!==realRoot||!/^case-[a-f0-9]{24}\.rscase$/.test(path.basename(entry.caseFile)))throw new Error('Invalid packed case path');
 if(fs.lstatSync(directoryPath).isSymbolicLink()||path.dirname(directory)!==realRoot)throw new Error('Invalid case media directory');
 const entries=await verifyStoredZip(entry.caseFile,{signal});
 const manifestEntry=entries.find(e=>e.name==='manifest.json');
 if(!manifestEntry||manifestEntry.unpacked>16*1024**2)throw new Error('Invalid case manifest');
 const data=Buffer.alloc(manifestEntry.unpacked),fd=fs.openSync(entry.caseFile,'r');
 try{if(fs.readSync(fd,data,0,data.length,manifestEntry.dataOffset)!==data.length)throw new Error('Invalid case manifest');}finally{fs.closeSync(fd);}
 const manifest=JSON.parse(data.toString('utf8'));
 if(manifest.format!=='reference-sync-case'||manifest.version!==1||String(manifest.source?.id)!==String(entry.post.externalId||entry.post.postId.replace(/^behance:/,'')))throw new Error('Invalid case identity');
 const assets=new Map(entries.map(e=>[e.name,e]));
 for(const file of originals){
  const stat=fs.lstatSync(file),asset=assets.get('assets/'+path.basename(file));
  if(fs.realpathSync(path.dirname(file))!==directory||!stat.isFile()||!asset||asset.unpacked!==stat.size)throw new Error('Кейс не содержит все исходные блоки. Исходные файлы сохранены.');
 }
 const keep=new Set(entry.blockFiles||[]);
 if([...keep].some(file=>!originals.includes(file)))throw new Error('Invalid standalone block selection');
 entry.downloadedFileCount=originals.length;entry.files=originals.filter(file=>keep.has(file));
 // Persist the archive and retained-block paths before unlinking. After a
 // crash, the recovery record never depends on a deleted original.
 if(await onReady?.(entry)===false){entry.files=originals;throw diskSpaceError();}
 for(const file of originals){throwIfAborted(signal);if(!keep.has(file))await fs.promises.unlink(file);}
 if(!entry.files.length)await fs.promises.rmdir(directory).catch(error=>{if(!['ENOTEMPTY','EEXIST','ENOENT'].includes(error.code))throw error;});
 return entry;
}
