import {nodeApi,eagleApi,workRoot} from './node-bridge.js';
import {runEnginePython} from './toolchain.js';

export const DISK_RESERVE=2*1024**3;
export function diskSpaceError(){return Object.assign(new Error('Недостаточно свободного места на диске. Очередь остановлена; освободите место и продолжите импорт.'),{code:'DISK_SPACE_LOW'});}
export const isDiskFull=value=>value?.code==='ENOSPC'||value?.code==='DISK_SPACE_LOW'||/ENOSPC|no space left on device|disk (?:is )?full|WinError 112/i.test(String(value?.message||value));
const usageScript='import json,shutil,sys; print(json.dumps({"free":shutil.disk_usage(sys.argv[1]).free}))';
export async function readFreeSpace(path,signal){
 const result=await runEnginePython(usageScript,[path],{signal,timeout:15000});
 let free;try{free=JSON.parse(result.stdout).free;}catch{}
 if(result.code||!Number.isSafeInteger(free)||free<0)throw new Error('Не удалось проверить свободное место на диске.');
 return free;
}
export async function assertDiskSpace(requests,{signal,read=readFreeSpace,reserve=DISK_RESERVE}={}){
 const disks=new Map();
 for(const {path,bytes=0} of requests){
  if(!path)continue;
  if(!Number.isSafeInteger(bytes)||bytes<0)throw new Error('Invalid disk reservation');
  const key=nodeApi.fs.statSync(path).dev;
  const disk=disks.get(key)||{path,bytes:0};disk.bytes+=bytes;disks.set(key,disk);
 }
 for(const disk of disks.values())if(await read(disk.path,signal)<disk.bytes+reserve)throw diskSpaceError();
}
export function caseAssetBytes(entry){return (entry.files||[]).reduce((sum,file)=>sum+nodeApi.fs.statSync(file).size,0);}
export async function guardCaseDownload(root,signal){await assertDiskSpace([{path:root,bytes:2**31-1}],{signal});}
export async function guardCasePackaging(entry,root,signal){await assertDiskSpace([{path:root,bytes:caseAssetBytes(entry)+16*1024**2}],{signal});}
export async function guardEagleBatch(items,signal){
 const bytes=items.reduce((sum,item)=>sum+nodeApi.fs.statSync(item.path).size,0);
 await assertDiskSpace([{path:eagleApi?.library?.path||workRoot(),bytes}],{signal});
}
