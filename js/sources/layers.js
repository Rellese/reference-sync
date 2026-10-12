import {withLayersSession,requestLayers,probeLayers,layersFailure} from './layers-session.js';
import {layersTarget,layersCollection,layersMediaUrl} from './layers-target.js';
import {downloadDirectMedia} from './direct-media.js';
import {throwIfAborted} from '../job-control.js';
const extensions=['jpg','jpeg','png','webp','gif','avif','tiff','svg','mp4','webm','mov','m4v','avi'];
export function normalizeLayers(item){
 const id=String(item.id||''),target=layersTarget(item.url),author=String(item.author||'');
 if(target.type!=='POST'||target.id!==id||!/^[A-Za-z0-9_.-]{1,80}$/.test(author)||!Array.isArray(item.components)||item.components.length!==1)throw Error('LAYERS_RESPONSE');
 const components=item.components.map(c=>{
  if(c.index!==1||!['image','video'].includes(c.mediaType)||!extensions.includes(c.extension))throw Error('LAYERS_RESPONSE');
  return {...c,url:layersMediaUrl(c.url),previewUrl:c.previewUrl?layersMediaUrl(c.previewUrl):''};
 });
 const refs=(item.collections||[]).map(ref=>{
  const value=layersTarget(ref.url);
  if(!['COLLECTION','POST'].includes(value.type)||value.id!==String(ref.id))throw Error('LAYERS_RESPONSE');
  return {...value,name:String(ref.name||value.name)};
 });
 const postId='layers:'+id,title=String(item.title||author),first=refs[0]||{id:'link',name:'Layers'};
 return {source:'layers',postId,externalId:id,shortcode:id,url:target.url,username:'@'+author,plainUsername:author,
  title,namingName:title,description:String(item.description||''),takenAt:Date.parse(item.created)/1000||0,
  components,selectedComponents:[1],componentCount:1,type:components[0].mediaType==='video'?'Видео':'Фото',
  structure:'1 элем.',previewUrl:components[0].previewUrl,collectionId:first.id,collectionName:first.name,
  containers:refs.map(ref=>({platform:'layers',kind:'COLLECTION',id:ref.id,name:ref.name,parentId:'',parentName:''})),
  collectionOccurrences:refs.map(ref=>({occurrenceId:`${ref.id}:${postId}`,collectionId:ref.id,collectionName:ref.name,
   collectionType:'COLLECTION',parentId:'',parentName:'',isDuplicate:false}))};
}
export async function discoverLayers(options,{session=withLayersSession,request=requestLayers}={}){
 const target=options.targetUrl?layersTarget(options.targetUrl):null,collections=target?[]:(options.collections||[]).map(layersCollection);
 const mode=options.searchMode||'smart',known=mode==='full'?[]:[...(options.knownPostIds||[])].map(id=>String(id).match(/^layers:([a-z0-9]{10,40})$/)?.[1]).filter(Boolean);
 const limit=mode==='recent'?Math.max(1,Math.trunc(Number(options.limit)||1)):0;
 return session(options,async next=>{
  await options.control?.checkpoint();throwIfAborted(options.signal);
  const data=await request({operation:'discover',target,collections,perFolder:!!collections.length,known,limit,stopId:options.stopLink?.publicationId||''},
   {...next,onProgress:count=>options.onProgress?.({stage:'discover',found:count,collection:'Layers'})});
  throwIfAborted(options.signal);if(!Array.isArray(data.posts))throw layersFailure('LAYERS_RESPONSE');
  return {...data,posts:data.posts.map(normalizeLayers)};
 });
}
export async function listLayersCollections(options,{session=withLayersSession,request=requestLayers}={}){
 return session(options,async next=>{
  const data=await request({operation:'catalog'},next);if(!Array.isArray(data.containers))throw layersFailure('LAYERS_RESPONSE');
  const result=data.containers.map(layersCollection);options.onProgress?.({found:result.length,total:result.length});return result;
 });
}
export const downloadLayers=(options,deps)=>downloadDirectMedia(options,{code:'layers',title:'Layers',target:layersTarget,mediaUrl:layersMediaUrl,failure:layersFailure,extensions},deps);
export default {code:'layers',title:'Layers.to',icon:'layers',ready:true,needsAccount:false,sourceModes:['browser'],singleMediaOnly:true,
 containerTypes:['ROOT','COLLECTION'],containerLabels:{root:'Сохранённые коллекции',level1:'Коллекция',level2:'Коллекция'},
 defaultTags:['Layers'],nameMarker:'layorder',jobPrefix:'layers',urlPattern:/(?:^|\/\/)(?:www\.)?layers\.to\//i,
 discover:discoverLayers,download:downloadLayers,listContainers:listLayersCollections,probe:probeLayers};
