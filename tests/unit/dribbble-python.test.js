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
function configShot(id,{wrongId=false,malformed=false}={}){
 const html=modern(id,{placeholder:true});
 const state=JSON.parse(html.match(/window\.__INITIAL_STATE__=(.*);<\/script>/)[1]);
 const literal=malformed?'JSON.parse("untrusted")':JSON.stringify({shotId:wrongId?Number(id)+1:Number(id),contentBlocks:state.props.contentBlocks});
 return html.replace(/<script>window\.__INITIAL_STATE__=.*;<\/script>/,
  '<script>var config = Dribbble.JsConfig || {};\nDribbble.JsConfig = Object.assign(config, {\n shotData: '+literal+'\n});</script>');
}
function slideshowShot({missing=false,wrongType=false,duplicatePosition=false,foreignMedia=false}={}){
 let html=modern(1);const state=JSON.parse(html.match(/window\.__INITIAL_STATE__=(.*);<\/script>/)[1]);
 const block=state.props.contentBlocks.results.find(b=>b.id===104);block.contentType='slideshow';
 block.content={slides:[{mediaId:'c',position:2},{mediaId:'a',position:0},{mediaId:'b',position:duplicatePosition?0:1}],
  media:['a','b','c'].map(id=>({id,type:id==='b'?'video':'image',fileExtension:id==='b'?'mp4':'png'}))};
 if(wrongType)block.content.media[1].type='image';if(foreignMedia)block.content.media[0].id='foreign';
 const render=['a','b','c'].slice(0,missing?2:3).map(id=>'<div class="block-media-wrapper">'+(id==='b'?'<video src="https://cdn.dribbble.com/userupload/1/file/b.mp4"></video>':`<img data-src="https://cdn.dribbble.com/userupload/1/file/${id}.png?resize=100x">`)+'</div>').join('');
 html=html.replace(/<div data-test="content-block-104">.*?<\/div>/,'<div data-test="content-block-104"><div data-test="base-carousel">'+render+'</div><div class="thumbnails-list"><img src="https://cdn.dribbble.com/userupload/1/file/a.png?resize=24x"></div></div>');
 return html.replace(/window\.__INITIAL_STATE__=.*;<\/script>/,'window.__INITIAL_STATE__='+JSON.stringify(state)+';</script>');
}
function uploadsShot({slides=false,missing=false,foreign=false,mismatch=false}={}){
 const html=slides?slideshowShot():modern(1),state=JSON.parse(html.match(/window\.__INITIAL_STATE__=(.*);<\/script>/)[1]);
 for(const block of state.props.contentBlocks.results){
  if(block.contentType==='text')continue;
  const media=block.contentType==='slideshow'?block.content.media:[{id:'media-'+block.id,type:block.contentType,fileExtension:block.contentType==='video'?'mp4':'jpg'}];
  block.content.media=media;if(block.contentType!=='slideshow')block.content.mediaId=media[0].id;
  media.forEach(m=>{m.shrineCacheId='cache-'+m.id;});
  block.userUploadsAttributes=media.map(m=>({shrineCacheId:m.shrineCacheId,
   originalUrl:`https://${foreign?'evil.test':'cdn.dribbble.com'}/userupload/1/file/${m.id}.${m.fileExtension}`,
   stillUrl:`https://cdn.dribbble.com/userupload/1/file/${m.id}.png?resize=80x`}));
 }
 const block=state.props.contentBlocks.results.find(b=>b.id===104);
 if(missing)block.userUploadsAttributes.pop();if(mismatch)block.content.media[0].shrineCacheId='foreign';
 // Lazy/virtualized media has not appeared in the DOM; JSON is authoritative.
 return nav+'<h1 class="shot-header__title">Shared title</h1><a class="user-sticky-header__avatar" href="/artist"></a><div id="ssr-app"></div><script>window.__INITIAL_STATE__='+JSON.stringify(state)+';</script>';
}
const curl=String.raw`
import json,os,urllib.parse,time,threading
fixture=json.load(open(os.environ['DRIB_FIXTURE']))
class Response:
 def __init__(self,value):
  self.status_code=value.get('status',200);self.headers={'Content-Type':'text/html',**value.get('headers',{})};self.text=value.get('html','');self.content=self.text.encode()
class Session:
 def __init__(self,**kwargs):pass
 def get(self,url,**kwargs):
  with open(os.environ['DRIB_CALLS'],'a') as file:file.write(json.dumps({'url':url,'redirects':kwargs.get('allow_redirects')})+'\n')
  value=fixture.get(url,{'status':404})
  if 'browserHTML' in value and os.environ.get('DRIB_REPLY'):
   def answer():
    for _ in range(100):
     time.sleep(.02)
     try:
      if json.load(open(os.environ['DRIB_REPLY']))!={}:continue
      json.dump({'url':url,'html':value['browserHTML']},open(os.environ['DRIB_REPLY'],'w'));return
     except (ValueError,FileNotFoundError):pass
   threading.Thread(target=answer,daemon=True).start()
  return Response(value)
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
  const reply=spec.browserReply?put('browser-reply.json','{}'):'',calls=path.join(root,'calls.jsonl'),file=put('spec.json',JSON.stringify({...spec,browserReply:reply||undefined,cookies}));
  const result=spawnSync('python3',['-c',dribbbleApiScript,file],{encoding:'utf8',env:{...process.env,PYTHONPATH:root,DRIB_FIXTURE:data,DRIB_CALLS:calls,DRIB_REPLY:reply},timeout:10000});
  assert.ifError(result.error);assert.ok(result.stdout.trim(),result.stderr);assert.ok(!result.stdout.includes('synthetic-private'));
  return {status:result.status,data:JSON.parse(result.stdout.trim().split('\n').pop()),calls:fs.existsSync(calls)?fs.readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse):[]};
 };
}
test('Dribbble 202 public shot can use bounded native HTML without executing site scripts in Python',t=>{
 const url='https://dribbble.com/shots/1-Shot',r=fixture(t,{[url]:{status:202,browserHTML:modern(1)}})({operation:'discover',target:{id:'1',type:'POST',name:'Link',url},browserReply:true});
 assert.equal(r.status,0,JSON.stringify(r.data));assert.equal(r.data.posts.length,1);assert.equal(r.data.posts[0].components.length,3);assert.equal(r.data.posts[0].components[0].description,'First\n\nMore');
});

for(const status of [200,202])test('Dribbble JsConfig shotData keeps ordered media/captions, HTTP '+status,t=>{
 const url='https://dribbble.com/shots/1-Shot',html=configShot(1);
 const r=fixture(t,{[url]:status===202?{status,browserHTML:html}:{html}})({operation:'discover',target:{id:'1',type:'POST',name:'Link',url},browserReply:status===202});
 assert.equal(r.status,0,JSON.stringify(r.data));const post=r.data.posts[0];assert.equal(post.introDescription,'Intro');
 assert.deepEqual(post.components.map(c=>[c.mediaType,c.description]),[['video','First\n\nMore'],['image','Second'],['image','']]);
 assert.ok(post.components[1].url.endsWith('/a.jpg'));
});
for(const [settings,error] of [[{wrongId:true},'DRIBBBLE_RESPONSE'],[{malformed:true},'DRIBBBLE_FORMAT']])test('JsConfig refuses foreign shot data and executable expressions: '+error,t=>{
 const url='https://dribbble.com/shots/1-Shot',r=fixture(t,{[url]:{html:configShot(1,settings)}})({operation:'discover',target:{id:'1',type:'POST',url}});
 assert.equal(r.status,1);assert.equal(r.data.error,error);
});
test('nested slideshow expands complete ordered media and shares its following caption, excluding thumbnails',t=>{
 const r=fixture(t,{'https://dribbble.com/shots/1-Shot':{html:slideshowShot()}})({operation:'discover',limit:1});
 assert.equal(r.status,0,JSON.stringify(r.data));const media=r.data.posts[0].components;
 assert.deepEqual(media.map(c=>[c.index,c.mediaType,c.description]),[[1,'video','First\n\nMore'],[2,'image','Second'],[3,'video','Second'],[4,'image','Second'],[5,'image','']]);
 assert.ok(media[1].url.endsWith('/a.png'));assert.ok(media[3].url.endsWith('/c.png'));assert.equal(new Set(media.map(c=>c.blockId)).size,5);
});
for(const slides of [false,true])test('complete original uploads are ordered without lazy DOM media, slideshow='+slides,t=>{
 const r=fixture(t,{'https://dribbble.com/shots/1-Shot':{html:uploadsShot({slides})}})({operation:'discover',limit:1});
 assert.equal(r.status,0,JSON.stringify(r.data));const post=r.data.posts[0];
 assert.deepEqual(post.components.map(c=>c.description),slides?['First\n\nMore','Second','Second','Second','']:['First\n\nMore','Second','']);
 if(slides)assert.deepEqual(post.components.slice(1,4).map(c=>c.url.split('/').pop()),['a.png','b.mp4','c.png']);
 assert.equal(post.introDescription,'Intro');assert.ok(post.components.every(c=>!c.url.includes('resize=')));
});
for(const options of [{missing:true},{mismatch:true},{foreign:true}])test('original uploads refuse missing/mismatched media or foreign hosts: '+JSON.stringify(options),t=>{
 const r=fixture(t,{'https://dribbble.com/shots/1-Shot':{html:uploadsShot({slides:true,...options})}})({operation:'discover',limit:1});
 assert.equal(r.status,1);assert.equal(r.data.error,options.foreign?'DRIBBBLE_MEDIA_URL':'DRIBBBLE_FORMAT');
});
test('one unsupported shot retains complete posts and counts toward recent N without extra metadata',t=>{
 const r=fixture(t,{'https://dribbble.com/shots/2-Shot':{html:modern(2,{badType:true})}})({operation:'discover',limit:2});
 assert.equal(r.status,0);assert.deepEqual(r.data.posts.map(p=>p.id),['1']);assert.equal(r.data.checked,2);
 assert.deepEqual(r.data.failures,[{id:'2',url:'https://dribbble.com/shots/2-Shot',code:'DRIBBBLE_FORMAT'}]);
 assert.ok(!r.calls.some(c=>c.url.includes('page=2')&&c.url.includes('/collections/10-')||c.url.includes('/shots/3-')||c.url.includes('/collections/20-')));
});
test('failed shots are not retried in another collection and remaining complete posts are retained',t=>{
 const r=fixture(t,{'https://dribbble.com/shots/2-Shot':{html:modern(2,{badType:true})}})({operation:'discover'});
 assert.equal(r.status,0);assert.deepEqual(r.data.posts.map(p=>p.id),['1','3','4']);assert.equal(r.data.failures.length,1);
 assert.equal(r.calls.filter(c=>c.url.includes('/shots/2-')).length,1);assert.equal(r.data.checked,4);
});
for(const status of [202,401,429,503])test('public access refusal '+status+' stops the queue but retains already complete shots',t=>{
 const r=fixture(t,{'https://dribbble.com/shots/2-Shot':{status}})({operation:'discover'});
 assert.equal(r.status,0);assert.deepEqual(r.data.posts.map(p=>p.id),['1']);assert.equal(r.data.checked,2);
 assert.deepEqual(r.data.interruption,{code:{202:'DRIBBBLE_CHALLENGE',401:'DRIBBBLE_AUTH',429:'DRIBBBLE_RATE_LIMIT',503:'DRIBBBLE_HTTP_503'}[status],url:'https://dribbble.com/shots/2-Shot'});
 assert.ok(!r.calls.some(c=>c.url.includes('/shots/3-')||c.url===collection(10).url+'?page=2'));
});
for(const options of [{missing:true},{wrongType:true},{duplicatePosition:true},{foreignMedia:true}])test('slideshow cannot publish incomplete, mismatched or ambiguous media: '+JSON.stringify(options),t=>{
 const r=fixture(t,{'https://dribbble.com/shots/1-Shot':{html:slideshowShot(options)}})({operation:'discover',limit:1});
 assert.equal(r.status,1);assert.equal(r.data.error,'DRIBBBLE_FORMAT');assert.equal(r.data.posts,undefined);
});
test('Dribbble native recovery cannot turn oversized HTML into a partial shot',t=>{
 const url='https://dribbble.com/shots/1-Shot',r=fixture(t,{[url]:{status:202,browserHTML:'x'.repeat(16*1024*1024+1)}})({operation:'discover',target:{id:'1',type:'POST',url},browserReply:true});
 assert.equal(r.data.error,'DRIBBBLE_CHALLENGE');
});
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
 assert.deepEqual(r.data.failures,[{id:'1',url:'https://dribbble.com/shots/1-Shot',code:'DRIBBBLE_FORMAT'}]);
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
