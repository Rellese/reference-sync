import {checkpointScript} from './private-python.js';
import {threadsParsingScript} from './threads-parsing.js';
// Reuse read-only queries supplied by the site's own page. Tokens stay in memory.
export const threadsScript=String.raw`
import http.cookiejar,json,re,sys,time,urllib.parse
from html.parser import HTMLParser
from curl_cffi import requests
class Failure(Exception):pass
${checkpointScript}
${threadsParsingScript}
ORIGIN='https://www.threads.com'
def safe_url(url,static=False):
 p=urllib.parse.urlsplit(url)
 allowed=(p.hostname or '').endswith('.cdninstagram.com') if static else p.hostname=='www.threads.com'
 if p.scheme!='https' or p.username or p.password or p.port or not allowed:raise Failure('THREADS_URL')
 return url
def read(url,payload=None,static=False):
 client=requests.Session(impersonate='chrome') if static else session
 try:
  for attempt in range(4):
   checkpoint();safe_url(url,static)
   if payload is not None and url!=ORIGIN+'/api/graphql':raise Failure('THREADS_URL')
   until=time.monotonic()+(0 if static else {'safe':2,'balanced':1}.get(spec.get('speed'),0))
   while time.monotonic()<until:checkpoint();time.sleep(.1)
   headers={} if static else {'Referer':ORIGIN+'/','Origin':ORIGIN}
   response=client.request('POST' if payload is not None else 'GET',url,data=payload,headers=headers,timeout=30,allow_redirects=False,stream=True)
   try:
    if response.status_code in (301,302,303,307,308):
     if payload is not None:raise Failure('THREADS_AUTH')
     url=urllib.parse.urljoin(url,response.headers.get('Location',''));continue
    if response.status_code==429:raise Failure('THREADS_RATE_LIMIT')
    if response.status_code in (401,403):raise Failure('THREADS_AUTH')
    if response.status_code!=200:raise Failure('THREADS_HTTP')
    data=bytearray()
    for chunk in response.iter_content(chunk_size=65536):
     checkpoint();data.extend(chunk)
     if len(data)>16*1024*1024:raise Failure('THREADS_RESPONSE')
    return bytes(data).decode('utf-8')
   finally:response.close()
  raise Failure('THREADS_URL')
 finally:
  if static:client.close()
def bootstrap(path,require_owner=True):
 page=PageData(read(ORIGIN+path));config=modules(page.blocks)
 owner=(config.get('BarcelonaSharedData') or {}).get('viewer')
 if require_owner and (not isinstance(owner,dict) or not re.fullmatch(r'[A-Za-z0-9_.]{1,80}',str(owner.get('username') or ''))):raise Failure('THREADS_AUTH')
 return page,config,owner
def query_document(page,name):
 pattern=re.compile(r'__d\("'+re.escape(name)+r'_threadsRelayOperation"[^\n]*?\.exports="(\d+)"')
 for asset in page.assets[:96]:
  p=urllib.parse.urlsplit(asset)
  if p.scheme!='https' or not (p.hostname or '').endswith('.cdninstagram.com'):continue
  match=pattern.search(read(asset,static=True))
  if match:return match.group(1)
 raise Failure('THREADS_PAGING')
def pages(feed):
 name='Barcelona'+('Liked' if feed=='liked' else 'Saved')+'Page'
 field=feed+'_media';page,config,owner=bootstrap('/'+feed+'/')
 conn=connection(page.blocks,field);preloader=None;document=None;cursors=set()
 for value in walk(page.blocks):
  if isinstance(value,dict) and str(value.get('preloaderID','')).startswith('adp_'+name+'ViewerQuery') and isinstance(value.get('variables'),dict):preloader=value
 for number in range(10000):
  yield conn
  info=conn['page_info'];more=info.get('has_next_page');cursor=info.get('end_cursor')
  if type(more)!=bool:raise Failure('THREADS_PAGING')
  if not more:return
  if not conn['edges'] or not isinstance(cursor,str) or not cursor or len(cursor)>20000 or cursor in cursors:raise Failure('THREADS_PAGING')
  cursors.add(cursor)
  if not preloader or not config.get('DTSGInitialData',{}).get('token'):raise Failure('THREADS_PAGING')
  if not document:document=query_document(page,name+'RefetchableQuery')
  variables={**preloader['variables'],'after':cursor,'first':20}
  payload={'fb_dtsg':config['DTSGInitialData']['token'],'lsd':config.get('LSD',{}).get('token',''),'doc_id':document,
   'variables':json.dumps(variables),'fb_api_caller_class':'RelayModern','fb_api_req_friendly_name':name+'RefetchableQuery','server_timestamps':'true'}
  text=read(ORIGIN+'/api/graphql',payload);results=[]
  for line in text.removeprefix('for (;;);').splitlines():
   if not line.strip():continue
   result=json.loads(line)
   if result.get('errors'):raise Failure('THREADS_RESPONSE')
   results.append(result.get('data'))
  conn=connection(results,field)
 raise Failure('THREADS_PAGING')
def discover():
 target=spec.get('target');feed=spec.get('feed','saved');posts=[];seen=set();known=set(spec.get('known',[]));stop=spec.get('stopId');limit=spec.get('limit',0);checked=0;skipped=0;failures=[]
 def finish(stopped=False,reached=False,interruption=None):
  if not posts and failures:
   error=Failure('THREADS_FORMAT');error.failures=failures;raise error
  return {'posts':posts,'checked':checked,'skippedText':skipped,'failures':failures,'stoppedEarly':stopped,'stopLinkReached':reached,'stopLinkTargets':[feed] if reached else [],'interruption':interruption}
 if target:
  url=target.get('url','');safe_url(url)
  if not re.fullmatch(r'https://www\.threads\.com/(?:@[A-Za-z0-9_.]{1,80}/post|t)/[A-Za-z0-9_-]{5,40}',url):raise Failure('THREADS_URL')
  page,config,owner=bootstrap(urllib.parse.urlsplit(url).path,False)
  matches=[v for v in walk(page.blocks) if isinstance(v,dict) and v.get('code')==target.get('id') and 'media_type' in v]
  if not matches:raise Failure('THREADS_FORMAT')
  post=post_media(matches[0],'link')
  return {'posts':[post] if post else [],'checked':1,'skippedText':0 if post else 1,'stoppedEarly':False}
 try:
  for conn in pages(feed):
   for edge in conn['edges']:
    checkpoint();items=(edge.get('node') or {}).get('thread_items')
    if not isinstance(items,list) or not items:raise Failure('THREADS_RESPONSE')
    raw=items[0].get('post') or {};code=raw.get('code')
    if not isinstance(code,str) or not re.fullmatch(r'[A-Za-z0-9_-]{5,40}',code):raise Failure('THREADS_RESPONSE')
    if code in seen:continue
    seen.add(code)
    if code==stop or code in known:return finish(True,code==stop)
    checked+=1
    try:
     post=post_media(raw,feed)
     if post:posts.append(post);print(json.dumps({'event':'progress','found':len(posts),'ids':[code]}),flush=True)
     else:skipped+=1
    except Failure as error:
     if str(error)!='THREADS_FORMAT':raise
     failures.append({'code':'THREADS_FORMAT','url':ORIGIN+'/t/'+code})
    if limit and checked>=limit:return finish()
   # Hydrated HTML may contain more posts than one API page. Follow advancing
   # cursors through overlaps; pages() still rejects repeated/missing cursors.
 except Failure as error:
  if not posts or str(error) not in {'THREADS_AUTH','THREADS_RATE_LIMIT','THREADS_HTTP','THREADS_PAGING','THREADS_RESPONSE'}:raise
  return finish(interruption={'code':str(error)})
 except Exception:
  if not posts:raise
  return finish(interruption={'code':'THREADS_NETWORK'})
 return finish()
try:
 spec=json.load(open(sys.argv[1],encoding='utf8'))
 jar=http.cookiejar.MozillaCookieJar(spec['cookies']);jar.load(ignore_discard=True,ignore_expires=True)
 session=requests.Session(cookies=jar,impersonate='chrome')
 try:
  if spec.get('operation')=='probe':
   page,config,owner=bootstrap('/');result={'session':{'username':owner['username']}}
  elif spec.get('operation')=='discover':result=discover()
  else:raise Failure('THREADS_OPERATION')
  print(json.dumps(result))
 finally:session.close()
except Failure as error:
 print(json.dumps({'error':str(error),'failures':getattr(error,'failures',[])}));sys.exit(1)
except Exception:
 print(json.dumps({'error':'THREADS_NETWORK'}));sys.exit(1)
`;
