import {withDribbbleSession,requestDribbble,probeDribbble,dribbbleFailure} from './dribbble-session.js';
import {dribbbleTarget,dribbbleCollection,dribbbleMediaUrl} from './dribbble-target.js';
import {downloadDirectMedia} from './direct-media.js';
import {throwIfAborted} from '../job-control.js';
const extensions=['jpg','jpeg','png','webp','gif','avif','mp4','webm','mov'];
function discoveryFailures(items,options){
 if(!Array.isArray(items))throw dribbbleFailure('DRIBBBLE_RESPONSE');
 return items.map(item=>{
  const value=dribbbleTarget(item.url);
  if(value.type!=='POST'||value.id!==String(item.id)||item.code!=='DRIBBBLE_FORMAT')throw dribbbleFailure('DRIBBBLE_RESPONSE');
  const failure={url:value.url,code:item.code,message:dribbbleFailure(item.code).message};
  options.onLog?.(`Не прочитано: ${failure.url} — ${failure.message}`);return failure;
 });
}
export function normalizeDribbble(item){
 const id=String(item.id||''),target=dribbbleTarget(item.url),author=String(item.author||'');
 if(target.type!=='POST'||target.id!==id||!/^[A-Za-z0-9_-]{1,80}$/.test(author)||!item.title||!Array.isArray(item.components)||!item.components.length)throw Error('DRIBBBLE_RESPONSE');
 const components=item.components.map((c,i)=>{
  if(c.index!==i+1||!['image','video'].includes(c.mediaType)||!extensions.includes(c.extension))throw Error('DRIBBBLE_RESPONSE');
  return {...c,url:dribbbleMediaUrl(c.url),previewUrl:c.previewUrl?dribbbleMediaUrl(c.previewUrl):'',description:String(c.description||'')};
 });
 const refs=(item.collections||[]).map(ref=>{
  const value=dribbbleTarget(ref.url);
  if(!['COLLECTION','POST'].includes(value.type)||value.id!==String(ref.id))throw Error('DRIBBBLE_RESPONSE');
  return {...value,name:String(ref.name||value.name)};
 });
 const postId='dribbble:'+id,title=String(item.title),first=refs[0]||(item.feed==='liked'?{id:'liked',name:'Понравившиеся публикации'}:{id:'link',name:'Dribbble'});
 return {source:'dribbble',postId,externalId:id,shortcode:id,url:target.url,username:'@'+author,plainUsername:author,
  title,namingName:title,useComponentDescriptions:true,description:String(item.description||''),
  introDescription:String(item.introDescription||''),takenAt:0,
  components,selectedComponents:components.map(c=>c.index),componentCount:components.length,
  type:components.length>1?'Карусель':components[0].mediaType==='video'?'Видео':'Фото',
  structure:components.length+' элем.',previewUrl:components[0].previewUrl,
  collectionId:first.id,collectionName:first.name,
  containers:refs.map(ref=>({platform:'dribbble',kind:'COLLECTION',id:ref.id,name:ref.name,parentId:'',parentName:''})),
  collectionOccurrences:refs.map(ref=>({occurrenceId:`${ref.id}:${postId}`,collectionId:ref.id,collectionName:ref.name,
   collectionType:'COLLECTION',parentId:'',parentName:'',isDuplicate:false}))};
}
export async function discoverDribbble(options,{session=withDribbbleSession,request=requestDribbble}={}){
 const liked=options.downloadMode==='liked',target=!liked&&options.targetUrl?dribbbleTarget(options.targetUrl):null;
 const collections=liked||target?[]:(options.collections||[]).map(dribbbleCollection);
 const mode=options.searchMode||'smart';
 const known=mode==='full'?[]:[...(options.knownPostIds||[])].map(id=>String(id).match(/^dribbble:(\d+)$/)?.[1]).filter(Boolean);
 const limit=mode==='recent'?Math.max(1,Math.trunc(Number(options.limit)||1)):0;
 return session(options,async next=>{
  await options.control?.checkpoint();throwIfAborted(options.signal);
  let data;
  try{data=await request({operation:'discover',feed:liked?'liked':'saved',target,collections,perFolder:!!collections.length,known,limit,stopId:options.stopLink?.publicationId||''},
   {...next,onProgress:(count)=>options.onProgress?.({stage:'discover',found:count,collection:'Dribbble'})});}
  catch(error){if(error.discoveryFailures)discoveryFailures(error.discoveryFailures,options);throw error;}
  throwIfAborted(options.signal);
  if(!Array.isArray(data.posts))throw dribbbleFailure('DRIBBBLE_RESPONSE');
  const failures=discoveryFailures(data.failures||[],options);
  if(data.interruption){
   const {code,url}=data.interruption;
   if(!['DRIBBBLE_CHALLENGE','DRIBBBLE_AUTH','DRIBBBLE_RATE_LIMIT','DRIBBBLE_NETWORK','DRIBBBLE_HTTP_502','DRIBBBLE_HTTP_503','DRIBBBLE_HTTP_504'].includes(code)||url&&dribbbleTarget(url).type!=='POST')throw dribbbleFailure('DRIBBBLE_RESPONSE');
   options.onLog?.(`Поиск прерван: ${url?dribbbleTarget(url).url+' — ':''}${dribbbleFailure(code).message}`);
  }
  return {...data,failures,posts:data.posts.map(normalizeDribbble)};
 });
}
export async function listDribbbleCollections(options,{session=withDribbbleSession,request=requestDribbble}={}){
 return session(options,async next=>{
  const data=await request({operation:'catalog'},next);
  if(!Array.isArray(data.containers))throw dribbbleFailure('DRIBBBLE_RESPONSE');
  const result=data.containers.map(dribbbleCollection);options.onProgress?.({found:result.length,total:result.length});return result;
 });
}
export const downloadDribbble=(options,deps)=>downloadDirectMedia(options,{code:'dribbble',title:'Dribbble',target:dribbbleTarget,mediaUrl:dribbbleMediaUrl,failure:dribbbleFailure,extensions},deps);
export default {code:'dribbble',title:'Dribbble',icon:'dribbble',ready:true,needsAccount:false,sourceModes:['browser'],
 containerTypes:['ROOT','COLLECTION'],containerLabels:{root:'Сохранённые коллекции',level1:'Коллекция',level2:'Коллекция'},
 defaultTags:['Dribbble'],nameMarker:'driborder',jobPrefix:'dribbble',urlPattern:/(?:^|\/\/)(?:www\.)?dribbble\.com\//i,
 discover:discoverDribbble,discoverLiked:options=>discoverDribbble({...options,downloadMode:'liked'}),download:downloadDribbble,listContainers:listDribbbleCollections,probe:probeDribbble};
