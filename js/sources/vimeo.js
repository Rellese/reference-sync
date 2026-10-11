import {withVimeoSession,requestVimeo,probeVimeo} from './vimeo-session.js';
import {vimeoTarget,vimeoCollection,vimeoSavedLists} from './vimeo-target.js';
import {downloadVimeo} from './vimeo-download.js';
import {throwIfAborted} from '../job-control.js';

function thumbnail(value) {
 try{const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && !url.port &&
  (url.hostname==='vimeocdn.com'||url.hostname.endsWith('.vimeocdn.com'))?url.href:'';}catch{return '';}
}
export function normalizeVimeo(item,target) {
 const video=vimeoTarget(item.url||`https://vimeo.com/${item.id}`);
 if(video.type!=='VIDEO'||video.id!==String(item.id))throw Error('VIMEO_RESPONSE');
 const postId='vimeo:'+video.id,author=String(item.author||'Vimeo'),previewUrl=thumbnail(item.thumbnail);
 return {source:'vimeo',postId,externalId:video.id,shortcode:video.id,url:video.url,
  username:author,plainUsername:author,title:String(item.title||''),description:String(item.description||item.title||''),
  type:'Видео',componentCount:1,structure:'1 элем.',previewUrl,takenAt:Date.parse(item.created)/1000||0,
  components:[{index:1,mediaType:'video',url:video.url,previewUrl}],selectedComponents:[1],
  collectionId:target.id,collectionName:target.name,
  containers:[{platform:'vimeo',kind:'COLLECTION',id:target.id,name:target.name,parentId:'',parentName:''}],
  collectionOccurrences:[{occurrenceId:`${target.id}:${postId}`,collectionId:target.id,collectionName:target.name,
   collectionType:'COLLECTION',parentId:'',parentName:'',isDuplicate:false}]};
}
export async function discoverVimeo(options,{session=withVimeoSession,request=requestVimeo}={}) {
 const targets=options.targetUrl?[vimeoTarget(options.targetUrl)]:options.collections?.length?
  options.collections.map(vimeoCollection):[vimeoSavedLists[0]];
 const mode=options.searchMode||'smart',known=mode==='full'?[]:[...(options.knownPostIds||[])].map(id=>String(id).replace(/^vimeo:/,'')).filter(id=>/^\d+$/.test(id));
 const limit=mode==='recent'?Math.max(1,Math.trunc(Number(options.limit)||1)):0;
 const posts=new Map(),stopLinkTargets=[];let stoppedEarly=false;
 await session(options,async next=>{
  for(const target of targets){
   await options.control?.checkpoint();throwIfAborted(options.signal);
   const foundIds=new Set(posts.keys());
   const data=await request({operation:'discover',resource:target.resource,known,limit,stopId:options.stopLink?.publicationId||''},
    {...next,onProgress:(count,ids)=>{
     for(const id of ids||[])if(/^\d+$/.test(String(id)))foundIds.add('vimeo:'+id);
     options.onProgress?.({stage:'discover',found:foundIds.size,collection:target.name});
    }});
   throwIfAborted(options.signal);
   for(const item of data.posts||[]){
    const post=normalizeVimeo(item,target),previous=posts.get(post.postId);
    if(!previous)posts.set(post.postId,post);
    else if(!previous.containers.some(c=>c.id===target.id)){
     previous.containers.push(...post.containers);previous.collectionOccurrences.push(...post.collectionOccurrences);
    }
   }
   stoppedEarly ||= !!data.stoppedEarly;
   if(data.stopLinkReached)stopLinkTargets.push(String(target.id));
   options.onProgress?.({stage:'discover',found:posts.size,collection:target.name});
  }
 });
 return {posts:[...posts.values()],stoppedEarly,stopLinkReached:stopLinkTargets.length>0,stopLinkTargets};
}
export async function listVimeoCollections(options,{session=withVimeoSession,request=requestVimeo}={}) {
 return session(options,async next=>{
  const data=await request({operation:'catalog'},next);
  const collections=[...vimeoSavedLists.map(item=>({...item})),...(data.containers||[]).map(vimeoCollection)];
  options.onProgress?.({found:collections.length,total:collections.length});return collections;
 });
}
export default {code:'vimeo',title:'Vimeo',icon:'vimeo',ready:true,needsAccount:false,sourceModes:['browser'],
 videoOnly:true,containerTypes:['ROOT','COLLECTION'],containerLabels:{root:'Сохранённые видео',level1:'Подборка',level2:'Подборка'},
 defaultTags:['Vimeo'],nameMarker:'vimorder',jobPrefix:'vimeo',urlPattern:/(?:^|\/\/)(?:www\.|player\.)?vimeo\.com\//i,
 discover:discoverVimeo,download:downloadVimeo,listContainers:listVimeoCollections,probe:probeVimeo};
