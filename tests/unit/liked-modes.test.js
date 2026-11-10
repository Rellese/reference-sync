import test from 'node:test';import assert from 'node:assert/strict';
import {searchSettings,effectiveFolderSearch} from '../../js/source-link.js';
import {registerSource,getSource} from '../../js/sources/registry.js';
import instagram from '../../js/sources/instagram.js';import behance from '../../js/sources/behance.js';import layers from '../../js/sources/layers.js';import dribbble from '../../js/sources/dribbble.js';import x from '../../js/sources/x.js';import vimeo from '../../js/sources/vimeo.js';import pinterest from '../../js/sources/pinterest.js';
import {knownForScenario,recordCreatedEagleItems,recordDiscoveredFeed,serializeImportRecords,parseImportRecords,reconcileImportRecords,selectImportablePosts} from '../../js/import-registry.js';
import {discoverInstagramLiked} from '../../js/sources/instagram-liked.js';
import {collectBehanceLiked} from '../../js/sources/behance-liked.js';
import {discoverLayers} from '../../js/sources/layers.js';import {discoverDribbble} from '../../js/sources/dribbble.js';import {discoverX} from '../../js/sources/x.js';import {discoverVimeo} from '../../js/sources/vimeo.js';
for(const source of [instagram,behance,layers,dribbble,x,vimeo,pinterest])registerSource(source);
for(const platform of ['instagram','behance','layers','dribbble','x','vimeo'])test(platform+' Likes ignores stale account/link/archive/folders without overwriting Saved preferences',()=>{
 const original={platform,downloadMode:'liked',source:'meta',username:'another-account',sourceUrl:'invalid-stale',folderSearch:true,searchMode:'recent',stopLinkEnabled:true};
 const s=searchSettings(original);assert.equal(s.source,'browser');assert.equal(s.username,'');assert.equal(s.targetUrl,'');assert.equal(s.folderSearch,false);assert.equal(s.searchMode,'recent');assert.equal(s.stopLinkEnabled,true);assert.equal(effectiveFolderSearch(original),false);
 assert.equal(original.source,'meta');assert.equal(original.username,'another-account');assert.equal(original.folderSearch,true);assert.equal(typeof getSource(platform).discoverLiked,'function');
});
test('Pinterest has no fabricated heart history capability',()=>{assert.equal(getSource('pinterest').discoverLiked,null);assert.throws(()=>searchSettings({platform:'pinterest',downloadMode:'liked'}));});
test('shared import IDs survive cold reload while Saved and Likes boundaries stay separate',()=>{
 const entry=(id,mode)=>({id:'eagle-'+id,item:{postId:id,component:0,componentCount:1,discoveryMode:mode}});
 let records=recordCreatedEagleItems(new Map(),[entry('shared','saved'),entry('liked-only','liked')]);
 records.set('legacy',{componentCount:1,components:new Map([['0','eagle-legacy']])});
 records=parseImportRecords(serializeImportRecords(records));const live=reconcileImportRecords(records,[{id:'eagle-shared'},{id:'eagle-liked-only'},{id:'eagle-legacy'}]);
 assert.deepEqual([...knownForScenario(live.knownPostIds,live.records||live.reconciledRecords,'liked')],['liked-only']);
 assert.equal(selectImportablePosts([{postId:'shared'}],new Set(['shared']),live.knownPostIds).length,0);
 const updated=recordDiscoveredFeed(records,live.knownPostIds,[{postId:'shared'}],'liked');
 assert.ok(knownForScenario(live.knownPostIds,parseImportRecords(serializeImportRecords(updated)),'liked').has('shared'));assert.deepEqual(records.get('shared').feeds,['saved']);
 assert.ok(!knownForScenario(live.knownPostIds,records,'saved').has('liked-only'));
});
test('partial and deleted components cannot establish a Likes boundary',()=>{
 const records=new Map([['partial',{componentCount:2,components:new Map([['0','one']]),feeds:['liked']}],['deleted',{componentCount:1,components:new Map([['0','gone']]),feeds:['saved','liked']}] ]);
 const live=reconcileImportRecords(records,[{id:'one'},{id:'gone',isDeleted:true}]);assert.equal(knownForScenario(live.knownPostIds,records,'liked').size,0);
 const updated=recordDiscoveredFeed(records,live.knownPostIds,[{postId:'partial'}],'saved');assert.deepEqual(updated.get('partial').feeds,['liked']);
});
const session=async(o,a)=>a({...o,cookieFile:'private-fixture'});
for(const [code,discover] of [['layers',discoverLayers],['dribbble',discoverDribbble],['x',discoverX]])for(const mode of ['full','smart','recent'])test(`${code} Likes ${mode} targets own feed and excludes folder/link preferences`,async()=>{
 let spec;await discover({downloadMode:'liked',targetUrl:'invalid',collections:[{id:'invalid'}],searchMode:mode,limit:15,knownPostIds:[code+':2'],stopLink:{publicationId:'3'}},{session,request:async s=>{spec=s;return {posts:[]};}});
 assert.equal(spec.feed,'liked');assert.equal(spec.limit,mode==='recent'?15:0);assert.equal(spec.stopId,'3');assert.equal(spec.folder||'', '');assert.equal(spec.target||null,null);assert.equal(spec.perFolder||false,false);assert.deepEqual(spec.collections||[],[]);assert.equal(spec.known.length,mode==='full'||code==='layers'?0:1);
});
test('Vimeo Likes always uses /me/likes and leaves the Saved default intact',async()=>{
 let spec;await discoverVimeo({downloadMode:'liked',targetUrl:'invalid',collections:[{id:'invalid'}],searchMode:'recent',limit:15},{session,request:async s=>{spec=s;return {posts:[]};}});assert.equal(spec.resource,'/me/likes');assert.equal(spec.limit,15);
});
test('Instagram accepted Likes use the same post detail importer, preserving ID/caption/carousel',async()=>{
 let options;const result=await discoverInstagramLiked({username:'stale',targetUrl:'invalid',collections:['bad'],searchMode:'recent',limit:2},{session,request:async spec=>{assert.equal(spec.limit,2);return {posts:[{id:'123',code:'syntheticCode'}],stopLinkReached:true};},detail:async o=>{options=o;return {posts:[{postId:'123',description:'caption',components:[{index:1},{index:2}],componentCount:2}]};}});
 assert.equal(options.username,'');assert.equal(options.targetUrl,'https://www.instagram.com/p/syntheticCode/');assert.deepEqual(options.collections,[]);assert.equal(options.cookieFile,'private-fixture');assert.equal(result.posts[0].componentCount,2);assert.equal(result.posts[0].description,'caption');assert.deepEqual(result.posts[0].collectionOccurrences,[]);assert.equal(result.stopLinkReached,true);
});
test('Instagram Likes aborts before detail and rejects a mismatching publication',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(discoverInstagramLiked({signal:controller.signal},{session,request:async()=>({posts:[{id:'123',code:'abc'}]}),detail:async()=>calls++}),{code:'JOB_STOPPED'});assert.equal(calls,0);
 await assert.rejects(discoverInstagramLiked({},{session,request:async()=>({posts:[{id:'123',code:'abc'}]}),detail:async()=>({posts:[{postId:'456'}]})}),{code:'INSTAGRAM_LIKED_RESPONSE'});
});
const page=(data)=>'<script id="beconfig-store_state">'+JSON.stringify(data)+'</script>';
function behanceReader({repeat=false,foreign=false}={}){let calls=[];return {calls,read:async(url,options)=>{calls.push(url);if(url==='https://www.behance.net/')return page({user:{loggedInUser:{username:'collector'}}});if(url.includes('/appreciated'))return page({user:{loggedInUser:{username:foreign?'other':'collector'}},profile:{activeSection:{appreciations:{appreciations:[{id:1,url:'https://www.behance.net/gallery/1/a'}],hasMore:true,cursor:'c1'}}}});assert.equal(options.json.variables.username,'collector');return JSON.stringify({data:{user:{appreciatedProjects:{nodes:[{id:repeat?1:2}],pageInfo:{hasNextPage:repeat,endCursor:'c1'}}}}});}};}
test('Behance Likes follows only own Appreciations connection and respects N/known/Stop before pagination',async()=>{
 const full=behanceReader();assert.equal((await collectBehanceLiked({searchMode:'full'},full.read)).urls.length,2);assert.equal(full.calls.length,3);
 for(const opts of [{searchMode:'recent',limit:1},{searchMode:'smart',knownPostIds:['case:v1:behance:1']},{searchMode:'full',stopLink:{sourceCode:'behance',publicationId:'1',ok:true,originalUrl:'https://www.behance.net/gallery/1/a'}}]){const r=behanceReader();const d=await collectBehanceLiked(opts,r.read);assert.equal(r.calls.length,2);assert.equal(d.urls.length,opts.limit?1:0);}
 await assert.rejects(collectBehanceLiked({},behanceReader({repeat:true}).read));await assert.rejects(collectBehanceLiked({},behanceReader({foreign:true}).read));
});
test('whole Behance case IDs register a second feed without copying its separate blocks',()=>{
 const id='case:v1:behance:123',records=new Map([[id,{componentCount:1,components:new Map([['0','case-file']])}]]);
 const updated=recordDiscoveredFeed(records,new Set([id]),[{postId:'behance:123',source:'behance'}],'liked');assert.deepEqual(updated.get(id).feeds,['saved','liked']);assert.equal(updated.has('behance:123'),false);
});
