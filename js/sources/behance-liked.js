import {assertMatchingAccount} from '../session-account.js';
import {throwIfAborted} from '../job-control.js';
import {postMatchesStopLink} from '../stop-link.js';
import {parseBehancePage,readBehancePage} from './behance-collections.js';
import {validateSourceLink} from '../source-link.js';
const invalid=()=>Error('Не удалось прочитать понравившиеся проекты Behance. Проверьте вход в выбранном браузере и повторите поиск.');
// The website's GetAppreciatedProjects connection, restricted to the signed-in owner.
export async function collectBehanceLiked(options,read=readBehancePage){
 const home=parseBehancePage(await read('https://www.behance.net/',options)),user=home.user?.loggedInUser;
 assertMatchingAccount({username:user?.username,authenticated:!!user?.username,status:user?'unknown':'signed-out'},
  {platform:'behance',title:'Behance',browser:options.browser});
 const username=String(user.username),url='https://www.behance.net/'+encodeURIComponent(username)+'/appreciated';
 const initial=parseBehancePage(await read(url,options));
 if(initial.user?.loggedInUser?.username!==username)throw invalid();
 let page=initial.profile?.activeSection?.appreciations;
 const urls=[],seen=new Set(),cursors=new Set();
 const mode=options.searchMode||'smart',limit=mode==='recent'?Math.max(1,Math.trunc(Number(options.limit)||1)):0;
 const known=new Set(mode==='full'?[]:[...(options.knownPostIds||[])].map(id=>String(id).replace(/^case:v1:/,'')));
 for(let count=0;count<10000;count++){
  await options.control?.checkpoint();throwIfAborted(options.signal);
  if(!Array.isArray(page?.appreciations)||typeof page.hasMore!=='boolean')throw invalid();
  let added=0;
  for(const item of page.appreciations){
   const id=String(item.id||'');if(!/^\d+$/.test(id))throw invalid();
   const candidate=validateSourceLink('behance',item.url||`https://www.behance.net/gallery/${id}/a`);
   if(new URL(candidate).pathname.match(/^\/gallery\/(\d+)(?:\/|$)/)?.[1]!==id)throw invalid();
   const projectUrl=`https://www.behance.net/gallery/${id}/a`;
   const reached=postMatchesStopLink({source:'behance',postId:'behance:'+id,url:projectUrl},options.stopLink);
   if(reached||known.has('behance:'+id))return {urls,stoppedEarly:true,stopLinkReached:reached};
   if(seen.has(id))continue;seen.add(id);added++;urls.push(projectUrl);
   if(limit&&urls.length>=limit)return {urls,stoppedEarly:false,stopLinkReached:false};
  }
  if(!page.hasMore)return {urls,stoppedEarly:false,stopLinkReached:false};
  const cursor=page.cursor;
  if(!added||typeof cursor!=='string'||!cursor||cursor.length>8192||cursors.has(cursor))throw invalid();
  cursors.add(cursor);
  const next=JSON.parse(await read('https://www.behance.net/v3/graphql',{...options,json:{
   query:'query GetAppreciatedProjects($username: String, $after: String) { user(username: $username) { appreciatedProjects(first: 24, after: $after) { nodes { id url } pageInfo { endCursor hasNextPage } } } }',
   variables:{username,after:cursor},
  }}));
  const connection=next.data?.user?.appreciatedProjects;if(next.errors||!connection)throw invalid();
  page={appreciations:connection.nodes,hasMore:connection.pageInfo?.hasNextPage,cursor:connection.pageInfo?.endCursor};
 }
 throw invalid();
}
