import {discoverThreads} from './threads.js';
import {withThreadsSession} from './threads-session.js';
import {archiveHttpsUrl} from '../authenticated-links.js';
import {throwIfAborted} from '../job-control.js';
// One selected-browser snapshot for the whole archive list; never cache it.
export async function resolveThreadsArchiveLinks(links,options,{session=withThreadsSession,discover=discoverThreads}={}) {
  const {settings,signal,onProgress,onResolved}=options,posts=[],failed=[];
  return session({...settings,signal},async next=>{
    for(const [index,link] of links.entries()) {
      throwIfAborted(signal);onProgress?.(index,links.length);
      try {
        const result=await discover({...next,targetUrl:archiveHttpsUrl(link.url,'threads'),downloadMode:'link',searchMode:'full',folderSearch:false,knownPostIds:new Set(),stopLink:null},
          {session:(_options,action)=>action(next)});
        if(result.failures?.length||result.interruption||result.posts.length!==1||result.posts[0].externalId!==link.publicationId)throw Object.assign(Error('THREADS_FORMAT'),{code:'THREADS_FORMAT'});
        const found=result.posts.map(post=>({...post,archiveLink:true}));
        await onResolved?.(link,found);posts.push(...found);
      }catch(error) {
        throwIfAborted(signal);
        if(!['THREADS_FORMAT','THREADS_RESPONSE'].includes(error.code))throw error;
        failed.push(link);
      }
    }
    onProgress?.(links.length,links.length);return {posts,failed};
  });
}
