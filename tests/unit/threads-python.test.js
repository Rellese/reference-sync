import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {threadsScript} from '../../js/sources/threads-python.js';
const fakeCurl=String.raw`
import json,os,urllib.parse
settings=json.load(open(os.environ['THREADS_FIXTURE']))
def media(n,kind=1):
 p={'code':'Code_'+str(n),'pk':str(n),'user':{'username':'artist'},'media_type':kind,'caption':{'text':'Caption '+str(n)},'taken_at':1000,'image_versions2':{'candidates':[{'url':'https://scontent.cdninstagram.com/a.jpg','width':100,'height':100},{'url':settings.get('mediaUrl') or 'https://scontent.cdninstagram.com/b.jpg','width':200,'height':200}]}}
 if kind==2:p['video_versions']=[{'url':'https://video.fbcdn.net/video.mp4'}]
 if kind==8:
  p['carousel_media']=[media(21),media(22,2)];p['carousel_media_count']=3 if settings.get('incomplete') else 2
 if settings.get('missingVideo') and kind==2:p['video_versions']=[]
 if settings.get('allBad'):p['media_type']=99
 return p
def conn(second=False):
 items=[media(1,2),media(2,8),media(3,19)] if not second else [media(2,8),media(4)]
 if settings.get('repeat') and second:items=[media(1,2)]
 return {'edges':[{'node':{'thread_items':[{'post':p}]}} for p in items],'page_info':{'end_cursor':'p1' if not second else 'p2','has_next_page':not second or bool(settings.get('repeat'))}}
class Response:
 def __init__(self,text,status=200,headers=None):self.text=text;self.status_code=status;self.headers=headers or {}
 def iter_content(self,**kwargs):yield self.text.encode()
 def close(self):pass
class Session:
 def __init__(self,**kwargs):self.auth='cookies' in kwargs
 def close(self):pass
 def request(self,method,url,**kwargs):
  p=urllib.parse.urlsplit(url);data=kwargs.get('data') or {};variables=json.loads(data.get('variables','{}'))
  with open(os.environ['THREADS_CALLS'],'a') as f:f.write(json.dumps({'method':method,'host':p.hostname,'path':p.path,'cookies':self.auth,'after':variables.get('after'),'provider':variables.get('fixtureProvider'),'redirects':kwargs.get('allow_redirects')})+'\n')
  if settings.get('status'):return Response('{}',settings['status'])
  if settings.get('redirect'):return Response('',302,{'Location':settings['redirect']})
  if p.hostname=='static.cdninstagram.com':
   name='BarcelonaLikedPageRefetchableQuery' if settings.get('liked') else 'BarcelonaSavedPageRefetchableQuery'
   return Response('__d("'+name+'_threadsRelayOperation",[],(function(t,n,r,o,a){a.exports="1234567890123"}),null);')
  if method=='POST':return Response(json.dumps({'data':{'xdt_text_app_viewer':{('liked_media' if settings.get('liked') else 'saved_media'):conn(True)}}}))
  name='BarcelonaLikedPageViewerQuery' if p.path.startswith('/liked') else 'BarcelonaSavedPageViewerQuery'
  field='liked_media' if p.path.startswith('/liked') else 'saved_media'
  if p.path.startswith('/t/') or '/post/' in p.path:result={'media':media(1,2)}
  else:result={'xdt_text_app_viewer':{field:conn()}}
  value={'define':[['BarcelonaSharedData',[],{'viewer':None if settings.get('signedOut') else {'username':'collector','id':'99'}}],['DTSGInitialData',[],{'token':'secret-fixture-dtsg'}]],'preload':{'preloaderID':'adp_'+name,'variables':{'fixtureProvider':True}},'payload':{'__bbox':{'result':{'data':result}}}}
  return Response('<script src="https://static.cdninstagram.com/bundle.js"></script><script type="application/json">'+json.dumps(value)+'</script>')
`;
function fixture(t,settings={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-threads-python-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=(name,text)=>{const f=path.join(root,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,text,{mode:0o600});return f;};
 put('curl_cffi/__init__.py','from . import requests\n');put('curl_cffi/requests.py',fakeCurl);
 const data=put('fixture.json',JSON.stringify(settings)),cookies=put('cookies.txt','# Netscape HTTP Cookie File\n.threads.com\tTRUE\t/\tTRUE\t0\tfixture\tprivate-fixture-cookie\n');
 return spec=>{
  const file=put('spec.json',JSON.stringify({...spec,cookies})),calls=path.join(root,'calls.jsonl');
  const r=spawnSync('python3',['-c',threadsScript,file],{encoding:'utf8',env:{...process.env,PYTHONPATH:root,THREADS_FIXTURE:data,THREADS_CALLS:calls},timeout:10000});assert.ifError(r.error);assert.ok(r.stdout.trim(),r.stderr);
  for(const value of ['secret-fixture-dtsg','private-fixture-cookie'])assert.ok(!r.stdout.includes(value));
  return {status:r.status,data:JSON.parse(r.stdout.trim().split('\n').pop()),calls:fs.existsSync(calls)?fs.readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse):[]};
 };
}
test('Threads full search reads all pages, keeps carousel order and descriptions, skips text and duplicate posts',t=>{
 const r=fixture(t)({operation:'discover',feed:'saved'});assert.equal(r.status,0);assert.deepEqual(r.data.posts.map(p=>p.id),['Code_1','Code_2','Code_4']);assert.equal(r.data.skippedText,1);assert.equal(r.data.checked,4);
 const carousel=r.data.posts[1];assert.deepEqual(carousel.components.map(c=>c.mediaType),['image','video']);assert.equal(carousel.description,'Caption 2');assert.ok(carousel.components[0].url.endsWith('/b.jpg'));
 const page=r.calls.find(c=>c.method==='POST');assert.equal(page.after,'p1');assert.equal(page.provider,true);assert.ok(r.calls.every(c=>c.redirects===false));assert.equal(r.calls.find(c=>c.host==='static.cdninstagram.com').cookies,false);
});
test('Threads recent N stops before loading pagination assets or a second page',t=>{const r=fixture(t)({operation:'discover',feed:'saved',limit:1});assert.equal(r.data.posts.length,1);assert.equal(r.calls.length,1);});
for(const field of ['known','stopId'])test('Threads '+field+' stops before the boundary and before pagination',t=>{
 const r=fixture(t)({operation:'discover',feed:'saved',[field]:field==='known'?['Code_1']:'Code_1'});assert.equal(r.data.posts.length,0);assert.equal(r.data.stoppedEarly,true);assert.equal(r.calls.length,1);assert.equal(r.data.stopLinkReached,field==='stopId');
});
test('Threads Likes uses its own initial connection, variables and pagination query',t=>{const r=fixture(t,{liked:true})({operation:'discover',feed:'liked'});assert.equal(r.status,0);assert.equal(r.data.posts.length,3);assert.equal(r.calls[0].path,'/liked/');assert.ok(r.data.posts.every(p=>p.feed==='liked'));});
test('Threads direct link returns only its own post, without replies or another saved feed',t=>{const r=fixture(t)({operation:'discover',target:{id:'Code_1',url:'https://www.threads.com/@artist/post/Code_1'}});assert.equal(r.status,0);assert.equal(r.data.posts.length,1);assert.equal(r.calls.length,1);assert.equal(r.data.posts[0].feed,'link');});
for(const [settings,error] of [[{signedOut:true},'THREADS_AUTH'],[{status:429},'THREADS_RATE_LIMIT'],[{mediaUrl:'https://evil.test/file.jpg'},'THREADS_MEDIA_URL'],[{redirect:'https://evil.test/'},'THREADS_URL']])test('Threads fails explicitly for '+error,t=>{const r=fixture(t,settings)({operation:'discover',feed:'saved'});assert.equal(r.data.error,error);assert.equal(r.status,1);assert.ok(r.calls.every(c=>c.host!=='evil.test'));});
test('Threads probe requires a verified viewer, never a cookie name alone',t=>{const r=fixture(t)({operation:'probe'});assert.deepEqual(r.data.session,{username:'collector'});assert.equal(fixture(t,{signedOut:true})({operation:'probe'}).data.error,'THREADS_AUTH');});

