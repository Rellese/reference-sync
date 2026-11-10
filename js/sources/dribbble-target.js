const rejected=()=>Error('Вставьте HTTPS-ссылку на шот, коллекцию или профиль Dribbble.');
const username=/^[A-Za-z0-9_-]{1,80}$/;
export function dribbbleTarget(input){
 let url;try{url=new URL(String(input||'').trim());}catch{}
 if(!url||url.protocol!=='https:'||url.username||url.password||url.port||!['dribbble.com','www.dribbble.com'].includes(url.hostname))throw rejected();
 let match=url.pathname.match(/^\/shots\/(\d+)(?:-[^/]+)?\/?$/);
 if(match)return {id:match[1],type:'POST',url:'https://dribbble.com'+url.pathname.replace(/\/$/,''),name:'Dribbble '+match[1]};
 match=url.pathname.match(/^\/([A-Za-z0-9_-]+)\/(?:collections|buckets)\/(\d+)(?:-[^/]+)?\/?$/);
 if(match)return {id:match[2],username:match[1],type:'COLLECTION',url:'https://dribbble.com'+url.pathname.replace('/buckets/','/collections/').replace(/\/$/,''),name:match[2]};
 match=url.pathname.match(/^\/([A-Za-z0-9_-]+)(?:\/collections)?\/?$/);
 if(match&&username.test(match[1])&&!['account','shots','buckets','collections','session','login','signup','search','popular','following','uploads','messages','likes','pro','hire','privacy','terms','contact','stories'].includes(match[1].toLowerCase()))return {id:match[1],username:match[1],type:'ROOT',url:`https://dribbble.com/${match[1]}/collections`,name:match[1]};
 throw rejected();
}
export function dribbbleCollection(item){
 const target=dribbbleTarget(item.url);
 if(target.type!=='COLLECTION'||target.id!==String(item.id))throw Error('DRIBBBLE_COLLECTION');
 return {...target,name:String(item.name||target.name)};
}
export function dribbbleMediaUrl(value){
 let url;try{url=new URL(value);}catch{}
 if(!url||url.protocol!=='https:'||url.username||url.password||url.port||!['cdn.dribbble.com','cdn2.dribbble.com'].includes(url.hostname)||!/^\/(?:users|userupload)\//.test(url.pathname))throw Error('DRIBBBLE_MEDIA_URL');
 return url.href;
}
