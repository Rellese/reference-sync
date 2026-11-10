import {nodeApi} from '../node-bridge.js';
import {browserRoot,normalizeBrowserName,discoverBrowserProfiles} from '../browser-profiles.js';
const version=value=>String(value||'').trim().match(/^\d+(?:\.\d+){1,3}$/)?.[0]||'';
function macVersion(browser,key){
 const app={chrome:'Google Chrome',edge:'Microsoft Edge',yandex:'Yandex',firefox:'Firefox'}[browser];
 if(!app||process.platform!=='darwin')return '';
 for(const root of ['/Applications',nodeApi.path.join(nodeApi.os.homedir(),'Applications')]){
  const file=nodeApi.path.join(root,app+'.app','Contents','Info.plist');
  if(!nodeApi.fs.existsSync(file))continue;
  try{return version(nodeApi.childProcess.execFileSync('/usr/bin/plutil',['-extract',key,'raw',file],{encoding:'utf8',timeout:3000,stdio:['ignore','pipe','ignore']}));}catch{}
 }
 return '';
}
// The platform binds its temporary access cookie to the browser's User-Agent.
// Read version metadata only, never browser account data or cookie values here.
export function dribbbleBrowserIdentity(browser='chrome',profile=''){
 if(!nodeApi.available)return {};
 const normalized=normalizeBrowserName(browser),root=browserRoot(normalized);let chromium='',product='';
 if(root)try{chromium=version(nodeApi.fs.readFileSync(nodeApi.path.join(root,'Last Version'),'utf8'));}catch{}
 const os=process.platform==='darwin'?'Macintosh; Intel Mac OS X 10_15_7':process.platform==='win32'?'Windows NT 10.0; Win64; x64':'X11; Linux x86_64';
 if(normalized==='firefox'){
  product=macVersion('firefox','CFBundleShortVersionString');
  if(!product){
   const selected=discoverBrowserProfiles('firefox').find(p=>!profile||p.id===profile);
   if(selected)try{product=version(nodeApi.fs.readFileSync(nodeApi.path.join(selected.id,'compatibility.ini'),'utf8').match(/^LastVersion=(\d+(?:\.\d+)+)/m)?.[1]);}catch{}
  }
  return product?{impersonate:'firefox',headers:{'User-Agent':`Mozilla/5.0 (${os}; rv:${product.split('.')[0]}.0) Gecko/20100101 Firefox/${product}`}}:{};
 }
 if(!chromium)chromium=macVersion(normalized,normalized==='yandex'?'CFBundleChromiumShortVersionString':'CFBundleShortVersionString');
 if(!chromium)return {};
 const major=chromium.split('.')[0],brand=normalized==='edge'?'Microsoft Edge':'Google Chrome';
 if(normalized==='edge')product=chromium;
 if(normalized==='yandex')product=macVersion('yandex','CFBundleYandexShortVersionString');
 const suffix=normalized==='edge'?` Edg/${major}.0.0.0`:normalized==='yandex'&&product?` YaBrowser/${product} Yowser/2.5`:'';
 return {impersonate:'chrome',headers:{'User-Agent':`Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36${suffix}`,
  'sec-ch-ua':`"${brand}";v="${major}", "Chromium";v="${major}", "Not_A Brand";v="24"`,
  'sec-ch-ua-platform':`"${process.platform==='darwin'?'macOS':process.platform==='win32'?'Windows':'Linux'}"`}};
}
