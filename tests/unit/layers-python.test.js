import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {layersApiScript} from '../../js/sources/layers-python.js';
import {browserCookiesScript} from '../../js/sources/private-python.js';
const id=n=>'c'+String(n).padStart(24,'0'),owner=id(99),group=n=>({id:id(n),name:'Folder '+n,url:'https://layers.to/collections/'+id(n)});
const fakeCurl=String.raw`
import json,os,urllib.parse
settings=json.load(open(os.environ['LAYERS_FIXTURE']))
def ident(n):return 'c'+str(n).zfill(24)
class Response:
 def __init__(self,value,status=200,html=False,headers=None):
  self.status_code=status;self.headers={'Content-Type':'text/html' if html else 'application/json',**(headers or {})};self.value=value;self.text=value if html else json.dumps(value);self.content=self.text.encode()
 def json(self):return self.value
class Session:
 def __init__(self,**kwargs):pass
 def get(self,url,**kwargs):
  p=urllib.parse.urlsplit(url);q=urllib.parse.parse_qs(p.query);headers=kwargs.get('headers') or {};path=p.path
  with open(os.environ['LAYERS_CALLS'],'a') as f:f.write(json.dumps({'path':path,'query':q,'csrf':headers.get('X-CSRF-Token')=='fixture-private-secret','redirects':kwargs.get('allow_redirects')})+'\n')
  if settings.get('status'):return Response({},settings['status'])
  if settings.get('redirect'):return Response({},302,headers={'Location':settings['redirect']})
  if path=='/explore':
   user=None if settings.get('signedOut') else {'id':settings.get('owner') or ident(99),'username':'collector','fullName':'Collector','email':'private-fixture-email'}
   root={'user':user,'csrfToken':None if settings.get('noCsrf') else 'fixture-private-secret'}
   return Response('<script>window.__remixContext = '+json.dumps({'state':{'loaderData':{'root':root}}})+';</script>',html=True)
  if not headers.get('X-CSRF-Token')=='fixture-private-secret':return Response({'error':{'code':'UNAUTHORIZED'}},401)
  if path=='/api/v1/groups':
   if q.get('userId')!=[ident(99)]:return Response({'error':'must scope owner'},400)
   num=20 if q.get('cursor') else 10
   data=[] if settings.get('empty') else [{'id':ident(num),'name':'Folder '+str(num),'userId':ident(88) if settings.get('wrongOwner') else ident(99)}]
   cursor=ident(10) if num==10 and data else None
   return Response({'data':data,**({'pagination':{'nextCursor':cursor,'hasMore':bool(cursor)}} if settings.get('nestedGroupsPaging') else {'nextCursor':cursor})})
  if path=='/api/v1/users/collector':return Response({'id':ident(99),'username':'collector'})
  def layer(n):
   ext='mp4' if n==2 else 'svg' if n==3 else 'gif' if n==4 else 'png'
   return {'id':ident(n),'title':'Title '+str(n),'description':'Caption '+str(n),'createdAt':'2026-01-01T00:00:00Z','user':{'username':'artist','email':'must-not-return'},'imageUrl':settings.get('mediaUrl') or 'https://layers-uploads-prod.s3.eu-west-2.amazonaws.com/'+str(n)+'.'+ext,'posterUrl':'https://layers-r2.com/poster.png' if n==2 else None}
  if path=='/api/v1/layers':
   if q.get('likerId'):
    if q['likerId']!=[settings.get('owner') or ident(99)] or q.get('groupId'):return Response({},400)
    more=not q.get('cursor')
    return Response({'data':[layer(n) for n in ([1,2] if more else [3])],'pagination':{'nextCursor':ident(2) if more else None,'hasMore':more}})
   if not q.get('groupId'):return Response({'error':'must not fetch Explore or Likes'},400)
   first=q['groupId'][0]==ident(10);more=first and not q.get('cursor')
   data=[layer(n) for n in ([1,2] if more else [1,2] if settings.get('repeat') else [3] if first else [2,4])]
   if settings.get('emptyLayer'):data=[];more=False
   return Response({'data':data,'pagination':{'nextCursor':ident(2) if more else None,'hasMore':more}})
  if path.startswith('/api/v1/layers/'):return Response(layer(1))
  return Response({},404)
`;
function fixture(t,settings={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-layers-python-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=(name,text)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text,{mode:0o600});return file;};
 put('curl_cffi/__init__.py','from . import requests\n');put('curl_cffi/requests.py',fakeCurl);
 const data=put('fixture.json',JSON.stringify(settings)),cookies=put('cookies.txt','# Netscape HTTP Cookie File\n.layers.to\tTRUE\t/\tTRUE\t0\tfixture\tprivate-cookie-fixture\n');
 return spec=>{
  const file=put('spec.json',JSON.stringify({...spec,cookies})),calls=path.join(root,'calls.jsonl');
  const r=spawnSync('python3',['-c',layersApiScript,file],{encoding:'utf8',env:{...process.env,PYTHONPATH:root,LAYERS_FIXTURE:data,LAYERS_CALLS:calls},timeout:10000});assert.ifError(r.error);assert.ok(r.stdout.trim(),r.stderr);
  for(const secret of ['fixture-private-secret','private-cookie-fixture','private-fixture-email','must-not-return'])assert.ok(!r.stdout.includes(secret));
  return {status:r.status,data:JSON.parse(r.stdout.trim().split('\n').pop()),calls:fs.readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse)};
 };
}
for(const field of ['known','stopId'])test('Layers default '+field+' boundary stops later collections, selected folders remain independent',t=>{
 const spec={operation:'discover',[field]:field==='known'?[id(1)]:id(1)};
 const global=fixture(t)(spec);assert.equal(global.data.posts.length,0);assert.equal(global.data.stoppedEarly,true);assert.equal(global.calls.filter(c=>c.path==='/api/v1/layers').length,1);
 const selected=fixture(t)({...spec,collections:[group(10),group(20)],perFolder:true});assert.deepEqual(selected.data.posts.map(p=>p.id),[id(2),id(4)]);
});
test('Layers full saved search scopes owned collections, pages and merges duplicate membership',t=>{
 const r=fixture(t)({operation:'discover'});assert.equal(r.status,0);assert.deepEqual(r.data.posts.map(p=>p.id),[id(1),id(2),id(3),id(4)]);
 assert.deepEqual(r.data.posts[1].collections.map(c=>c.id),[id(10),id(20)]);assert.ok(r.calls.filter(c=>c.path==='/api/v1/groups').every(c=>c.query.userId[0]===owner));
 assert.ok(r.calls.filter(c=>c.path==='/api/v1/layers').every(c=>c.query.groupId));assert.ok(r.calls.every(c=>!c.path.includes('like')&&c.redirects===false));
});
test('Layers accepts the live flat collection cursor and the nested layer pagination independently',t=>{
 const flat=fixture(t)({operation:'catalog'}),nested=fixture(t,{nestedGroupsPaging:true})({operation:'catalog'});
 assert.equal(flat.status,0);assert.deepEqual(flat.data.containers.map(c=>c.id),[id(10),id(20)]);assert.deepEqual(flat.data,nested.data);
});
test('Layers recent N is capped globally without fetching more collection pages',t=>{
 const r=fixture(t)({operation:'discover',limit:1});assert.deepEqual(r.data.posts.map(p=>p.id),[id(1)]);assert.equal(r.calls.filter(c=>c.path==='/api/v1/layers').length,1);
});
test('selected Layers folders have independent N and do not fetch any other folders',t=>{
 const r=fixture(t)({operation:'discover',collections:[group(10),group(20)],perFolder:true,limit:1});assert.deepEqual(r.data.posts.map(p=>p.id),[id(1),id(2)]);assert.ok(!r.calls.some(c=>c.path==='/api/v1/groups'));
});
for(const field of ['known','stopId'])test(`Layers excludes the ${field} boundary before further pages`,t=>{
 const r=fixture(t)({operation:'discover',collections:[group(10)],[field]:field==='known'?[id(2)]:id(2)});assert.deepEqual(r.data.posts.map(p=>p.id),[id(1)]);assert.equal(r.data.stoppedEarly,true);assert.equal(r.data.stopLinkReached,field==='stopId');assert.equal(r.calls.filter(c=>c.path==='/api/v1/layers').length,1);
});
test('Layers supports single media metadata, MP4, SVG and GIF with no fake carousel',t=>{
 const r=fixture(t)({operation:'discover'});assert.deepEqual(r.data.posts.map(p=>p.components[0].extension),['png','mp4','svg','gif']);assert.ok(r.data.posts.every(p=>p.components.length===1&&p.components[0].index===1));assert.equal(r.data.posts[1].description,'Caption 2');
 assert.equal(r.data.posts[1].components[0].previewUrl,'https://layers-r2.com/poster.png');
 assert.equal(r.data.posts[1].components[0].url,'https://layers-r2.com/2.mp4');
});
test('public direct layer can be read while signed out, but own saved catalog cannot',t=>{
 const target={id:id(1),type:'POST',name:'Link',url:'https://layers.to/layers/'+id(1)};
 const r=fixture(t,{signedOut:true})({operation:'discover',target});assert.equal(r.status,0);assert.equal(r.data.posts[0].id,id(1));
 const auth=fixture(t,{signedOut:true})({operation:'catalog'});assert.equal(auth.data.error,'LAYERS_AUTH');assert.equal(auth.calls.length,1);
});
test('valid empty Layers collections are empty without falling back to a global feed',t=>{
 assert.deepEqual(fixture(t,{empty:true})({operation:'discover'}).data.posts,[]);
 assert.deepEqual(fixture(t,{emptyLayer:true})({operation:'discover',collections:[group(10)]}).data.posts,[]);
});
for(const [settings,code] of [[{wrongOwner:true},'LAYERS_RESPONSE'],[{noCsrf:true},'LAYERS_RESPONSE'],[{status:429},'LAYERS_RATE_LIMIT'],[{status:401},'LAYERS_AUTH'],[{redirect:'http://layers.to/explore'},'LAYERS_URL'],[{redirect:'https://evil.test/explore'},'LAYERS_URL'],[{redirect:'https://layers.to/api/v1/layers'},'LAYERS_URL'],[{repeat:true},'LAYERS_PAGING'],[{mediaUrl:'https://another-bucket.s3.eu-west-2.amazonaws.com/a.png'},'LAYERS_MEDIA_URL'],[{mediaUrl:'http://layers-r2.com/a.png'},'LAYERS_MEDIA_URL'],[{mediaUrl:'https://layers-r2.com/a.pdf'},'LAYERS_FORMAT']])test(`Layers rejects ${JSON.stringify(settings)} without secrets`,t=>{
 const r=fixture(t,settings)({operation:'discover'});assert.equal(r.status,1);assert.equal(r.data.error,code);
});
test('Layers cookie export restricts domains before writing and excludes other platforms',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-layers-scope-'));fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'yt_dlp'));fs.writeFileSync(path.join(root,'yt_dlp/__init__.py'),'');fs.writeFileSync(path.join(root,'yt_dlp/cookies.py'),'def extract_cookies_from_browser(*args,**kwargs):raise Exception()\n');
 const input=path.join(root,'input.txt'),output=path.join(root,'output.txt'),domains=['.layers.to','.www.layers.to','.layers.to.evil.test','.dribbble.com','.x.com','.layers-r2.com'];
 fs.writeFileSync(input,'# Netscape HTTP Cookie File\n'+domains.map((d,i)=>`${d}\tTRUE\t/\tTRUE\t0\tfixture\tsynthetic-${i}`).join('\n')+'\n',{mode:0o600});fs.writeFileSync(output,'',{mode:0o600});
 const r=spawnSync('python3',['-c',browserCookiesScript,output,'file',input,'layers'],{encoding:'utf8',env:{...process.env,PYTHONPATH:root}});assert.equal(r.status,0,r.stderr);const content=fs.readFileSync(output,'utf8');assert.ok(content.includes('synthetic-0')&&content.includes('synthetic-1'));for(const i of [2,3,4,5])assert.ok(!content.includes('synthetic-'+i));
 if(process.platform!=='win32')assert.equal(fs.statSync(output).mode&0o777,0o600);
});

test('Layers Likes scopes the live UUID owner, pages, and never reads groups or public Explore results',t=>{
 const owner='11111111-2222-3333-4444-555555555555';const r=fixture(t,{owner})({operation:'discover',feed:'liked'});assert.equal(r.status,0);assert.deepEqual(r.data.posts.map(p=>p.id),[id(1),id(2),id(3)]);
 const calls=r.calls.filter(c=>c.path==='/api/v1/layers');assert.equal(calls.length,2);assert.ok(calls.every(c=>c.query.likerId[0]===owner&&!c.query.groupId));assert.ok(!r.calls.some(c=>c.path==='/api/v1/groups'));assert.ok(r.data.posts.every(p=>p.collections.length===0&&p.feed==='liked'));
});
for(const field of ['known','stopId'])test('Layers Likes excludes '+field+' before more pages',t=>{const r=fixture(t)({operation:'discover',feed:'liked',[field]:field==='known'?[id(1)]:id(1)});assert.equal(r.status,0);assert.equal(r.data.posts.length,0);assert.equal(r.calls.filter(c=>c.path==='/api/v1/layers').length,1);});
