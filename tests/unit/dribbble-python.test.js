import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {dribbbleApiScript} from '../../js/sources/dribbble-python.js';
import {browserCookiesScript} from '../../js/sources/private-python.js';
const nav='<a class="site-nav-user__avatar-link" href="/collector"></a>';
const collection=(id)=>({id:String(id),name:'Folder '+id,url:`https://dribbble.com/collector/collections/${id}-Folder`});
const next=(href)=>`<a class="next_page" href="${href}">Next</a>`;
const grid=(ids)=>'<ol class="shots-grid">'+ids.map(id=>`<li id="screenshot-${id}"><a href="/shots/${id}-Shot">Shot</a><a href="/shots/${id}-Shot/bucketings/new">Save</a></li>`).join('')+'</ol>';
function modern(id,{badType=false,malformed=false,placeholder=false}={}){
 const defs=[['text','Intro'],['video',''],['text','First'],['text','More'],['image',''],['text','Second'],['image','']];
 const blocks=defs.map(([kind,text],position)=>({id:100+position,subjectId:Number(id),subjectType:'Screenshot',position,contentType:badType&&position===4?'embed':kind,content:kind==='text'?{text:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]}}:{}}));
 const rendered=defs.map(([kind],i)=>kind==='text'?'':`<div data-test="content-block-${100+i}">${kind==='video'?'<video src="https://cdn.dribbble.com/userupload/1/file/large-a.mp4" poster="https://cdn.dribbble.com/userupload/1/file/still-a.png"></video>':`<img ${placeholder?'src="data:image/png;base64,AA" data-src':'src'}="https://cdn.dribbble.com/userupload/${i}/file/a.jpg?resize=752x&amp;vertical=center">`}</div>`).join('');
 return nav+'<h1 class="shot-header__title">Shared title</h1><a class="user-sticky-header__avatar" href="/artist"></a><div id="ssr-app">'+rendered+'</div><script>window.__INITIAL_STATE__='+ (malformed?'invalid':JSON.stringify({props:{contentBlocks:{results:blocks.reverse()}}}))+';</script>';
}
const curl=String.raw`
import json,os,urllib.parse
fixture=json.load(open(os.environ['DRIB_FIXTURE']))
class Response:
 def __init__(self,value):
  self.status_code=value.get('status',200);self.headers={'Content-Type':'text/html',**value.get('headers',{})};self.text=value.get('html','');self.content=self.text.encode()
class Session:
 def __init__(self,**kwargs):pass
 def get(self,url,**kwargs):
  with open(os.environ['DRIB_CALLS'],'a') as file:file.write(json.dumps({'url':url,'redirects':kwargs.get('allow_redirects')})+'\n')
  return Response(fixture.get(url,{'status':404}))
`;
function fixture(t,overrides={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-drib-python-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=(name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value,{mode:0o600});return file;};
 put('curl_cffi/__init__.py','from . import requests\n');put('curl_cffi/requests.py',curl);
 const urls={
  'https://dribbble.com/dribbble/collections':{html:nav},
  'https://dribbble.com/collector/collections':{html:nav+'<ol class="collections-grid"><a href="/collector/collections/10-Folder">First 3 Shots</a></ol>'+next('/collector/collections?page=2')},
  'https://dribbble.com/collector/collections?page=2':{html:nav+'<ol class="collections-grid"><a href="/collector/collections/20-Folder">Second 2 Shots</a><a href="/other/collections/99-Foreign">Not ours</a></ol>'},
  [collection(10).url]:{html:nav+grid([1,2])+next('/collector/collections/10-Folder?page=2')},
  [collection(10).url+'?page=2']:{html:nav+grid([3])},
  [collection(20).url]:{html:nav+grid([2,4])},
  ...Object.fromEntries([1,2,3,4].map(id=>['https://dribbble.com/shots/'+id+'-Shot',{html:modern(id)}])),...overrides
 };
 const data=put('fixture.json',JSON.stringify(urls)),cookies=put('cookies.txt','# Netscape HTTP Cookie File\n.dribbble.com\tTRUE\t/\tTRUE\t0\tfixture\tsynthetic-private\n');
 return spec=>{
  const calls=path.join(root,'calls.jsonl'),file=put('spec.json',JSON.stringify({...spec,cookies}));
  const result=spawnSync('python3',['-c',dribbbleApiScript,file],{encoding:'utf8',env:{...process.env,PYTHONPATH:root,DRIB_FIXTURE:data,DRIB_CALLS:calls},timeout:10000});
  assert.ifError(result.error);assert.ok(result.stdout.trim(),result.stderr);assert.ok(!result.stdout.includes('synthetic-private'));
  return {status:result.status,data:JSON.parse(result.stdout.trim().split('\n').pop()),calls:fs.existsSync(calls)?fs.readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse):[]};
 };
}
test('Dribbble default searches all saved collections, pages, deduplicates and never reads Likes or Work',t=>{
 const r=fixture(t)({operation:'discover'});assert.equal(r.status,0);assert.deepEqual(r.data.posts.map(p=>p.id),['1','2','3','4']);
 assert.deepEqual(r.data.posts[1].collections.map(c=>c.id),['10','20']);assert.equal(r.calls.filter(c=>c.url.includes('/shots/2-')).length,1);
 assert.ok(r.calls.every(c=>!c.url.includes('/likes')&&!c.url.endsWith('/collector')&&c.redirects===false));
});
test('Dribbble catalog is paged and excludes other profiles',t=>{
 const r=fixture(t)({operation:'catalog'});assert.equal(r.status,0);assert.deepEqual(r.data.containers.map(c=>[c.id,c.name]),[['10','First'],['20','Second']]);
});
test('default recent N is a global cap and stops before more pages or shot metadata',t=>{
 const r=fixture(t)({operation:'discover',limit:1});assert.deepEqual(r.data.posts.map(p=>p.id),['1']);
 assert.ok(!r.calls.some(c=>c.url===collection(10).url+'?page=2'||c.url===collection(20).url||c.url.includes('/shots/2-')));
});
test('selected folders have independent recent N and do not fetch the full catalog',t=>{
 const r=fixture(t)({operation:'discover',limit:1,perFolder:true,collections:[collection(10),collection(20)]});
 assert.deepEqual(r.data.posts.map(p=>p.id),['1','2']);assert.ok(!r.calls.some(c=>c.url==='https://dribbble.com/collector/collections'));
});
for(const key of ['known','stopId'])test(`Dribbble excludes ${key} boundary before metadata`,t=>{
 const r=fixture(t)({operation:'discover',collections:[collection(10)],[key]:key==='known'?['2']:'2'});
 assert.deepEqual(r.data.posts.map(p=>p.id),['1']);assert.equal(r.data.stoppedEarly,true);assert.equal(r.data.stopLinkReached,key==='stopId');
 assert.ok(!r.calls.some(c=>c.url.includes('/shots/2-')||c.url===collection(10).url+'?page=2'));
});
test('Dribbble orders alternating media/text, attaches consecutive captions only to previous media, retains empty captions',t=>{
 const r=fixture(t)({operation:'discover',target:{id:'1',type:'POST',url:'https://dribbble.com/shots/1-Shot',name:'Shot'}});
 assert.equal(r.status,0);const p=r.data.posts[0];assert.equal(p.title,'Shared title');assert.equal(p.introDescription,'Intro');
 assert.deepEqual(p.components.map(c=>[c.index,c.mediaType,c.description]),[[1,'video','First\n\nMore'],[2,'image','Second'],[3,'image','']]);
 assert.equal(p.components[1].url,'https://cdn.dribbble.com/userupload/4/file/a.jpg');assert.ok(p.components[0].url.includes('large-a.mp4'));
});
test('lazy images use their real HTTPS source instead of a data placeholder',t=>{
 const r=fixture(t,{'https://dribbble.com/shots/1-Shot':{html:modern(1,{placeholder:true})}})({operation:'discover',limit:1});assert.equal(r.status,0);assert.ok(r.data.posts[0].components[1].url.endsWith('/a.jpg'));
});
test('legacy single media has its shot caption; an empty saved collection is valid',t=>{
 const legacy=nav+'<h1 class="shot-header__title">Old</h1><a class="user-sticky-header__avatar" href="/artist"></a><div class="shot-media-container"><img src="https://cdn.dribbble.com/users/1/a.gif"></div><div class="shot-description-container"><p>Old caption</p></div>';
 const r=fixture(t,{'https://dribbble.com/shots/1-Shot':{html:legacy}})({operation:'discover',limit:1});assert.equal(r.data.posts[0].components[0].description,'Old caption');
 assert.deepEqual(fixture(t,{[collection(10).url]:{html:nav+grid([])}})({operation:'discover',collections:[collection(10)]}).data.posts,[]);
});
for(const [label,value,code] of [
 ['challenge',{status:202},'DRIBBBLE_CHALLENGE'],['429',{status:429},'DRIBBBLE_RATE_LIMIT'],['signed out',{status:401},'DRIBBBLE_AUTH'],
 ['HTML login',{html:'<h1>Login</h1>'},'DRIBBBLE_AUTH'],['redirect HTTP',{status:302,headers:{Location:'http://dribbble.com/'}},'DRIBBBLE_URL'],
 ['redirect off-host',{status:302,headers:{Location:'https://evil.test/'}},'DRIBBBLE_URL'],['redirect another feed',{status:302,headers:{Location:'https://dribbble.com/other/collections'}},'DRIBBBLE_URL']
])test(`Dribbble rejects ${label} without exposing cookies`,t=>{
 const r=fixture(t,{'https://dribbble.com/dribbble/collections':value})({operation:'discover'});assert.equal(r.status,1);assert.equal(r.data.error,code);
});
for(const settings of [{badType:true},{malformed:true}])test('unsupported or malformed shot cannot silently lose media',t=>{
 const r=fixture(t,{'https://dribbble.com/shots/1-Shot':{html:modern(1,settings)}})({operation:'discover',limit:1});assert.equal(r.data.error,'DRIBBBLE_FORMAT');
});
test('pagination rejects repeat content and changed host/path',t=>{
 for(const html of [nav+grid([1,2]),nav+grid([3])+next('https://evil.test/a')]){
  const r=fixture(t,{[collection(10).url+'?page=2']:{html}})({operation:'discover',collections:[collection(10)]});assert.equal(r.data.error,html.includes('evil')?'DRIBBBLE_URL':'DRIBBBLE_PAGING');
 }
});
test('Dribbble cookies are scoped before export and exclude other social sessions',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-drib-scope-'));fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'yt_dlp'));fs.writeFileSync(path.join(root,'yt_dlp/__init__.py'),'');fs.writeFileSync(path.join(root,'yt_dlp/cookies.py'),'def extract_cookies_from_browser(*args,**kwargs):raise Exception()\n');
 const input=path.join(root,'input.txt'),output=path.join(root,'output.txt'),domains=['.dribbble.com','.www.dribbble.com','.x.com','.vimeo.com','.dribbble.com.evil.test'];
 fs.writeFileSync(input,'# Netscape HTTP Cookie File\n'+domains.map((d,i)=>`${d}\tTRUE\t/\tTRUE\t0\tfixture\tsynthetic-${i}`).join('\n')+'\n',{mode:0o600});fs.writeFileSync(output,'',{mode:0o600});
 const r=spawnSync('python3',['-c',browserCookiesScript,output,'file',input,'dribbble'],{encoding:'utf8',env:{...process.env,PYTHONPATH:root}});assert.equal(r.status,0,r.stderr);
 const data=fs.readFileSync(output,'utf8');assert.ok(data.includes('synthetic-0')&&data.includes('synthetic-1'));for(const i of [2,3,4])assert.ok(!data.includes('synthetic-'+i));
 if(process.platform!=='win32')assert.equal(fs.statSync(output).mode&0o777,0o600);
});

