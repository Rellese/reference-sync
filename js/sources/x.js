import {withXSession,requestX,probeX} from './x-session.js';
import {xTarget,xBookmarks,xCollection,xMediaUrl} from './x-target.js';
import {downloadX} from './x-download.js';
import {throwIfAborted} from '../job-control.js';
export function normalizeX(item,target){
 const id=String(item.id||''),username=String(item.username||'');
 if(!/^\d+$/.test(id)||!/^\w{1,15}$/.test(username)||!Array.isArray(item.components)||!item.components.length)throw Error('X_RESPONSE');
 const components=item.components.map((c,i)=>{
  if(c.index!==i+1||!['image','video'].includes(c.mediaType)||!['jpg','jpeg','png','webp','gif','mp4'].includes(c.extension))throw Error('X_RESPONSE');
  return {...c,url:xMediaUrl(c.url),previewUrl:xMediaUrl(c.previewUrl)};
 });
 const postId='x:'+id,description=String(item.description||'');
 return {source:'x',postId,externalId:id,shortcode:id,url:`https://x.com/${username}/status/${id}`,
  username,plainUsername:username,title:description.split('\n')[0].slice(0,200),description,
  type:components.length>1?'Карусель':components[0].mediaType==='video'?'Видео':'Фото',
  componentCount:components.length,structure:components.length+' элем.',previewUrl:components[0].previewUrl,
  takenAt:Date.parse(item.created)/1000||0,components,selectedComponents:components.map(c=>c.index),
  collectionId:target.id,collectionName:target.name,
  containers:[{platform:'x',kind:'COLLECTION',id:target.id,name:target.name,parentId:'',parentName:''}],
  collectionOccurrences:[{occurrenceId:`${target.id}:${postId}`,collectionId:target.id,collectionName:target.name,
   collectionType:'COLLECTION',parentId:'',parentName:'',isDuplicate:false}]};
}
export async function discoverX(options,{session=withXSession,request=requestX}={}){
 const liked=options.downloadMode==='liked';
 const targets=liked?[{id:'liked',name:'Понравившиеся публикации',type:'LIKED'}]:options.targetUrl?[xTarget(options.targetUrl)]:options.collections?.length?options.collections.map(xCollection):[xBookmarks];
 const mode=options.searchMode||'smart',known=mode==='full'?[]:[...(options.knownPostIds||[])].map(id=>String(id).replace(/^x:/,'')).filter(id=>/^\d+$/.test(id));
 const limit=mode==='recent'?Math.max(1,Math.trunc(Number(options.limit)||1)):0;
 const posts=new Map(),stopLinkTargets=[];let stoppedEarly=false,checked=0,skippedText=0;
 await session(options,async next=>{
  for(const target of targets){
   await options.control?.checkpoint();throwIfAborted(options.signal);const foundIds=new Set(posts.keys());
   const data=await request({operation:'discover',feed:liked?'liked':'saved',folder:liked||target.type==='POST'||target.id==='bookmarks'?'':target.id,
    postId:target.type==='POST'?target.id:'',limit,known,stopId:options.stopLink?.publicationId||''},
    {...next,onProgress:(count,ids)=>{for(const id of ids||[])if(/^\d+$/.test(String(id)))foundIds.add('x:'+id);
     options.onProgress?.({stage:'discover',found:foundIds.size,collection:target.name});}});
   throwIfAborted(options.signal);
   for(const item of data.posts||[]){const post=normalizeX(item,target),previous=posts.get(post.postId);
    if(!previous)posts.set(post.postId,post);
    else if(!previous.containers.some(c=>c.id===target.id)){previous.containers.push(...post.containers);previous.collectionOccurrences.push(...post.collectionOccurrences);}
   }
   stoppedEarly ||= !!data.stoppedEarly;checked+=Number(data.checked)||0;skippedText+=Number(data.skippedText)||0;
   if(data.stopLinkReached)stopLinkTargets.push(target.id);
   options.onProgress?.({stage:'discover',found:posts.size,collection:target.name});
  }
 });
 return {posts:[...posts.values()],stoppedEarly,stopLinkReached:!!stopLinkTargets.length,stopLinkTargets,checked,skippedText};
}
export async function listXCollections(options,{session=withXSession,request=requestX}={}){
 return session(options,async next=>{const data=await request({operation:'catalog'},next);
  const result=[{...xBookmarks},...(data.containers||[]).map(xCollection)];options.onProgress?.({found:result.length,total:result.length});return result;});
}
export default {code:'x',title:'X',icon:'x',ready:true,needsAccount:false,sourceModes:['browser'],
 containerTypes:['ROOT','COLLECTION'],containerLabels:{root:'Все закладки',level1:'Подборка',level2:'Подборка'},
 defaultTags:['X'],nameMarker:'xorder',jobPrefix:'x',urlPattern:/(?:^|\/\/)(?:www\.|mobile\.)?(?:x|twitter)\.com\//i,
 discover:discoverX,discoverLiked:options=>discoverX({...options,downloadMode:'liked'}),download:downloadX,listContainers:listXCollections,probe:probeX};
