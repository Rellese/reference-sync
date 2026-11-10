import {browserCookiesScript,checkpointScript} from './private-python.js';
export const vimeoCookiesScript=browserCookiesScript;
export const vimeoCheckpointScript=checkpointScript;
export const vimeoApiScript=String.raw`
import http.cookiejar,json,sys,urllib.parse,re,time
from curl_cffi import requests
class Failure(Exception):pass
${vimeoCheckpointScript}
try:
 spec=json.load(open(sys.argv[1],encoding='utf8'))
 jar=http.cookiejar.MozillaCookieJar(spec['cookies']);jar.load(ignore_discard=True,ignore_expires=True)
 session=requests.Session(cookies=jar,impersonate='chrome')
 def read(url,headers=None):
  for attempt in range(4):
   checkpoint()
   delay={'safe':2,'balanced':1}.get(spec.get('speed'),0)
   until=time.monotonic()+delay
   while time.monotonic()<until:checkpoint();time.sleep(.1)
   parsed=urllib.parse.urlsplit(url)
   if parsed.scheme!='https' or parsed.hostname not in {'vimeo.com','www.vimeo.com','api.vimeo.com'} or parsed.username or parsed.password or parsed.port:raise Failure('VIMEO_URL')
   response=session.get(url,headers=headers or {},timeout=30,allow_redirects=False)
   if response.status_code in (301,302,303,307,308):
    location=urllib.parse.urljoin(url,response.headers.get('Location',''))
    if urllib.parse.urlsplit(location).hostname!=parsed.hostname:raise Failure('VIMEO_URL')
    url=location;continue
   if response.status_code in (401,403):raise Failure('VIMEO_AUTH')
   if response.status_code==429:raise Failure('VIMEO_RATE_LIMIT')
   if response.status_code!=200:raise Failure('VIMEO_HTTP_'+str(response.status_code))
   if len(response.content)>16*1024*1024:raise Failure('VIMEO_RESPONSE')
   return response.json()
  raise Failure('VIMEO_URL')
 viewer=read('https://vimeo.com/_next/viewer')
 token=viewer.get('jwt')
 if not isinstance(token,str) or not token:raise Failure('VIMEO_AUTH')
 headers={'Authorization':'jwt '+token,'Accept':'application/json'}
 operation=spec.get('operation')
 def pages(resource,fields):
  if not re.fullmatch(r'/me/(?:likes|watchlater|albums)|/albums/\d+/videos',resource):raise Failure('VIMEO_URL')
  url='https://api.vimeo.com'+resource+'?'+urllib.parse.urlencode({'per_page':100,'fields':fields,'sort':'date','direction':'desc'})
  visited=set();own_uri=None;last_page=0
  while url:
   parsed=urllib.parse.urlsplit(url)
   page_value=urllib.parse.parse_qs(parsed.query).get('page',['1'])
   if len(page_value)!=1 or not re.fullmatch(r'[1-9]\d*',page_value[0]) or int(page_value[0])<=last_page:raise Failure('VIMEO_PAGING')
   last_page=int(page_value[0])
   if resource.startswith('/me/') and parsed.path!=resource and own_uri is None:
    own_uri=read('https://api.vimeo.com/me?fields=uri',headers).get('uri')
   canonical=(own_uri or '')+resource[3:] if resource.startswith('/me/') else resource
   if parsed.scheme!='https' or parsed.netloc!='api.vimeo.com' or parsed.path not in {resource,canonical} or url in visited or len(visited)>=10000:raise Failure('VIMEO_PAGING')
   visited.add(url);page=read(url,headers)
   if not isinstance(page.get('data'),list):raise Failure('VIMEO_RESPONSE')
   yield page['data']
   next=page.get('paging',{}).get('next')
   url=urllib.parse.urljoin('https://api.vimeo.com',next) if next else None
 if operation=='probe':
  me=read('https://api.vimeo.com/me?fields=uri,name,link',headers)
  print(json.dumps({'session':{'uri':me.get('uri'),'name':me.get('name'),'link':me.get('link')}}))
 elif operation=='catalog':
  result=[]
  for batch in pages('/me/albums','uri,name'):
   for item in batch:
    match=re.fullmatch(r'/users/\d+/albums/(\d+)|/albums/(\d+)',str(item.get('uri','')))
    if match:result.append({'id':next(n for n in match.groups() if n),'name':str(item.get('name') or 'Vimeo')[:500]})
  print(json.dumps({'containers':result}))
 elif operation=='discover':
  resource=spec.get('resource','');result=[];stopped=False
  known=set(spec.get('known',[]));seen_ids=set();boundary=str(spec.get('stopId') or '');limit=max(0,int(spec.get('limit',0)))
  fields='uri,link,name,description,duration,created_time,pictures.sizes.link,user.name,user.link'
  if re.fullmatch(r'/videos/\d+(?::[a-f0-9]{10})?',resource):batches=[[read('https://api.vimeo.com'+resource+'?'+urllib.parse.urlencode({'fields':fields}),headers)]]
  else:batches=pages(resource,fields)
  for batch in batches:
   page_ids=[]
   for item in batch:
    match=re.match(r'^/videos/(\d+)(?::([a-f0-9]{10}))?$',str(item.get('uri','')))
    if not match:raise Failure('VIMEO_RESPONSE')
    id=match[1]
    if id==boundary or id in known:stopped=True;break
    if id in seen_ids:continue
    seen_ids.add(id)
    user=item.get('user') or {};sizes=(item.get('pictures') or {}).get('sizes') or []
    page_ids.append(id)
    # API links can be custom author/title permalinks. Download the verified
    # video URI's ID on HTTPS; preserve only a validated unlisted access hash.
    access_hash=match[2] or '';link=urllib.parse.urlsplit(str(item.get('link') or ''))
    if link.scheme in ('http','https') and link.hostname in ('vimeo.com','www.vimeo.com','player.vimeo.com') and not link.username and not link.password and not link.port:
     hidden=re.fullmatch('/'+id+r'/([a-f0-9]{10})/?',link.path,re.I)
     candidate=hidden[1] if hidden else urllib.parse.parse_qs(link.query).get('h',[''])[0] if link.path.rstrip('/') in ('/'+id,'/video/'+id) else ''
     if re.fullmatch(r'[a-f0-9]{10}',candidate,re.I):access_hash=candidate.lower()
    result.append({'id':id,'url':'https://vimeo.com/'+id+('/'+access_hash if access_hash else ''),'title':str(item.get('name') or '')[:2000],
     'description':str(item.get('description') or '')[:200000],'created':item.get('created_time'),'author':str(user.get('name') or '')[:500],
     'thumbnail':sizes[-1].get('link') if sizes else ''})
    if limit and len(result)>=limit:break
   print(json.dumps({'event':'progress','found':len(result),'ids':page_ids}),flush=True)
   if stopped or (limit and len(result)>=limit):break
  print(json.dumps({'posts':result,'stoppedEarly':stopped,'stopLinkReached':bool(stopped and boundary and id==boundary)}))
 else:
  raise Failure('VIMEO_OPERATION')
except Failure as error:
 print(json.dumps({'error':str(error)}));sys.exit(1)
except Exception:
 print(json.dumps({'error':'VIMEO_NETWORK'}));sys.exit(1)
`;
