import {nodeApi,workRoot,runCommand} from './node-bridge.js';
import {throwIfAborted} from './job-control.js';
import {pythonBuild} from './python-builds.js';
import {downloadPython} from './python-download.js';
import {extractPython} from './python-archive.js';
const MARKER='.reference-sync-python.json';

function paths(root,platform,arch){
  const build=pythonBuild(platform,arch),parent=nodeApi.path.join(root,'python'),directory=nodeApi.path.join(parent,build.key);
  return {build,parent,directory,executable:nodeApi.path.join(directory,...build.executable.split('/'))};
}
export function findManagedPython({root,platform=process.platform,arch=process.arch}={}){
  if(!nodeApi.available)return null;
  try{
    root ||= nodeApi.path.join(nodeApi.os.homedir(),'.reference-sync');
    const p=paths(root,platform,arch),{fs,path}=nodeApi;
    if(!fs.existsSync(p.executable))return null;
    const directory=fs.lstatSync(p.directory),marker=fs.lstatSync(path.join(p.directory,MARKER));
    if(!directory.isDirectory()||directory.isSymbolicLink()||!marker.isFile()||marker.isSymbolicLink())return null;
    const value=JSON.parse(fs.readFileSync(path.join(p.directory,MARKER),'utf8'));
    const actual=fs.realpathSync(p.executable);
    if(value.sha256!==p.build.sha256||value.version!==p.build.version||!actual.startsWith(fs.realpathSync(p.directory)+path.sep)||!fs.statSync(actual).isFile())return null;
    return p.executable;
  }catch{return null;}
}
async function secureDirectory(directory,signal){
  const {fs,Buffer}=nodeApi;fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('PYTHON_DIRECTORY');
  if(process.platform==='win32'){
    const encoded=Buffer.from(directory,'utf8').toString('base64');
    const script=`$ErrorActionPreference='Stop';$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'));$me=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetAccessRuleProtection($true,$false);$rule=New-Object Security.AccessControl.FileSystemAccessRule($me,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule);Set-Acl -LiteralPath $p -AclObject $acl`;
    const result=await runCommand('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{timeout:20000,signal});
    throwIfAborted(signal);if(result.code!==0)throw Error('PYTHON_DIRECTORY');
  }else{
    if(stat.uid!==process.getuid())throw Error('PYTHON_DIRECTORY');fs.chmodSync(directory,0o700);
  }
}
function cleanInterrupted(parent){
  const {fs,path}=nodeApi;
  for(const name of fs.readdirSync(parent)){
    const match=/^install-(\d+)-[\w-]+$/.exec(name);if(!match)continue;
    let dead=false;try{process.kill(Number(match[1]),0);}catch(error){dead=error.code==='ESRCH';}
    const directory=path.join(parent,name),stat=fs.lstatSync(directory);
    if(dead&&stat.isDirectory()&&!stat.isSymbolicLink())fs.rmSync(directory,{recursive:true,force:true});
  }
}
async function verifyPython(executable,version,signal){
  const result=await runCommand(executable,['-I','-c',
    'import sys,ssl,sqlite3,ctypes,zlib,lzma,ensurepip;print(".".join(map(str,sys.version_info[:3])))'],{timeout:30000,signal});
  throwIfAborted(signal);if(result.code!==0||result.stdout.trim()!==version)throw Error('PYTHON_VERIFY');
}
async function preparePrivatePip(executable,signal){
  const options={timeout:60000,signal};
  let result=await runCommand(executable,['-I','-m','pip','--version'],options);
  throwIfAborted(signal);
  if(result.code!==0){
    result=await runCommand(executable,['-I','-m','ensurepip','--upgrade'],options);
    throwIfAborted(signal);if(result.code!==0)throw Error('PYTHON_PIP');
  }
}
// Called only by the explicit Prepare engine action. Completed installations
// are committed by one rename. Existing directories are never blindly deleted.
export async function installManagedPython({root=workRoot(),platform=process.platform,arch=process.arch,
  signal,onProgress,download=downloadPython,extract=extractPython,verify=verifyPython,preparePip=preparePrivatePip}={}){
  throwIfAborted(signal);if(!nodeApi.available)throw Error('PYTHON_DIRECTORY');
  const {fs,path}=nodeApi,p=paths(root,platform,arch);
  const current=findManagedPython({root,platform,arch});
  if(current){await verify(current,p.build.version,signal);await preparePip(current,signal);return current;}
  await secureDirectory(p.parent,signal);cleanInterrupted(p.parent);
  // An unrecognized existing directory can contain user files; preserve it.
  if(fs.existsSync(p.directory))throw Error('PYTHON_DIRECTORY');
  const stage=fs.mkdtempSync(path.join(p.parent,'install-'+process.pid+'-'));
  let committed=false;
  try{
    await secureDirectory(stage,signal);throwIfAborted(signal);
    onProgress?.({stage:'python-download',percent:8});
    await download(p.build,path.join(stage,'python.tar.gz'),{signal,onProgress:f=>onProgress?.({stage:'python-download',percent:8+Math.round(f*12)})});
    throwIfAborted(signal);onProgress?.({stage:'python-extract',percent:21});
    const unpacked=await extract(path.join(stage,'python.tar.gz'),stage,{signal,platform,
      onProgress:f=>onProgress?.({stage:'python-extract',percent:21+Math.round(f*6)})});
    const candidate=path.join(unpacked,...p.build.executable.split('/'));
    await verify(candidate,p.build.version,signal);await preparePip(candidate,signal);throwIfAborted(signal);
    fs.writeFileSync(path.join(unpacked,MARKER),JSON.stringify({version:p.build.version,sha256:p.build.sha256,platform,arch}),{flag:'wx',mode:0o600});
    // Another viewer/process may have completed the same install meanwhile.
    const winner=findManagedPython({root,platform,arch});
    if(winner){await verify(winner,p.build.version,signal);return winner;}
    fs.renameSync(unpacked,p.directory);committed=true;
    await verify(p.executable,p.build.version,signal);
    onProgress?.({stage:'python-ready',percent:28});return p.executable;
  }catch(error){
    if(committed)fs.rmSync(p.directory,{recursive:true,force:true});
    if(signal?.aborted)throwIfAborted(signal);
    if(error?.message?.startsWith('PYTHON_'))throw error;
    throw Error('PYTHON_INSTALL');
  }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
