import {checkpointScript} from './private-python.js';
import {instagramLikedLiterals} from './instagram-liked-literals.js';
// The same read-only Likes screen and pagination requests as Instagram's website.
// Endpoints are fixed; layout callbacks, unlike commands and remote code never run.
export const instagramLikedScript=String.raw`
import http.cookiejar,json,sys,urllib.parse,re,time,html
from curl_cffi import requests
class Failure(Exception):pass
${checkpointScript}
${instagramLikedLiterals}
PAGE='https://www.instagram.com/your_activity/interactions/likes/'
APP='com.instagram.privacy.activity_center.'
def read(url,data=None,public=False):
 checkpoint();p=urllib.parse.urlsplit(url)
 if p.scheme!='https' or p.username or p.password or p.port or p.fragment:raise Failure('INSTAGRAM_LIKED_RESPONSE')
 if public:
  if p.hostname!='static.cdninstagram.com' or not p.path.endswith('.js'):raise Failure('INSTAGRAM_LIKED_RESPONSE')
 elif url!=PAGE and (p.hostname!='www.instagram.com' or p.path!='/async/wbloks/fetch/'):raise Failure('INSTAGRAM_LIKED_RESPONSE')
 until=time.monotonic()+{'safe':2,'balanced':1}.get(spec.get('speed'),0)
 while time.monotonic()<until:checkpoint();time.sleep(.1)
 client=public_session if public else session
 response=client.get(url,timeout=30,allow_redirects=False) if data is None else client.post(url,data=data,headers=headers,timeout=30,allow_redirects=False)
 if response.status_code in (301,302,303,307,308,401,403):raise Failure('INSTAGRAM_LIKED_AUTH')
 if response.status_code==429:raise Failure('INSTAGRAM_LIKED_RATE_LIMIT')
 if response.status_code!=200 or len(response.content)>16*1024*1024:raise Failure('INSTAGRAM_LIKED_RESPONSE')
 return response.text
def fetch(handler,kind,params):
 if (handler,kind) not in {('liked_media_screen','app'),('liked_refresh','action'),('liked_next','action')}:raise Failure('INSTAGRAM_LIKED_RESPONSE')
 url='https://www.instagram.com/async/wbloks/fetch/?'+urllib.parse.urlencode({'appid':APP+handler,'type':kind,'__bkv':version})
 data=json.loads(read(url,{**tokens,'params':json.dumps(params,separators=(',',':'))}).removeprefix('for (;;);'))
 payload=data.get('payload') or {};layout=payload.get('layout') or {};bloks=layout.get('bloks_payload')
 if data.get('error') or not isinstance(bloks,dict) or not isinstance(bloks.get('tree'),dict):raise Failure('INSTAGRAM_LIKED_RESPONSE')
 return bloks
def unfiltered(params):
 expected={'main_order_state_value':True,'main_date_start_state_value':-1,'main_date_end_state_value':-1,'main_authors_state_value':'','main_filter_to_visible_on_facebook_value':False,'main_includes_location_value':False,'main_liked_privately_value':False,'main_content_type_value':0,'main_content_types_value':'Posts, Reels','main_account_history_events_state_value':'','main_filter_to_visible_from_facebook_value':False}
 if not isinstance(params,dict) or any(type(params.get(k))!=type(v) or params[k]!=v for k,v in expected.items()) or params.get('shared_user_id') not in ('',None):raise Failure('INSTAGRAM_LIKED_RESPONSE')
def discover():
 global version,tokens,headers
 source=read(PAGE)
 def token(name):
  m=re.search(r'\["'+name+r'",\[\],\{"token":"([^"\n]+)"',source)
  if not m:raise Failure('INSTAGRAM_LIKED_AUTH')
  return m[1]
 tokens={'__a':'1','__user':'0','__igUser':uid,'__d':'www','fb_dtsg':token('DTSGInitialData'),'lsd':token('LSD')}
 headers={'X-CSRFToken':csrf,'X-IG-App-ID':'936619743392459','X-Requested-With':'XMLHttpRequest','Referer':PAGE}
 version=None
 for url in re.findall(r'<script[^>]+src="([^"]+)',source)[:16]:
  url=html.unescape(url);p=urllib.parse.urlsplit(url)
  if p.hostname!='static.cdninstagram.com' or not p.path.endswith('.js'):continue
  code=read(url,public=True)
  match=re.search(r'__d\("igWebVersioningId",\[\],[\s\S]{0,150}?"([a-f0-9]{64})"',code)
  if match:version=match[1];break
 if not version:raise Failure('INSTAGRAM_LIKED_RESPONSE')
 initial=fetch('liked_media_screen','app',{});params=action_params(initial,'liked_refresh')
 unfiltered(params)
 if set(params)!={'content_container_id','content_element_id','content_spinner_id','main_order_state_value','main_attribute_order_state_value','main_date_start_state_value','main_date_end_state_value','main_authors_state_value','main_filter_to_visible_on_facebook_value','main_includes_location_value','main_liked_privately_value','main_content_type_value','main_content_types_value','main_account_history_events_state_value','entrypoint','shared_user_id','main_filter_to_visible_from_facebook_value'} or params['main_attribute_order_state_value']!='newest_to_oldest' or params['entrypoint']!='':raise Failure('INSTAGRAM_LIKED_RESPONSE')
 page=fetch('liked_refresh','action',params);posts=[];seen=set();cursors=set();known=set(spec.get('known') or []);stop=spec.get('stopCode');limit=int(spec.get('limit') or 0)
 for count in range(10000):
  checkpoint();batch=media_records(page);added=0
  for item in batch:
   if item['code']==stop or item['id'] in known:return {'posts':posts,'stoppedEarly':True,'stopLinkReached':item['code']==stop}
   if item['id'] in seen:continue
   seen.add(item['id']);posts.append(item);added+=1
   print(json.dumps({'event':'progress','found':len(posts),'ids':[item['id']]}),flush=True)
   if limit and len(posts)>=limit:return {'posts':posts,'stoppedEarly':False,'stopLinkReached':False}
  next=action_params(page,'liked_next')
  if next is None:return {'posts':posts,'stoppedEarly':False,'stopLinkReached':False}
  if not added or not isinstance(next,dict) or set(next)!={'page_size','activity_center_params','cursor','container_id','element_id'}:raise Failure('INSTAGRAM_LIKED_PAGING')
  cursor=next['cursor']
  if not isinstance(cursor,str) or not cursor or len(cursor)>8192 or cursor in cursors or str(next['page_size'])!='9':raise Failure('INSTAGRAM_LIKED_PAGING')
  context=json.loads(next['activity_center_params']);unfiltered(context)
  if context.get('items_for_action')!='' or context.get('number_of_items')!=0:raise Failure('INSTAGRAM_LIKED_RESPONSE')
  cursors.add(cursor);page=fetch('liked_next','action',next)
 raise Failure('INSTAGRAM_LIKED_PAGING')
try:
 with open(sys.argv[1],encoding='utf8') as file:spec=json.load(file)
 jar=http.cookiejar.MozillaCookieJar(spec['cookies']);jar.load(ignore_discard=True,ignore_expires=True)
 uid=next((c.value for c in jar if c.name=='ds_user_id' and c.domain.lstrip('.')=='instagram.com'),'')
 csrf=next((c.value for c in jar if c.name=='csrftoken' and c.domain.lstrip('.')=='instagram.com'),'')
 if not re.fullmatch(r'\d+',uid) or not csrf:raise Failure('INSTAGRAM_LIKED_AUTH')
 session=requests.Session(cookies=jar,impersonate='chrome');public_session=requests.Session(impersonate='chrome')
 print(json.dumps(discover()))
except Failure as error:print(json.dumps({'error':str(error)}));sys.exit(1)
except Exception:print(json.dumps({'error':'INSTAGRAM_LIKED_RESPONSE'}));sys.exit(1)
`;
