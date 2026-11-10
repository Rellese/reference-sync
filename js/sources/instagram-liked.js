import {discoverSaved} from '../instagram.js';
import {runEnginePython} from '../toolchain.js';
import {throwIfAborted,makeStopError} from '../job-control.js';
import {withBrowserSession,requestPrivatePython} from './private-session.js';
import {instagramLikedScript} from './instagram-liked-python.js';
export function instagramLikedFailure(code){
 if(code==='JOB_STOPPED')return makeStopError();
 const message=code==='INSTAGRAM_LIKED_RATE_LIMIT'?'Instagram временно ограничил запросы во время поиска.'
 :code==='INSTAGRAM_LIKED_AUTH'?'Откройте раздел «Ваши действия → Отметки Нравится» Instagram в выбранном браузере и повторите поиск.'
 :'Не удалось прочитать понравившиеся публикации Instagram. Проверьте вход в выбранном браузере и повторите поиск.';
 return Object.assign(Error(message),{code:code==='INSTAGRAM_LIKED_RATE_LIMIT'?'INSTAGRAM_RATE_LIMITED':code});
}
export async function discoverInstagramLiked(options={},dependencies={}){
 const run=dependencies.run||runEnginePython,detail=dependencies.detail||discoverSaved;
 const session=dependencies.session||((o,action)=>withBrowserSession('instagram',o,action,run,instagramLikedFailure));
 const request=dependencies.request||((spec,o)=>requestPrivatePython('instagram',spec,o,run,instagramLikedScript,instagramLikedFailure));
 return session(options,async next=>{
  const list=await request({operation:'discover',limit:options.searchMode==='recent'?Math.max(1,Math.trunc(Number(options.limit)||1)):0,
   known:options.searchMode==='full'?[]:[...(options.knownPostIds||[])].map(String),stopCode:options.stopLink?.publicationId||''},
   {...next,onProgress:found=>options.onProgress?.({stage:'discover',found})});
  if(!Array.isArray(list.posts))throw instagramLikedFailure('INSTAGRAM_LIKED_RESPONSE');
  const posts=[];
  for(const entry of list.posts){
   await options.control?.checkpoint();throwIfAborted(options.signal);
   if(!/^\d{1,30}$/.test(entry.id)||!/^[-\w]{1,30}$/.test(entry.code))throw instagramLikedFailure('INSTAGRAM_LIKED_RESPONSE');
   const result=await detail({...next,username:'',targetUrl:`https://www.instagram.com/p/${entry.code}/`,collections:[],searchMode:'full',knownPostIds:new Set(),stopLink:null,onProgress:undefined});
   if(result.posts?.length!==1||String(result.posts[0].postId)!==entry.id)throw instagramLikedFailure('INSTAGRAM_LIKED_RESPONSE');
   posts.push({...result.posts[0],collectionId:'liked',collectionName:'Likes',collectionOccurrences:[],collectionRefs:[],feed:'liked'});
  }
  return {posts,checked:list.posts.length,stoppedEarly:!!list.stoppedEarly,stopLinkReached:!!list.stopLinkReached};
 });
}