const fragment=ids=>grid(ids).replace('<ol class="shots-grid">','').replace('</ol>','');
test('Dribbble Likes follows the native AJAX fragment pager without reading Saved collections',t=>{
 const url='https://dribbble.com/collector/likes';
 const r=fixture(t,{[url]:{html:nav+grid([1,2])+'<a href="#" class="form-btn load-more">Load more work</a>'},[url+'?page=2&per_page=24']:{html:fragment([3])},[url+'?page=3&per_page=24']:{html:'  \n'}})({operation:'discover',feed:'liked'});
 assert.equal(r.status,0);assert.deepEqual(r.data.posts.map(p=>p.id),['1','2','3']);assert.ok(r.data.posts.every(p=>p.collections.length===0&&p.feed==='liked'));
 assert.ok(!r.calls.some(c=>c.url.includes('/collector/collections')));
});
for(const [spec,count] of [[{limit:1},1],[{known:['1']},0],[{stopId:'1'},0]])test('Dribbble Likes bound stops before AJAX pagination: '+JSON.stringify(spec),t=>{
 const url='https://dribbble.com/collector/likes';const r=fixture(t,{[url]:{html:nav+grid([1,2])+'<a class="load-more" href="#">Next</a>'}})({operation:'discover',feed:'liked',...spec});
 assert.equal(r.status,0);assert.equal(r.data.posts.length,count);assert.ok(!r.calls.some(c=>c.url.includes('per_page')));
});
for(const html of ['<html><form>Sign in</form></html>','Unauthorized','<div>challenge</div>',fragment([1,2])])test('Dribbble Likes does not mistake an error/repeated fragment for completion: '+html.slice(0,20),t=>{
 const url='https://dribbble.com/collector/likes';const r=fixture(t,{[url]:{html:nav+grid([1,2])+'<a class="load-more" href="#">Next</a>'},[url+'?page=2&per_page=24']:{html}})({operation:'discover',feed:'liked'});assert.equal(r.status,1);assert.ok(['DRIBBBLE_RESPONSE','DRIBBBLE_PAGING'].includes(r.data.error));
});

for(const field of ['known','stopId'])test('Dribbble default '+field+' boundary stops later collections, selected folders remain independent',t=>{
 const spec={operation:'discover',[field]:field==='known'?['1']:'1'};
 const global=fixture(t)(spec);assert.equal(global.data.posts.length,0);assert.equal(global.data.stoppedEarly,true);assert.ok(!global.calls.some(c=>c.url.includes('/collections/20-')));
 const selected=fixture(t)({...spec,collections:[collection(10),collection(20)],perFolder:true});assert.deepEqual(selected.data.posts.map(p=>p.id),['2','4']);
});

test('authenticated bootstrap scopes public collections even when their navbar is hydrated later',t=>{
 const r=fixture(t,{
  'https://dribbble.com/collector/collections':{html:'<ol class="collections-grid"><a href="/collector/collections/10-Folder">Folder 3 Shots</a></ol>'},
  [collection(10).url]:{html:grid([1,2])},
 })({operation:'discover',limit:2});
 assert.equal(r.status,0,JSON.stringify(r.data));assert.deepEqual(r.data.posts.map(p=>p.id),['1','2']);
 assert.ok(r.calls.every(c=>!c.url.includes('/other/')));
});
