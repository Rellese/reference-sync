import test from 'node:test';import assert from 'node:assert/strict';
import {buildNames} from '../../js/eagle-import.js';
import {caseRegistryId} from '../../js/case/download.js';
import {caseOutputName,caseNamingHistory} from '../../js/case/naming.js';
import {createNumberingProgress} from '../../js/numbering-progress.js';
import {rememberCounterHistory,counterHistorySeeds} from '../../js/numbering-history.js';
const global={id:'counter-1',mode:'global',start:4};
function project(id,count=23,modes={whole:true,blocks:false},selectedComponents=[]) {
 return {postId:`behance:${id}`,source:'behance',username:'@artist',type:'Карусель',description:`Description ${id}`,
  componentCount:count,components:Array.from({length:count},(_,index)=>({index:index+1,mediaType:'image'})),selectedComponents,
  caseSelection:modes,caseDocument:{source:{title:`Case ${id}`}}};
}
const generate=(posts,options={})=>buildNames({posts,selected:new Set(posts.map(p=>p.postId)),counters:[global],marker:'ref-',...options});
function itemsFor(post,names) {
 const items=[];
 if(names.caseName!==undefined)items.push({postId:caseRegistryId(post),sourcePostId:post.postId,importKind:'case',component:'0',
  name:caseOutputName({names}),numberingValues:names.caseCounterValues});
 for(const position of names.outputComponents)items.push({postId:post.postId,component:String(position),
  name:caseOutputName({names,componentIndex:position}),numberingValues:names.counterValuesByComponent[position]});
 return items;
}
test('three whole cases start at 4,5,6 regardless of internal block counts or remembered block selection',()=>{
 const posts=[project(1,23,undefined,[16]),project(2,41,undefined,[23]),project(3,66,undefined,[30])],generated=generate(posts);
 assert.deepEqual(posts.map(p=>generated.get(p.postId).caseName),['@artist ref-4','@artist ref-5','@artist ref-6']);
 assert.deepEqual(posts.map(p=>generated.get(p.postId).componentNames),[[],[],[]]);
 assert.deepEqual(posts.map(p=>generated.get(p.postId).name),['@artist ref-4','@artist ref-5','@artist ref-6']);
 let settings={numberingEnabled:true,counterOne:'global',counterOneStart:4};const advance=createNumberingProgress(settings,generated);
 for(const post of posts)for(const item of itemsFor(post,generated.get(post.postId)))settings={...settings,...advance(settings,item)};
 assert.equal(settings.counterOneStart,7);
});
test('three cases plus two separately selected blocks each use the consecutive sequence 1 to 9',()=>{
 const posts=[1,2,3].map(id=>project(id,30,{whole:true,blocks:true},[7,22]));
 const generated=generate(posts,{counters:[{...global,start:1}]});
 const items=posts.flatMap(post=>itemsFor(post,generated.get(post.postId)));
 assert.deepEqual(items.map(item=>item.name),Array.from({length:9},(_,i)=>`@artist ref-${i+1}`));
 assert.deepEqual(items.map(item=>item.importKind==='case'?'case':item.component),['case','6','21','case','6','21','case','6','21']);
 const names=generated.get(posts[0].postId);
 assert.equal(names.name,'@artist ref-1\n@artist ref-2\n@artist ref-3');
 let settings={numberingEnabled:true,counters:[{...global,start:1}]};const advance=createNumberingProgress(settings,generated);
 for(const item of items){settings={...settings,...advance(settings,item)};assert.deepEqual(advance(settings,item),{});}
 assert.equal(settings.counters[0].start,10);
});
test('explicit reverse direction reverses case groups while keeping the case before its blocks',()=>{
 const posts=[project(1,10,{whole:true,blocks:true},[3,8]),project(2,9,{whole:true,blocks:true},[2])];
 const generated=generate(posts,{counters:[{...global,independent:true,direction:'end',marker:'n-',destination:'name'}]});
 assert.equal(generated.get(posts[1].postId).name,'@artist n-4\n@artist n-5');
 assert.equal(generated.get(posts[0].postId).name,'@artist n-6\n@artist n-7\n@artist n-8');
});
test('independent forward counter and descriptions apply separately to case and individual blocks',()=>{
 const post=project(1,7,{whole:true,blocks:true},[2,5]);
 const names=generate([post],{counters:[{...global,independent:true,direction:'start',marker:'n-',destination:'both'}],
  descriptions:[{text:'Extra',placement:'start',destination:'description'}]}).get(post.postId);
 assert.equal(names.caseName,'@artist n-4');assert.equal(names.componentNames[1],'@artist n-5');
 assert.equal(names.caseDescription,'Extra\n\nDescription 1\n\nn-4');
 assert.equal(names.componentDescriptions[1],'Extra\n\nDescription 1\n\nn-5');
});
test('already imported case and nonmissing blocks do not reserve numbers in a retry',()=>{
 const post=project(1,8,{whole:true,blocks:true},[2,6]);
 const names=generate([post],{knownPostIds:new Set([caseRegistryId(post)]),missingComponents:new Map([[post.postId,new Set(['5'])]])}).get(post.postId);
 assert.equal(names.caseName,undefined);assert.equal(names.componentNames[1],undefined);assert.equal(names.componentNames[5],'@artist ref-4');
 assert.equal(names.name,'@artist ref-4');
});
test('an already imported block collection cannot consume numbers when only its case remains',()=>{
 const post=project(1,8,{whole:true,blocks:true},[2,6]);
 const names=generate([post],{knownPostIds:new Set([post.postId])}).get(post.postId);
 assert.equal(names.caseName,'@artist ref-4');assert.deepEqual(names.componentNames,[]);
});
test('only selected, distinct valid blocks get numbers, in source order rather than click order',()=>{
 const post=project(1,10,{whole:false,blocks:true},[8,3,8,99]);
 const names=generate([post]).get(post.postId);
 assert.equal(names.caseName,undefined);assert.equal(names.componentNames[2],'@artist ref-4');assert.equal(names.componentNames[7],'@artist ref-5');
 assert.equal(names.outputComponents.length,2);
});
test('noncontiguous source numbers map to actual block import positions',()=>{
 const post=project(1,3,{whole:true,blocks:true},[3,9]);post.components=[1,3,9].map(index=>({index,mediaType:'image'}));
 const names=generate([post]).get(post.postId);
 assert.equal(names.componentNames[1],'@artist ref-5');assert.equal(names.componentNames[2],'@artist ref-6');
});
test('carousel counter never numbers the internal files of a complete case',()=>{
 const post=project(1,20,{whole:true,blocks:true},[3,8]);
 const names=generate([post],{counters:[global,{id:'counter-2',mode:'carousel',start:1}]}).get(post.postId);
 assert.equal(names.caseName,'@artist ref-4');assert.equal(names.componentNames[2],'@artist ref-5-3');
 assert.equal(names.componentNames[7],'@artist ref-6-8');
});
test('unselected and disabled-numbering cases retain metadata without consuming counters',()=>{
 const posts=[project(1),project(2)],generated=generate(posts,{selected:new Set([posts[1].postId])});
 assert.equal(generated.get(posts[0].postId).name,'@artist');assert.equal(generated.get(posts[1].postId).name,'@artist ref-4');
 const disabled=generate(posts,{numberingEnabled:false});assert.equal(disabled.get(posts[0].postId).caseName,'@artist');
});
test('multiline edits map to case followed by chosen blocks, even with high block numbers',()=>{
 const post=project(1,30,{whole:true,blocks:true},[12,28]),names=generate([post]).get(post.postId);
 const nameOverride='Full case\nFirst block\nSecond block';
 assert.equal(caseOutputName({names,nameOverride}),'Full case');
 assert.equal(caseOutputName({names,nameOverride,componentIndex:11}),'First block');
 assert.equal(caseOutputName({names,nameOverride,componentIndex:27}),'Second block');
 assert.equal(caseOutputName({names,nameOverride:'All',componentIndex:27}),'All');
});
test('partial confirmations advance only received items and preserve manual resets',()=>{
 const post=project(1,10,{whole:true,blocks:true},[3,8]),generated=generate([post]),items=itemsFor(post,generated.get(post.postId));
 let settings={numberingEnabled:true,counters:[global]};const advance=createNumberingProgress(settings,generated);
 settings={...settings,...advance(settings,items[0])};assert.equal(settings.counters[0].start,5);
 assert.deepEqual(advance(settings,items[0]),{});
 settings={...settings,...advance(settings,items[1])};assert.equal(settings.counters[0].start,6);
 settings.counters[0].start=100;assert.deepEqual(advance(settings,items[2]),{});
});
test('author history continues across case confirmation and a later partial block retry',()=>{
 const counter={...global,mode:'author'},post=project(1,9,{whole:true,blocks:true},[2,7]);
 const generated=generate([post],{counters:[counter]}),items=itemsFor(post,generated.get(post.postId));
 let records=rememberCounterHistory({records:new Map(),platform:'behance',counters:[counter],...caseNamingHistory([{item:items[0]}],[post])});
 const seeds=counterHistorySeeds({records,platform:'behance',counters:[counter]});assert.equal(seeds['counter-1'].authors.artist,5);
 const retryPost={...post,caseSelection:{whole:false,blocks:true}};
 const retry=generate([retryPost],{counters:[counter],counterSeeds:seeds}).get(post.postId);
 assert.equal(retry.componentNames[1],'@artist ref-5');
 records=rememberCounterHistory({records,platform:'behance',counters:[counter],...caseNamingHistory(itemsFor(retryPost,retry).map(item=>({item})),[retryPost])});
 assert.equal(counterHistorySeeds({records,platform:'behance',counters:[counter]})['counter-1'].authors.artist,7);
});
test('legacy downloads without case item counters keep their existing history path',()=>{
 assert.equal(caseNamingHistory([],[project(1)]),null);
 assert.equal(caseNamingHistory([{item:{postId:'behance:1',component:'0'}}],[project(1)]),null);
});
