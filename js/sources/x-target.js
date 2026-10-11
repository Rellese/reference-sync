const hosts=new Set(['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com','mobile.x.com']);
const invalid=()=>Error('Вставьте HTTPS-ссылку на публикацию X.');
export function xTarget(input){
 let url;try{url=new URL(String(input||'').trim());}catch{}
 if(!url||url.protocol!=='https:'||url.username||url.password||url.port||!hosts.has(url.hostname))throw invalid();
 const match=url.pathname.match(/^\/(?:[A-Za-z0-9_]{1,15}\/status|i\/web\/status)\/(\d+)\/?$/);
 if(!match)throw invalid();
 return {id:match[1],type:'POST',name:'X '+match[1],url:'https://x.com/i/web/status/'+match[1]};
}
export const xBookmarks={id:'bookmarks',type:'COLLECTION',name:'Все закладки',url:'https://x.com/i/history'};
export function xCollection(item){
 const id=String(item.id||'');
 if(id==='bookmarks')return {...xBookmarks};
 if(!/^\d+$/.test(id))throw Error('X_COLLECTION');
 return {id,type:'COLLECTION',name:String(item.name||id),url:'https://x.com/i/bookmarks/'+id};
}
export function xMediaUrl(value){
 let url;try{url=new URL(value);}catch{}
 if(!url||url.protocol!=='https:'||url.username||url.password||url.port||!['pbs.twimg.com','video.twimg.com'].includes(url.hostname))throw Error('X_MEDIA_URL');
 return url.href;
}