test('Threads retains complete posts and reports a broken carousel instead of dropping the whole search',t=>{const r=fixture(t,{incomplete:true})({operation:'discover',feed:'saved'});assert.equal(r.status,0);assert.deepEqual(r.data.posts.map(p=>p.id),['Code_1','Code_4']);assert.equal(r.data.failures.length,1);assert.equal(r.data.failures[0].code,'THREADS_FORMAT');});
test('Threads never substitutes a video thumbnail when its video URL is missing',t=>{const r=fixture(t,{missingVideo:true})({operation:'discover',feed:'saved'});assert.equal(r.status,0);assert.deepEqual(r.data.posts.map(p=>p.id),['Code_4']);assert.equal(r.data.failures.length,2);});
test('Threads repeated page returns complete posts with an explicit interruption',t=>{const r=fixture(t,{repeat:true})({operation:'discover',feed:'saved'});assert.equal(r.status,0);assert.equal(r.data.interruption.code,'THREADS_PAGING');assert.equal(r.data.posts.length,2);});
test('Threads recent N bounds unique checked posts including text and format failures',t=>{const r=fixture(t,{incomplete:true})({operation:'discover',feed:'saved',limit:3});assert.equal(r.status,0);assert.equal(r.data.checked,3);assert.equal(r.data.skippedText,1);assert.equal(r.data.posts.length,1);assert.equal(r.data.failures.length,1);assert.equal(r.calls.length,1);});
test('Threads all-invalid media reports a search error with safe failed-post URLs',t=>{const r=fixture(t,{allBad:true})({operation:'discover',feed:'saved',limit:2});assert.equal(r.status,1);assert.equal(r.data.error,'THREADS_FORMAT');assert.equal(r.data.failures.length,2);});
