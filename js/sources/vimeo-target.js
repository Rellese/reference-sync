// Only videos and Showcases are valid external targets.
export function vimeoTarget(input) {
 let url;try{url=new URL(String(input||'').trim());}catch{}
 if(!url || url.protocol!=='https:' || url.username || url.password || url.port ||
    !['vimeo.com','www.vimeo.com','player.vimeo.com'].includes(url.hostname))throw Error('Вставьте HTTPS-ссылку на видео или подборку Vimeo.');
 let match=url.pathname.match(/^\/(\d+)(?:\/([a-f0-9]{10}))?\/?$/i);
 if(url.hostname!=='player.vimeo.com'&&!match)match=url.pathname.match(/^\/(?:channels\/[\w-]+\/|groups\/[\w-]+\/videos\/|showcase\/\d+\/video\/)(\d+)\/?$/);
 if(url.hostname==='player.vimeo.com') {
  match=url.pathname.match(/^\/video\/(\d+)\/?$/);const hash=url.searchParams.get('h');
  if(hash && !/^[a-f0-9]{10}$/i.test(hash))match=null;
  if(match)match[2]=hash||'';
 }else if(!match){
  const album=url.pathname.match(/^\/(?:showcase|album)\/(\d+)\/?$/);
  if(album)return {id:album[1],type:'COLLECTION',name:'Vimeo '+album[1],url:`https://vimeo.com/showcase/${album[1]}`,resource:`/albums/${album[1]}/videos`};
 }
 if(match&&url.hostname!=='player.vimeo.com'&&url.searchParams.has('h')){
  const hash=url.searchParams.get('h');if(!/^[a-f0-9]{10}$/i.test(hash)||match[2]&&match[2].toLowerCase()!==hash.toLowerCase())match=null;
  else match[2]=hash;
 }
 if(!match)throw Error('Вставьте HTTPS-ссылку на видео или подборку Vimeo.');
 const id=match[1],hash=(match[2]||'').toLowerCase();
 return {id,type:'VIDEO',name:'Vimeo '+id,url:`https://vimeo.com/${id}${hash?'/'+hash:''}`,resource:`/videos/${id}${hash?':'+hash:''}`};
}
export const vimeoSavedLists=[
 {id:'favorites',name:'Favorites',type:'COLLECTION',parentId:'',resource:'/me/likes'},
 {id:'watchlater',name:'Watch Later',type:'COLLECTION',parentId:'',resource:'/me/watchlater'},
];
export function vimeoCollection(entry) {
 const saved=vimeoSavedLists.find(item=>item.id===entry.id);
 if(saved)return {...saved};
 if(!/^\d+$/.test(String(entry.id)))throw Error('Вставьте HTTPS-ссылку на видео или подборку Vimeo.');
 const target=vimeoTarget(`https://vimeo.com/showcase/${entry.id}`);
 return {...target,name:String(entry.name||target.name),parentId:''};
}
