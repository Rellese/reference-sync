import {nodeApi,workRoot} from './node-bridge.js';
let directory;
function secureDirectory(dir){
 const {fs}=nodeApi;
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 if(!fs.lstatSync(dir).isDirectory()||fs.lstatSync(dir).isSymbolicLink())throw Error('Unsafe cookie directory');
 fs.chmodSync(dir,0o700);
 if(process.platform==='win32'){
  const {execFileSync}=nodeApi.childProcess;
  const identity=execFileSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});
  const sid=identity.match(/S-1-\d+(?:-\d+)+/)?.[0];if(!sid)throw Error('Cannot restrict cookie directory');
  execFileSync('icacls',[dir,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'/remove:g','*S-1-1-0','*S-1-5-11','*S-1-5-32-545'],{windowsHide:true,stdio:'pipe'});
 }else if((fs.statSync(dir).mode&0o777)!==0o700)throw Error('Unsafe cookie permissions');
}
export function cleanupCookieSnapshots(root=workRoot()){
 if(!nodeApi.available)return;
 const {fs,path}=nodeApi;
 for(const name of ['cookie-cache','cookie-snapshots','session-check']){
  const dir=path.join(root,name);if(!fs.existsSync(dir)||fs.lstatSync(dir).isSymbolicLink())continue;
  secureDirectory(dir);
  for(const entry of fs.readdirSync(dir)){
   const file=path.join(dir,entry),stat=fs.lstatSync(file),owner=/^session-(\d+)-/.exec(entry);
   if(owner){
    let dead=false;try{process.kill(Number(owner[1]),0);}catch(error){dead=error.code==='ESRCH';}
    if(dead&&!stat.isSymbolicLink())fs.rmSync(file,{recursive:true,force:true});
   }else if(/^(?:pinterest-|cookies-|Cookies-)/.test(entry)&&Date.now()-stat.mtimeMs>86400000){
    // Legacy snapshots have no owner PID. Do not remove a recent active export.
    if(stat.isFile()||stat.isSymbolicLink())fs.unlinkSync(file);
   }
  }
 }
}
export function createPrivateCookieFile(prefix='cookies'){
 if(!nodeApi.available)throw Error('Node.js unavailable');
 const {fs,path,crypto}=nodeApi;
 if(directory&&!fs.existsSync(directory))directory=undefined;
 if(!directory){
  cleanupCookieSnapshots();const root=path.join(workRoot(),'cookie-cache');secureDirectory(root);
  directory=fs.mkdtempSync(path.join(root,`session-${process.pid}-`));secureDirectory(directory);
  const cleanup=()=>{if(directory){fs.rmSync(directory,{recursive:true,force:true});directory=undefined;}};
  if(typeof window!=='undefined')window.addEventListener?.('beforeunload',cleanup,{once:true});
  process.once('exit',cleanup);
 }
 const file=path.join(directory,`${prefix}-${crypto.randomBytes(12).toString('hex')}.txt`);
 const fd=fs.openSync(file,'wx',0o600);fs.closeSync(fd);verifyPrivateCookieFile(file);return file;
}
export function verifyPrivateCookieFile(file){
 const {fs}=nodeApi,stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('Unsafe cookie file');
 // Recheck after external exporters: do not consume a file with widened access.
 if(process.platform==='win32'){
  const encodedPath=nodeApi.Buffer.from(file,'utf8').toString('base64');
  const script=`$ErrorActionPreference='Stop'; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}')); $me=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach($r in (Get-Acl -LiteralPath $p).Access){if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $me){throw 'Unsafe cookie ACL'}}`;
  nodeApi.childProcess.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',nodeApi.Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:'pipe'});
 }else if((stat.mode&0o777)!==0o600||stat.uid!==process.getuid())throw Error('Unsafe cookie permissions');
 return file;
}
export function copyPrivateCookieFile(source,destination){
 const {fs}=nodeApi;verifyPrivateCookieFile(destination);
 // copyFile may inherit the source mode; write through the precreated descriptor.
 const fd=fs.openSync(destination,'r+');try{fs.ftruncateSync(fd,0);fs.writeFileSync(fd,fs.readFileSync(source));}finally{fs.closeSync(fd);}
 verifyPrivateCookieFile(destination);
}
