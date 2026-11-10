import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {instagramLikedScript} from '../../js/sources/instagram-liked-python.js';
const expr=v=>Array.isArray(v)?`(bk.action.array.Make, ${v.map(expr).join(', ')})`:v&&typeof v==='object'?`(bk.action.map.Make, ${expr(Object.keys(v))}, ${expr(Object.values(v))})`:JSON.stringify(v);
const defaults={content_container_id:1,content_element_id:2,content_spinner_id:3,main_order_state_value:true,main_attribute_order_state_value:'newest_to_oldest',main_date_start_state_value:-1,main_date_end_state_value:-1,main_authors_state_value:'',main_filter_to_visible_on_facebook_value:false,main_includes_location_value:false,main_liked_privately_value:false,main_content_type_value:0,main_content_types_value:'Posts, Reels',main_account_history_events_state_value:'',entrypoint:'',shared_user_id:'',main_filter_to_visible_from_facebook_value:false};
const action=(handler,data)=>`(bk.action.bloks.AsyncActionWithDataManifest, "com.instagram.privacy.activity_center.${handler}", ${expr(data)}, (bk.action.bloks.AsyncActionWithDataManifest, "com.instagram.privacy.activity_center.liked_unlike", ${expr({media:'do-not-run'})}))`;
function layout({ids=[],next=false,cursor='next',bad=false,filter=false}={}){const context={...defaults,initial_cursor:'start',items_for_action:'',number_of_items:0};if(filter)context.main_authors_state_value='someone-else';return {payload:{layout:{bloks_payload:{data:[],tree:{'bk.components.Flexbox':{media:expr(ids.map(id=>({media_id:id+'_999',media_code:'code'+id,media_type:1}))),pagination:next?action('liked_next',{page_size:'9',activity_center_params:JSON.stringify(context),cursor,container_id:'1',element_id:'2'}):'',bad:bad?'(bk.action.map.Make, (bk.action.array.Make, "media_id", "media_code"), (bk.action.array.Make, (bk.action.DoSomething, "123"), "code"))':''}},embedded_payloads:[]}}}};}
const fake=String.raw`
import json,os,urllib.parse
fixture=json.load(open(os.environ['IG_FIXTURE']))
class Response:
 def __init__(self,text,status=200):self.text=text;self.content=text.encode();self.status_code=status;self.headers={}
class Session:
 def __init__(self,**kwargs):self.private=bool(kwargs.get('cookies'))
 def get(self,url,**kwargs):
  with open(os.environ['IG_CALLS'],'a') as f:f.write(json.dumps({'url':url,'private':self.private,'redirects':kwargs.get('allow_redirects')})+'\n')
  if 'static.cdninstagram.com' in url:return Response('__d("igWebVersioningId",[],(function(){var v="'+'a'*64+'";}));')
  return Response('<script src="https://static.cdninstagram.com/test.js"></script>["DTSGInitialData",[],{"token":"private-dtsg"}]["LSD",[],{"token":"private-lsd"}]')
 def post(self,url,**kwargs):
  q=urllib.parse.parse_qs(urllib.parse.urlsplit(url).query);handler=q['appid'][0].split('.')[-1];params=json.loads(kwargs['data']['params'])
  with open(os.environ['IG_CALLS'],'a') as f:f.write(json.dumps({'handler':handler,'kind':q['type'][0],'private':self.private,'cursor':params.get('cursor'),'redirects':kwargs.get('allow_redirects')})+'\n')
  value=fixture[handler if handler!='liked_next' else params['cursor']]
  return Response('for (;;);'+json.dumps(value.get('data',{})),value.get('status',200))
`;
function fixture(t,changes={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rs-ig-liked-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=(name,value)=>{const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,value,{mode:0o600});return p;};
 put('curl_cffi/__init__.py','from . import requests');put('curl_cffi/requests.py',fake);
 const first={payload:{layout:{bloks_payload:{data:[],tree:{call:action('liked_refresh',defaults)}}}}};
 const data=put('fixture.json',JSON.stringify({liked_media_screen:{data:first},liked_refresh:{data:layout({ids:['123','124'],next:true})},next:{data:layout({ids:['125']})},...changes}));
 const cookies=put('cookies.txt','# Netscape HTTP Cookie File\n.instagram.com\tTRUE\t/\tTRUE\t0\tds_user_id\t999\n.instagram.com\tTRUE\t/\tTRUE\t0\tcsrftoken\tprivate-csrf\n');
 return spec=>{const file=put('spec.json',JSON.stringify({...spec,cookies})),calls=path.join(root,'calls.jsonl');const r=spawnSync('python3',['-c',instagramLikedScript,file],{encoding:'utf8',env:{...process.env,PYTHONPATH:root,IG_FIXTURE:data,IG_CALLS:calls},timeout:10000});assert.ifError(r.error);assert.ok(r.stdout,r.stderr);for(const secret of ['private-csrf','private-dtsg','private-lsd'])assert.ok(!r.stdout.includes(secret));return {status:r.status,data:JSON.parse(r.stdout.trim().split('\n').pop()),calls:fs.readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse)};};
}
test('Instagram web Likes preserves ordering, pages, scopes cookies and never invokes unlike or remote code',t=>{
 const r=fixture(t)({});assert.equal(r.status,0);assert.deepEqual(r.data.posts.map(p=>p.id),['123','124','125']);
 assert.deepEqual(r.calls.filter(c=>c.handler).map(c=>c.handler),['liked_media_screen','liked_refresh','liked_next']);assert.ok(r.calls.every(c=>c.redirects===false));assert.ok(r.calls.filter(c=>c.url?.includes('static.')).every(c=>c.private===false));
});
for(const [spec,count] of [[{limit:1},1],[{known:['123']},0],[{stopCode:'code123'},0]])test('Instagram bounds before further page/detail: '+JSON.stringify(spec),t=>{const r=fixture(t)(spec);assert.equal(r.status,0);assert.equal(r.data.posts.length,count);assert.ok(!r.calls.some(c=>c.handler==='liked_next'));assert.equal(r.data.stopLinkReached,!!spec.stopCode);});
test('empty valid Likes layout is empty without querying Saved or Explore',t=>{const r=fixture(t,{liked_refresh:{data:layout()}})({});assert.equal(r.status,0);assert.deepEqual(r.data.posts,[]);assert.ok(r.calls.every(c=>!c.url?.includes('/saved')));});
for(const [name,changes,error] of [['repeat',{next:{data:layout({ids:['123','124'],next:true})}},'INSTAGRAM_LIKED_PAGING'],['foreign filter',{liked_refresh:{data:layout({ids:['123'],next:true,filter:true})}},'INSTAGRAM_LIKED_RESPONSE'],['unknown executable literal',{liked_refresh:{data:layout({bad:true})}},'INSTAGRAM_LIKED_RESPONSE'],['rate limit',{liked_refresh:{status:429}},'INSTAGRAM_LIKED_RATE_LIMIT'],['authentication redirect',{liked_refresh:{status:302}},'INSTAGRAM_LIKED_AUTH'],['unexpected schema',{liked_refresh:{data:{payload:{}}}},'INSTAGRAM_LIKED_RESPONSE']])test('Instagram fails clearly on '+name,t=>{const r=fixture(t,changes)({});assert.equal(r.status,1);assert.equal(r.data.error,error);});
