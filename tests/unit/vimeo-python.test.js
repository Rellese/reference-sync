import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {vimeoApiScript,vimeoCookiesScript} from '../../js/sources/vimeo-python.js';
import {vimeoDownloadScript} from '../../js/sources/vimeo-download.js';

// Run the actual fixed helper against an offline transport, including its own
// URL checks, pagination and boundaries. No browser/account/network is used.
const fakeCurl=String.raw`
import json,os,urllib.parse
class Response:
 def __init__(self,body,status=200,location=''):
  self.body=body;self.status_code=status;self.headers={'Location':location};self.content=json.dumps(body).encode()
 def json(self):return self.body
class Session:
 def __init__(self,**kwargs):pass
 def get(self,url,**kwargs):
  fixture=json.load(open(os.environ['VIMEO_FIXTURE']))
  with open(os.environ['VIMEO_CALLS'],'a') as f:f.write(json.dumps({'url':url,'authenticated':bool(kwargs.get('headers',{}).get('Authorization'))})+'\n')
  p=urllib.parse.urlsplit(url)
  if p.path=='/_next/viewer':return Response({'jwt':'fixture-private-token'})
  if p.path=='/me':return Response({'uri':'/users/7'})
  if fixture.get('status'):return Response({},fixture['status'])
  if fixture.get('redirect'):return Response({},302,fixture['redirect'])
  if '/albums' in p.path and not p.path.endswith('/videos'):
   return Response({'data':[{'uri':'/users/7/albums/9','name':'Showcase'}],'paging':{}})
  page=int(urllib.parse.parse_qs(p.query).get('page',['1'])[0]);ids=fixture.get('pages',[[1,2],[3,4]])[page-1]
  following=fixture.get('next','/users/7/likes?page='+str(page+1)) if page<len(fixture.get('pages',[[1,2],[3,4]])) else None
  data=[{'uri':'/videos/'+str(n),'link':fixture.get('permalink','https://vimeo.com/'+str(n)),'name':'Title','description':'Description','user':{},'pictures':{'sizes':[]}} for n in ids]
  return Response({'data':data,'paging':{'next':following}})
`;
function fixture(t, data={}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-vimeo-python-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'curl_cffi'));fs.writeFileSync(path.join(root,'curl_cffi','__init__.py'),'from . import requests\n');
 fs.writeFileSync(path.join(root,'curl_cffi','requests.py'),fakeCurl);
 const cookies=path.join(root,'cookies.txt'),input=path.join(root,'fixture.json'),calls=path.join(root,'calls.jsonl');
 fs.writeFileSync(cookies,'# Netscape HTTP Cookie File\n',{mode:0o600});fs.writeFileSync(input,JSON.stringify(data));
 function run(script,spec,args){
  const file=path.join(root,'spec.json');fs.writeFileSync(file,JSON.stringify({...spec,cookies}));
  const output=spawnSync('python3',['-c',script,...(args||[file])],{encoding:'utf8',env:{...process.env,PYTHONPATH:root,
   VIMEO_FIXTURE:input,VIMEO_CALLS:calls},timeout:10000});
  assert.ifError(output.error);assert.ok(!output.stdout.includes('fixture-private-token'));
  return {status:output.status,data:JSON.parse(output.stdout.trim().split('\n').pop()),stdout:output.stdout,
   calls:fs.existsSync(calls)?fs.readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse):[]};
 }
 return {root,cookies,run};
}
test('full search follows verified owner pagination and returns all items',t=>{
 const f=fixture(t),r=f.run(vimeoApiScript,{operation:'discover',resource:'/me/likes'});
 assert.equal(r.status,0);assert.deepEqual(r.data.posts.map(p=>p.id),['1','2','3','4']);
 assert.equal(r.calls.filter(c=>/\/likes\?/.test(c.url)).length,2);
 assert.ok(r.calls.filter(c=>c.authenticated).every(c=>c.url.startsWith('https://api.vimeo.com/')));
});
for(const [permalink,expected] of [['https://vimeo.com/artist/design','https://vimeo.com/1'],
 ['http://vimeo.com/1/012345abcd','https://vimeo.com/1/012345abcd'],['https://evil.test/1','https://vimeo.com/1']])test(`API permalink ${permalink} becomes a verified HTTPS video ID`,t=>{
 const r=fixture(t,{permalink,pages:[[1]]}).run(vimeoApiScript,{operation:'discover',resource:'/me/likes'});
 assert.equal(r.data.posts[0].url,expected);
});
test('recent stops inside the next page at N and smart stops before the known item',t=>{
 const f=fixture(t),recent=f.run(vimeoApiScript,{operation:'discover',resource:'/me/likes',limit:3});
 assert.deepEqual(recent.data.posts.map(p=>p.id),['1','2','3']);
 const smart=f.run(vimeoApiScript,{operation:'discover',resource:'/me/likes',known:['2']});
 assert.deepEqual(smart.data.posts.map(p=>p.id),['1']);assert.equal(smart.data.stoppedEarly,true);
 assert.equal(smart.data.stopLinkReached,false);
});
test('stop URL boundary is excluded; an empty list is valid',t=>{
 const f=fixture(t),r=f.run(vimeoApiScript,{operation:'discover',resource:'/me/likes',stopId:'3'});
 assert.deepEqual(r.data.posts.map(p=>p.id),['1','2']);assert.equal(r.data.stopLinkReached,true);
 const empty=fixture(t,{pages:[[]]}).run(vimeoApiScript,{operation:'discover',resource:'/me/watchlater'});
 assert.equal(empty.status,0);assert.equal(empty.data.posts.length,0);
});
for(const next of ['http://api.vimeo.com/me/likes?page=2','https://evil.test/me/likes?page=2','/users/8/likes?page=2','/me/likes?page=1'])test(`pagination rejects ${next} without transmitting authorization there`,t=>{
 const r=fixture(t,{next}).run(vimeoApiScript,{operation:'discover',resource:'/me/likes'});
 assert.equal(r.status,1);assert.equal(r.data.error,'VIMEO_PAGING');
 assert.equal(r.calls.filter(c=>/\/likes\?/.test(c.url)).length,1);
});
for(const [status,error] of [[401,'VIMEO_AUTH'],[429,'VIMEO_RATE_LIMIT']])test(`${status} is returned once as a redacted failure`,t=>{
 const r=fixture(t,{status}).run(vimeoApiScript,{operation:'discover',resource:'/me/likes'});
 assert.equal(r.data.error,error);assert.equal(r.calls.length,2);
});
test('API redirects cannot downgrade HTTPS or change host',t=>{
 const r=fixture(t,{redirect:'http://evil.test/secret'}).run(vimeoApiScript,{operation:'discover',resource:'/me/likes'});
 assert.equal(r.data.error,'VIMEO_URL');assert.equal(r.calls.length,2);
});
test('catalog normalizes album URIs and cancelled helpers make no network request',t=>{
 const f=fixture(t),catalog=f.run(vimeoApiScript,{operation:'catalog'});assert.deepEqual(catalog.data.containers,[{id:'9',name:'Showcase'}]);
 const control=path.join(f.root,'control.json');fs.writeFileSync(control,'{"stopped":true}');
 const r=f.run(vimeoApiScript,{operation:'probe',control});assert.equal(r.data.error,'JOB_STOPPED');
});
test('supplied cookie snapshots are narrowed to Vimeo without widening permissions',t=>{
 const f=fixture(t),source=path.join(f.root,'source.txt'),output=path.join(f.root,'scoped.txt');
 fs.mkdirSync(path.join(f.root,'yt_dlp'));fs.writeFileSync(path.join(f.root,'yt_dlp','__init__.py'),'');
 fs.writeFileSync(path.join(f.root,'yt_dlp','cookies.py'),'def extract_cookies_from_browser(*args,**kwargs): raise AssertionError()\n');
 fs.writeFileSync(source,'# Netscape HTTP Cookie File\n.vimeo.com\tTRUE\t/\tTRUE\t0\tsession\tfixture\n.evil.test\tTRUE\t/\tTRUE\t0\tsession\tother\n');
 fs.writeFileSync(output,'',{mode:0o600});const r=f.run(vimeoCookiesScript,{},[output,'file',source]);
 assert.equal(r.status,0);assert.ok(fs.readFileSync(output,'utf8').includes('vimeo.com'));assert.ok(!fs.readFileSync(output,'utf8').includes('evil.test'));
 if(process.platform!=='win32')assert.equal(fs.statSync(output).mode&0o777,0o600);
});
test('download transport rejects HTTP and unrelated domains before a native request',t=>{
 const f=fixture(t);for(const dir of ['yt_dlp','yt_dlp/networking','yt_dlp/downloader'])fs.mkdirSync(path.join(f.root,dir),{recursive:true});
 fs.writeFileSync(path.join(f.root,'yt_dlp','__init__.py'),String.raw`
import json
class YoutubeDL:
 def __init__(self,options):self.options=options
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def build_request_director(self,classes):return classes[0]()
 def extract_info(self,url,download=True):
  class Request:
   def __init__(self,url):self.url=url
  self._request_director._send(Request(url));return {'id':'1'}
`);
 fs.writeFileSync(path.join(f.root,'yt_dlp/networking/_urllib.py'),'class UrllibRH:\n def _send(self,request): raise AssertionError("native request")\n');
 fs.writeFileSync(path.join(f.root,'yt_dlp/downloader/external.py'),'class FFmpegFD: pass\n');
 for(const url of ['http://vimeo.com/1','https://evil.test/1','https://vimeo.com:123/1']){
  const r=f.run(vimeoDownloadScript,{url});assert.equal(r.data.error,'VIMEO_URL');
 }
});
