import {nodeApi,eagleApi,runCommand} from './node-bridge.js';

// Prefer the complete tools already installed by Eagle. No installation or
// dependency on another downloader application is needed.
export async function findFFmpegPair(candidates=[]) {
  const {path,fs,os}=nodeApi;
  let userData;
  try {userData=await eagleApi?.app?.getPath?.('userData');} catch { /* use standard app data */ }
  if(!userData) {
    if(process.platform==='darwin')userData=path.join(os.homedir(),'Library','Application Support','Eagle');
    else if(process.platform==='win32' && process.env.APPDATA)userData=path.join(process.env.APPDATA,'Eagle');
  }
  const root=userData && path.join(userData,'Plugins');
  let folders=[];
  try {folders=root ? fs.readdirSync(root).filter(name=>/^ffmpeg-(mac|win)-/.test(name)) : [];} catch { /* not installed */ }
  const platform=process.platform==='darwin'?'mac':process.platform==='win32'?'win':'';
  folders=folders.filter(name=>name.startsWith(`ffmpeg-${platform}-`))
    .sort((a,b)=>Number(b.endsWith(process.arch))-Number(a.endsWith(process.arch)));
  const executable=process.platform==='win32'?'ffmpeg.exe':'ffmpeg';
  const probe=process.platform==='win32'?'ffprobe.exe':'ffprobe';
  const all=[...folders.map(name=>path.join(root,name,executable)),...candidates];
  for(const ffmpeg of new Set(all.filter(Boolean))) {
    const ffprobe=path.join(path.dirname(ffmpeg),probe);
    if(!fs.existsSync(ffmpeg)||!fs.existsSync(ffprobe))continue;
    const checks=await Promise.all([ffmpeg,ffprobe].map(command=>runCommand(command,['-version'],{timeout:5000}).catch(()=>null)));
    if(checks.every(result=>result?.code===0))return {ffmpeg,ffprobe};
  }
  return null;
}
