import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {xApiScript} from '../../js/sources/x-python.js';
const curl=String.raw`
import json,os,urllib.parse
class Response:
 def __init__(self,body,status=200,location=''):
  self.status_code=status;self.headers={'Location':location};self.body=body;self.text=body if isinstance(body,str) else json.dumps(body);self.content=self.text.encode()
 def json(self):return self.body
class Session:
 def __init__(self,**kwargs):pass
 def get(self,url,params=None,headers=None,**kwargs):
  f=json.load(open(os.environ['X_FIXTURE']));p=urllib.parse.urlsplit(url)
  with open(os.environ['X_CALLS'],'a') as handle:handle.write(json.dumps({'host':p.hostname,'path':p.path,'params':params,'auth':bool(headers)})+'\n')
  if p.path=='/home':return Response('<script src="https://abs.twimg.com/responsive-web/client-web/main.fixture.js"></script>')
  if p.hostname=='abs.twimg.com':return Response(','.join('queryId:"fixture",operationName:"'+n+'"' for n in ('Likes','Bookmarks','BookmarkFoldersSlice','BookmarkFolderTimeline','TweetResultByRestId')))
  if f.get('status'):return Response({},f['status'])
  if f.get('redirect'):return Response({},302,f['redirect'])
  name=p.path.split('/')[-1]
  if name=='UserByRestId':return Response({'rest_id':'7','core':{'screen_name':'fixture','name':'Fixture'}})
  if name=='BookmarkFoldersSlice':return Response({'data':{'viewer':{'user_results':{'result':{'bookmark_collections_slice':{'items':[{'id':'10','name':'Folder'}]}}}}}})
  if f.get('folderDenied'):return Response({'data':{},'errors':[{'code':37,'message':'Denied'}]})
  if f.get('badSchema'):return Response({'data':{}})
  variables=json.loads((params or {}).get('variables','{}'));page=int(variables.get('cursor','0'));pages=f.get('pages',[[1,2],[3,4]]);ids=pages[page]
  entries=[]
  for id in ids:
   media=[] if id in f.get('textOnly',[]) else [{'type':'animated_gif' if f.get('gif') else 'video','media_url_https':'https://pbs.twimg.com/a.jpg','video_info':{'variants':[{'content_type':'video/mp4','bitrate':1,'url':f.get('mediaUrl','https://video.twimg.com/a.mp4')}]}}]
   tweet={'__typename':'Tweet','rest_id':str(id),'legacy':{'full_text':'Caption','extended_entities':{'media':media}},'core':{'user_results':{'result':{'core':{'screen_name':'artist'}}}}}
   if f.get('note'):tweet['note_tweet']={'note_tweet_results':{'result':{'text':'Long caption'}}}
   entries.append({'entryId':'tweet-'+str(id),'content':{'itemContent':{'tweet_results':{'result':{'__typename':'TweetWithVisibilityResults','tweet':tweet}}}}})
  if page<len(pages)-1:entries.append({'entryId':'cursor-bottom','content':{'cursorType':'Bottom','value':f.get('cursor',str(page+1))}})
  key='bookmark_collection_timeline' if name=='BookmarkFolderTimeline' else 'bookmark_timeline_v2'
  if name=='Likes':return Response({'data':{'user':{'result':{'timeline_v2':{'timeline':{'instructions':[{'type':'TimelineAddEntries','entries':entries}]}}}}}})
  return Response({'data':{key:{'timeline':{'instructions':[{'type':'TimelineAddEntries','entries':entries}]}}}})
`;
const gallery=String.raw`
class Config:
 def set(self,*args):pass
config=Config()
`;
const twitter=String.raw`
class Api:
 root='https://x.com/i/api'
 headers={'x-twitter-auth-type':'OAuth2Session','authorization':'fixture-private-secret'}
 features_pagination={}
 def _transaction_id(self,*args):pass
 def user_by_rest_id(self,id):return self._call('/graphql/fixture/UserByRestId',{})
class TwitterBookmarkExtractor:
 @staticmethod
 def from_url(url):return TwitterBookmarkExtractor()
 def initialize(self):self.api=Api()
`;
function fixture(t,settings={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-x-python-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=(name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
 put('curl_cffi/__init__.py','from . import requests\n');put('curl_cffi/requests.py',curl);
 put('gallery_dl/__init__.py',gallery);put('gallery_dl/extractor/__init__.py','');put('gallery_dl/extractor/twitter.py',twitter);
 put('fixture.json',JSON.stringify(settings));const calls=path.join(root,'calls.jsonl'),cookies=path.join(root,'cookies.txt');
 put('cookies.txt','# Netscape HTTP Cookie File\n'+['auth_token','ct0','twid'].filter(n=>n!==settings.omit).map(n=>`.x.com\tTRUE\t/\tTRUE\t0\t${n}\t${n==='twid'?'u%3D7':'fixture-cookie'}`).join('\n')+'\n');
 return spec=>{const file=path.join(root,'spec.json');put('spec.json',JSON.stringify({...spec,cookies}));
  const result=spawnSync('python3',['-c',xApiScript,file],{encoding:'utf8',env:{...process.env,PYTHONPATH:root,X_FIXTURE:path.join(root,'fixture.json'),X_CALLS:calls},timeout:10000});
  assert.ifError(result.error);assert.ok(!result.stdout.includes('fixture-cookie')&&!result.stdout.includes('fixture-private-secret'));
  assert.ok(result.stdout.trim(),result.stderr);
  return {status:result.status,data:JSON.parse(result.stdout.trim().split('\n').pop()),calls:fs.existsSync(calls)?fs.readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse):[]};};
}
test('X full search pages through bookmarks and excludes text-only media',t=>{
 const r=fixture(t,{textOnly:[2]})({operation:'discover'});assert.equal(r.status,0);assert.deepEqual(r.data.posts.map(p=>p.id),['1','3','4']);assert.equal(r.data.checked,4);assert.equal(r.data.skippedText,1);
 assert.equal(r.calls.filter(c=>c.path.endsWith('/Bookmarks')).length,2);assert.ok(r.calls.filter(c=>c.auth).every(c=>c.host==='x.com'));
});
test('X recent N counts text-only posts and stops before the next request',t=>{
 const r=fixture(t,{textOnly:[2]})({operation:'discover',limit:2});assert.deepEqual(r.data.posts.map(p=>p.id),['1']);assert.equal(r.data.checked,2);assert.equal(r.calls.filter(c=>c.path.endsWith('/Bookmarks')).length,1);
});
for(const key of ['known','stopId'])test(`X ${key} boundary is excluded`,t=>{
 const r=fixture(t)({operation:'discover',[key]:key==='known'?['2']:'2'});assert.deepEqual(r.data.posts.map(p=>p.id),['1']);assert.equal(r.data.stoppedEarly,true);assert.equal(r.data.stopLinkReached,key==='stopId');
});
test('X selected folder uses its ID and never calls Bookmarks',t=>{
 const r=fixture(t)({operation:'discover',folder:'10',limit:1});assert.equal(r.status,0);
 const calls=r.calls.filter(c=>c.path.endsWith('/BookmarkFolderTimeline'));assert.equal(calls.length,1);assert.equal(JSON.parse(calls[0].params.variables).bookmark_collection_id,'10');assert.ok(!r.calls.some(c=>c.path.endsWith('/Bookmarks')));
});
test('X catalog has actual platform folders and empty lists are valid',t=>{
 assert.deepEqual(fixture(t)({operation:'catalog'}).data.containers,[{id:'10',name:'Folder'}]);
 const r=fixture(t,{pages:[[]]})({operation:'discover'});assert.equal(r.status,0);assert.equal(r.data.checked,0);
});
test('X preserves long captions and animated GIF as playable MP4',t=>{
 const r=fixture(t,{note:true,gif:true})({operation:'discover',limit:1});assert.equal(r.data.posts[0].description,'Long caption');assert.equal(r.data.posts[0].components[0].extension,'mp4');
});
for(const [settings,code] of [[{omit:'ct0'},'X_AUTH'],[{status:429},'X_RATE_LIMIT'],[{status:401},'X_AUTH'],[{redirect:'http://x.com/i/api/graphql/fixture/Bookmarks'},'X_URL'],[{redirect:'https://evil.test/'},'X_URL'],[{badSchema:true},'X_RESPONSE'],[{mediaUrl:'http://video.twimg.com/a.mp4'},'X_MEDIA_URL'],[{pages:[[1],[2],[3]],cursor:'1'},'X_PAGING']])test(`X rejects ${JSON.stringify(settings)} without leaking credentials`,t=>{
 const r=fixture(t,settings)({operation:'discover'});assert.equal(r.status,1);assert.equal(r.data.error,code);if(settings.omit)assert.equal(r.calls.length,0);
});

test('X Premium folder denial is explicit and cannot turn into a global search',t=>{
 const r=fixture(t,{folderDenied:true})({operation:'discover',folder:'10'});assert.equal(r.data.error,'X_FOLDERS');assert.ok(!r.calls.some(c=>c.path.endsWith('/Bookmarks')));
});
test('X final empty page with the same cursor is a complete search, not a loop',t=>{
 const r=fixture(t,{pages:[[1],[]],cursor:'1'})({operation:'discover'});assert.equal(r.status,0);assert.equal(r.data.checked,1);assert.equal(r.data.posts.length,1);
});

test('X cookie export scopes domains before writing and excludes other platform sessions',async t=>{
 const {browserCookiesScript}=await import('../../js/sources/private-python.js');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-x-cookie-scope-'));fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'yt_dlp'));fs.writeFileSync(path.join(root,'yt_dlp','__init__.py'),'');
 fs.writeFileSync(path.join(root,'yt_dlp','cookies.py'),'def extract_cookies_from_browser(*args,**kwargs):raise Exception("fixture")\n');
 const input=path.join(root,'input.txt'),output=path.join(root,'output.txt');
 const domains=['.x.com','.twitter.com','.api.x.com','.vimeo.com','.instagram.com','.x.com.evil.test'];
 fs.writeFileSync(input,'# Netscape HTTP Cookie File\n'+domains.map((domain,i)=>`${domain}\tTRUE\t/\tTRUE\t0\tfixture\tsynthetic-${i}`).join('\n')+'\n',{mode:0o600});
 fs.writeFileSync(output,'',{mode:0o600});
 const run=spawnSync('python3',['-c',browserCookiesScript,output,'file',input,'x'],{env:{...process.env,PYTHONPATH:root},encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);const content=fs.readFileSync(output,'utf8');
 for(const i of [0,1,2])assert.ok(content.includes('synthetic-'+i));for(const i of [3,4,5])assert.ok(!content.includes('synthetic-'+i));
 if(process.platform!=='win32')assert.equal(fs.statSync(output).mode&0o777,0o600);
});

test('X Likes selects the authenticated twid owner and pages the private Likes connection',t=>{
 const r=fixture(t)({operation:'discover',feed:'liked'});assert.equal(r.status,0);assert.deepEqual(r.data.posts.map(p=>p.id),['1','2','3','4']);
 const calls=r.calls.filter(c=>c.path.endsWith('/Likes'));assert.equal(calls.length,2);assert.ok(calls.every(c=>JSON.parse(c.params.variables).userId==='7'));assert.ok(!r.calls.some(c=>c.path.endsWith('/Bookmarks')));
});
for(const field of ['known','stopId'])test('X Likes stops at '+field+' before pagination',t=>{const r=fixture(t)({operation:'discover',feed:'liked',[field]:field==='known'?['1']:'1'});assert.equal(r.status,0);assert.equal(r.data.posts.length,0);assert.equal(r.calls.filter(c=>c.path.endsWith('/Likes')).length,1);});
