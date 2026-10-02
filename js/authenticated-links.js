import {parseStopLink} from './stop-link.js';
export function archiveHttpsUrl(input,platform){
 let url;try{const text=String(input||'').trim();url=new URL(/^https?:\/\//i.test(text)?text:'https://'+text);}catch{throw Error('Invalid archive publication URL');}
 const hosts={instagram:['instagram.com','www.instagram.com'],pinterest:['pinterest.com','www.pinterest.com','ru.pinterest.com','uk.pinterest.com']};
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port||!hosts[platform]?.includes(url.hostname))throw Error('Invalid archive publication URL');
 const parsed=parseStopLink(url.href,platform);if(!parsed.ok)throw Error('Invalid archive publication URL');
 if(platform==='pinterest')return `https://www.pinterest.com/pin/${parsed.publicationId}/`;
 const kind=/^\/(p|reels?|tv)\//i.exec(url.pathname)?.[1].toLowerCase();if(!kind)throw Error('Invalid archive publication URL');
 return `https://www.instagram.com/${kind==='reels'?'reel':kind}/${parsed.publicationId}/`;
}
export function requireAuthenticatedHttps(args){
 if(!args.some(arg=>/^--cookies(?:-from-browser)?(?:=|$)/.test(String(arg))))return;
 for(const arg of args){
  if(/^http:\/\//i.test(String(arg)))throw Error('Authenticated downloads require HTTPS');
 }
}
