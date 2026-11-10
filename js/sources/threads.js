import {withThreadsSession,requestThreads,probeThreads,threadsFailure} from './threads-session.js';
import {threadsTarget,threadsMediaUrl} from './threads-target.js';
import {downloadDirectMedia} from './direct-media.js';
import {throwIfAborted} from '../job-control.js';
import {downloadMedia} from '../media-download.js';
import {nodeApi} from '../node-bridge.js';
const extensions=['jpg','jpeg','png','webp','gif','avif','heic','mp4'];
function reportFailures(failures,options){
  if(!Array.isArray(failures))throw threadsFailure('THREADS_RESPONSE');
  return failures.map(item=>{
    if(item.code!=='THREADS_FORMAT')throw threadsFailure('THREADS_RESPONSE');
    const url=threadsTarget(item.url).url;
    options.onLog?.(`Не скачано: ${url} — ${threadsFailure(item.code).message}`);
    return {code:item.code,url};
  });
}
export function normalizeThreads(item) {
  const target=threadsTarget(item.url),author=String(item.author || ''),id=String(item.id || '');
  if(target.id!==id || !/^[A-Za-z0-9_.]{1,80}$/.test(author) || !Array.isArray(item.components) || !item.components.length) throw threadsFailure('THREADS_RESPONSE');
  const components=item.components.map((c,i)=>{
    if(c.index!==i+1 || !['image','video'].includes(c.mediaType) || !extensions.includes(c.extension)) throw threadsFailure('THREADS_RESPONSE');
    return {...c,url:threadsMediaUrl(c.url),previewUrl:c.previewUrl?threadsMediaUrl(c.previewUrl):''};
  });
  const postId='threads:'+id,description=String(item.description || ''),title=description.split('\n')[0].slice(0,200)||author;
  const collectionId=item.feed==='liked'?'liked':item.feed==='link'?'link':'saved';
  const collectionName=collectionId==='liked'?'Понравившиеся публикации':collectionId==='link'?'Threads':'Сохранённые публикации';
  return {source:'threads',postId,externalId:id,shortcode:id,url:target.url,username:'@'+author,plainUsername:author,
    title,namingName:title,description,takenAt:Number(item.takenAt)||0,components,selectedComponents:components.map(c=>c.index),
    componentCount:components.length,type:components.length>1?'Карусель':components[0].mediaType==='video'?'Видео':'Фото',
    structure:components.length+' элем.',previewUrl:components[0].previewUrl,collectionId,collectionName,
    containers:[{platform:'threads',kind:'ROOT',id:collectionId,name:collectionName,parentId:'',parentName:''}],
    collectionOccurrences:[{occurrenceId:`${collectionId}:${postId}`,collectionId,collectionName,collectionType:'ROOT',parentId:'',parentName:'',isDuplicate:false}]};
}
export async function discoverThreads(options,{session=withThreadsSession,request=requestThreads}={}) {
  const liked=options.downloadMode==='liked',target=!liked&&options.targetUrl?threadsTarget(options.targetUrl):null;
  const mode=options.searchMode||'smart';
  const known=mode==='full'?[]:[...(options.knownPostIds||[])].map(id=>String(id).match(/^threads:([A-Za-z0-9_-]{5,40})$/)?.[1]).filter(Boolean);
  return session(options,async next=>{
    await options.control?.checkpoint();throwIfAborted(options.signal);
    let data;
    try{data=await request({operation:'discover',feed:liked?'liked':'saved',target,known,
      limit:mode==='recent'?Math.max(1,Math.trunc(Number(options.limit)||1)):0,stopId:options.stopLink?.publicationId||''},
    {...next,onProgress:count=>options.onProgress?.({stage:'discover',found:count,collection:'Threads'})});}
    catch(error){if(error.discoveryFailures)reportFailures(error.discoveryFailures,options);throw error;}
    throwIfAborted(options.signal);
    if(!Array.isArray(data.posts)) throw threadsFailure('THREADS_RESPONSE');
    if(data.skippedText)options.onLog?.(`Пропущено публикаций без фото и видео: ${data.skippedText}.`);
    const failures=reportFailures(data.failures||[],options);
    if(data.interruption){
      if(!['THREADS_AUTH','THREADS_RATE_LIMIT','THREADS_HTTP','THREADS_PAGING','THREADS_RESPONSE','THREADS_NETWORK'].includes(data.interruption.code))throw threadsFailure('THREADS_RESPONSE');
      options.onLog?.(`Поиск прерван: ${threadsFailure(data.interruption.code).message}`);
    }
    return {...data,failures,posts:data.posts.map(normalizeThreads)};
  });
}
export async function downloadThreads(options,deps={}) {
  const download=deps.download||downloadMedia,discover=deps.discover||discoverThreads,refreshed=new Map();let activePost;
  const next={...options,beforePost:async(post,...args)=>{activePost=post;await options.beforePost?.(post,...args);}};
  return downloadDirectMedia(next,{code:'threads',title:'Threads',target:threadsTarget,mediaUrl:threadsMediaUrl,failure:threadsFailure,extensions},
    {...deps,download:async(url,file,requestOptions)=>{
      try{return await download(url,file,requestOptions);}
      catch(error){
        if(!/^HTTP (401|403)$/.test(String(error.message)))throw error;
        // Signed CDN URLs can expire while a job is waiting or being restored.
        // Refresh this exact post once; never replace a missing carousel item.
        let pending=refreshed.get(activePost.postId);
        if(!pending){
          pending=(async()=>{
            const result=await discover({...options,targetUrl:activePost.url,downloadMode:'link',searchMode:'full',knownPostIds:new Set(),stopLink:null,onProgress:null});
            const fresh=result.posts?.[0];
            if(result.posts?.length!==1||fresh.postId!==activePost.postId||fresh.components.length!==activePost.components.length||
              fresh.components.some((c,i)=>c.index!==activePost.components[i].index||c.mediaType!==activePost.components[i].mediaType||c.extension!==activePost.components[i].extension))throw threadsFailure('THREADS_FORMAT');
            return fresh;
          })();
          refreshed.set(activePost.postId,pending);
        }
        const fresh=await pending;
        const index=Number(nodeApi.path.basename(file).split('.')[0]),component=fresh.components.find(c=>c.index===index);
        if(!component)throw threadsFailure('THREADS_FORMAT');
        return download(threadsMediaUrl(component.url),file,requestOptions);
      }
    }});
}
export default {code:'threads',title:'Threads',icon:'threads',ready:true,needsAccount:false,sourceModes:['browser','archive'],
  containerTypes:['ROOT'],containerLabels:{root:'Сохранённые публикации'},defaultTags:['Threads'],nameMarker:'throrder',jobPrefix:'threads',
  urlPattern:/(?:^|\/\/)(?:www\.)?threads\.(?:com|net)\//i,
  discover:discoverThreads,discoverLiked:options=>discoverThreads({...options,downloadMode:'liked'}),download:downloadThreads,probe:probeThreads};
