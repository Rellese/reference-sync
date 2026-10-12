import {checkpointScript} from './private-python.js';
import {dribbbleDomScript} from './dribbble-dom.js';
import {dribbbleShotScript} from './dribbble-shot.js';
// Read-only HTML requests; never execute scripts or change account data.
export const dribbbleApiScript=String.raw`
import http.cookiejar,json,sys,urllib.parse,re,time
from curl_cffi import requests
class Failure(Exception):pass
${checkpointScript}
def safe_url(url):
 p=urllib.parse.urlsplit(url)
 if p.scheme!='https' or p.hostname not in {'dribbble.com','www.dribbble.com'} or p.username or p.password or p.port:raise Failure('DRIBBBLE_URL')
 if not (p.path=='/' or re.fullmatch(r'/shots/\d+(?:-[^/]+)?/?',p.path) or re.fullmatch(r'/[A-Za-z0-9_-]{1,80}/(?:likes|collections(?:/\d+(?:-[^/]+)?)?)/?',p.path)):raise Failure('DRIBBBLE_URL')
 return p
def resource(p):
 match=re.fullmatch(r'/shots/(\d+)(?:-[^/]+)?/?',p.path)
 if match:return ('POST',match[1])
 match=re.fullmatch(r'/([A-Za-z0-9_-]{1,80})/collections(?:/(\d+)(?:-[^/]+)?)?/?',p.path)
 if match:return ('COLLECTIONS',match[1],match[2])
 match=re.fullmatch(r'/([A-Za-z0-9_-]{1,80})/likes/?',p.path)
 if match:return ('LIKES',match[1])
 return ('HOME',)
def read(url,fragment=False):
 expected=resource(safe_url(url))
 for attempt in range(4):
  checkpoint()
  if resource(safe_url(url))!=expected:raise Failure('DRIBBBLE_URL')
  until=time.monotonic()+{'safe':2,'balanced':1}.get(spec.get('speed'),0)
  while time.monotonic()<until:checkpoint();time.sleep(.1)
  response=session.get(url,headers={'X-Requested-With':'XMLHttpRequest'} if fragment else {},timeout=30,allow_redirects=False)
  if response.status_code in (301,302,303,307,308):
   url=urllib.parse.urljoin(url,response.headers.get('Location',''))
   if resource(safe_url(url))!=expected:raise Failure('DRIBBBLE_URL')
   continue
  if response.status_code==202:raise Failure('DRIBBBLE_CHALLENGE')
  if response.status_code in (401,403):raise Failure('DRIBBBLE_AUTH')
  if response.status_code==429:raise Failure('DRIBBBLE_RATE_LIMIT')
  if response.status_code!=200:raise Failure('DRIBBBLE_HTTP_'+str(response.status_code))
  if len(response.content)>16*1024*1024 or 'text/html' not in response.headers.get('Content-Type','').lower():raise Failure('DRIBBBLE_RESPONSE')
  return response.text
 raise Failure('DRIBBBLE_URL')
${dribbbleDomScript}
${dribbbleShotScript}
def collection_pages(target):
 url=target['url'];safe_url(url);page=1;visited=set();previous=set()
 if target.get('type')=='LIKED':
  if resource(safe_url(url))!=('LIKES',profile):raise Failure('DRIBBBLE_URL')
 elif not re.fullmatch(r'/[A-Za-z0-9_-]{1,80}/collections/'+re.escape(str(target['id']))+r'(?:-[^/]+)?/?',urllib.parse.urlsplit(url).path):raise Failure('DRIBBBLE_URL')
 while url:
  if url in visited or len(visited)>=10000:raise Failure('DRIBBBLE_PAGING')
  visited.add(url);fragment=target.get('type')=='LIKED' and page>1
  root=Tree(read(url,fragment)).root
  if not fragment:identity(root)
  batch=cards(root,fragment)
  ids={item['id'] for item in batch}
  if batch and not ids-previous:raise Failure('DRIBBBLE_PAGING')
  previous.update(ids);yield batch
  if target.get('type')=='LIKED' and fragment:
   if not batch:return
   page+=1;url=target['url']+'?'+urllib.parse.urlencode({'page':page,'per_page':24});continue
  next=pagination(root,url,page)
  if target.get('type')=='LIKED' and not next and first(root,lambda n:n.tag=='a' and n.has('load-more')):
   if not batch:raise Failure('DRIBBBLE_PAGING')
   next=target['url']+'?'+urllib.parse.urlencode({'page':page+1,'per_page':24})
  if next and not batch:raise Failure('DRIBBBLE_PAGING')
  url=next;page=int(urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)['page'][0]) if url else page
try:
 spec=json.load(open(sys.argv[1],encoding='utf8'))
 jar=http.cookiejar.MozillaCookieJar(spec['cookies']);jar.load(ignore_discard=True,ignore_expires=True)
 identity_spec=spec.get('identity') or {};headers=identity_spec.get('headers') or {}
 if any(k not in {'User-Agent','sec-ch-ua','sec-ch-ua-platform'} or not isinstance(v,str) or len(v)>500 or '\n' in v or '\r' in v for k,v in headers.items()):raise Failure('DRIBBBLE_RESPONSE')
 session=requests.Session(cookies=jar,impersonate='firefox' if identity_spec.get('impersonate')=='firefox' else 'chrome',headers=headers)
 operation=spec.get('operation');profile=identity(Tree(read('https://dribbble.com/dribbble/collections')).root)
 if operation=='probe':print(json.dumps({'session':{'username':profile,'name':profile}}))
 elif operation=='catalog':print(json.dumps({'containers':catalog(profile)}))
 elif operation=='discover':
  direct=spec.get('target') or {};targets=spec.get('collections') or []
  liked=spec.get('feed')=='liked'
  if liked:targets=[{'id':'liked','type':'LIKED','name':'Likes','url':'https://dribbble.com/'+profile+'/likes'}]
  elif direct.get('type')=='POST':
   if not re.fullmatch(r'\d+',str(direct.get('id',''))) or not re.fullmatch('/shots/'+str(direct['id'])+r'(?:-[^/]+)?/?',safe_url(direct['url']).path):raise Failure('DRIBBBLE_URL')
   targets=[direct]
  elif direct.get('type')=='COLLECTION':targets=[direct]
  elif direct.get('type')=='ROOT':
   owner=direct.get('username','')
   if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',owner):raise Failure('DRIBBBLE_URL')
   targets=catalog(owner)
  elif direct:raise Failure('DRIBBBLE_URL')
  elif not targets:targets=catalog(profile)
  known=set(spec.get('known',[]));boundary=str(spec.get('stopId') or '');limit=max(0,int(spec.get('limit',0)))
  per_folder=bool(spec.get('perFolder'));posts={};stopped=False;stop_targets=[];checked=0
  for target in targets:
   checkpoint();seen=set();count=0;stop=False
   batches=[[target]] if target.get('type')=='POST' else collection_pages(target)
   for batch in batches:
    for item in batch:
     id=item['id']
     if id==boundary or id in known:
      stopped=True;stop=True
      if id==boundary:stop_targets.append(str(target['id']))
      break
     if id in seen:continue
     seen.add(id);count+=1;checked+=1
     if id not in posts:posts[id]={**shot(item),'collections':[],**({'feed':'liked'} if liked else {})}
     refs=posts[id]['collections']
     if not liked and not any(str(ref['id'])==str(target['id']) for ref in refs):refs.append({k:target[k] for k in ('id','name','url')})
     print(json.dumps({'event':'progress','found':len(posts),'ids':[id]}),flush=True)
     if limit and (count>=limit if per_folder else len(posts)>=limit):stop=True;break
    if stop:break
   if not per_folder and (stopped or limit and len(posts)>=limit):break
  print(json.dumps({'posts':list(posts.values()),'checked':checked,'stoppedEarly':stopped,'stopLinkReached':bool(stop_targets),'stopLinkTargets':stop_targets}))
 else:raise Failure('DRIBBBLE_OPERATION')
except Failure as error:
 print(json.dumps({'error':str(error)}));sys.exit(1)
except Exception:
 print(json.dumps({'error':'DRIBBBLE_NETWORK'}));sys.exit(1)
`;
