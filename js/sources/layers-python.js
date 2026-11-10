import {checkpointScript} from './private-python.js';
// Fixed read-only platform API; no website scripts or mutation/view endpoints.
export const layersApiScript=String.raw`
import http.cookiejar,json,sys,urllib.parse,re,time
from curl_cffi import requests
class Failure(Exception):pass
${checkpointScript}
ID=r'[a-z0-9]{10,40}'
def valid_id(value):
 if not isinstance(value,str) or not re.fullmatch(ID,value):raise Failure('LAYERS_RESPONSE')
 return value
def owner_id(value):
 if not isinstance(value,str) or not re.fullmatch(ID+r'|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',value):raise Failure('LAYERS_RESPONSE')
 return value
def safe_url(url):
 p=urllib.parse.urlsplit(url)
 if p.scheme!='https' or p.hostname not in {'layers.to','www.layers.to'} or p.username or p.password or p.port:raise Failure('LAYERS_URL')
 if p.path!='/explore' and not re.fullmatch(r'/api/v1/(?:layers(?:/'+ID+r')?|groups(?:/'+ID+r')?|users/[A-Za-z0-9_.-]{1,80})',p.path):raise Failure('LAYERS_URL')
 return p
def read(url,html=False):
 original=safe_url(url).path
 for attempt in range(4):
  checkpoint()
  if safe_url(url).path!=original:raise Failure('LAYERS_URL')
  until=time.monotonic()+{'safe':2,'balanced':1}.get(spec.get('speed'),0)
  while time.monotonic()<until:checkpoint();time.sleep(.1)
  headers={'Referer':'https://layers.to/explore','Origin':'https://layers.to','Accept':'text/html' if html else 'application/json'}
  if not html:headers['X-CSRF-Token']=csrf
  response=session.get(url,headers=headers,timeout=30,allow_redirects=False)
  if response.status_code in (301,302,303,307,308):url=urllib.parse.urljoin(url,response.headers.get('Location',''));continue
  if response.status_code in (401,403):raise Failure('LAYERS_AUTH')
  if response.status_code==429:raise Failure('LAYERS_RATE_LIMIT')
  if response.status_code!=200:raise Failure('LAYERS_HTTP_'+str(response.status_code))
  if len(response.content)>16*1024*1024:raise Failure('LAYERS_RESPONSE')
  mime=response.headers.get('Content-Type','').lower()
  if ('text/html' if html else 'application/json') not in mime:raise Failure('LAYERS_RESPONSE')
  data=response.text if html else response.json()
  if isinstance(data,dict) and data.get('error'):raise Failure('LAYERS_RESPONSE')
  return data
 raise Failure('LAYERS_URL')
def bootstrap():
 source=read('https://layers.to/explore',html=True)
 match=re.search(r'window\.__remixContext\s*=\s*',source)
 if not match:raise Failure('LAYERS_RESPONSE')
 try:data,end=json.JSONDecoder().raw_decode(source[match.end():])
 except (ValueError,TypeError):raise Failure('LAYERS_RESPONSE')
 root=data.get('state',{}).get('loaderData',{}).get('root') or {}
 token=root.get('csrfToken')
 if not isinstance(token,str) or not token or len(token)>8000 or '\n' in token or '\r' in token:raise Failure('LAYERS_RESPONSE')
 return root.get('user'),token
def pages(resource,filters):
 cursor=None;visited=set();seen_ids=set()
 for page in range(10000):
  query={**filters,'take':24}
  if cursor:query['cursor']=cursor
  data=read('https://layers.to/api/v1/'+resource+'?'+urllib.parse.urlencode(query))
  if not isinstance(data,dict) or not isinstance(data.get('data'),list):raise Failure('LAYERS_RESPONSE')
  batch=data['data'];paging=data.get('pagination')
  if isinstance(paging,dict):
   more=paging.get('hasMore');next=paging.get('nextCursor')
   if type(more)!=bool:raise Failure('LAYERS_RESPONSE')
  elif resource=='groups' and 'nextCursor' in data:
   next=data['nextCursor'];more=next is not None
  else:raise Failure('LAYERS_RESPONSE')
  ids={valid_id(item.get('id')) for item in batch}
  if batch and not ids-seen_ids:raise Failure('LAYERS_PAGING')
  seen_ids.update(ids);yield batch
  if not more:return
  if not batch or not next or valid_id(next) in visited or next==cursor:raise Failure('LAYERS_PAGING')
  visited.add(next);cursor=next
 raise Failure('LAYERS_PAGING')
def catalog(owner):
 result={};uid=owner_id(owner.get('id'))
 for batch in pages('groups',{'userId':uid}):
  for item in batch:
   if item.get('userId')!=uid:raise Failure('LAYERS_RESPONSE')
   id=valid_id(item.get('id'));name=item.get('name')
   if not isinstance(name,str) or not name.strip():raise Failure('LAYERS_RESPONSE')
   result[id]={'id':id,'name':name[:1000],'url':'https://layers.to/collections/'+id}
 return list(result.values())
def media_url(value):
 p=urllib.parse.urlsplit(value);buckets={'layers-uploads-prod.s3.eu-west-2.amazonaws.com','layers-uploads-prod.s3.amazonaws.com','layers-uploads-prod.s3-accelerate.amazonaws.com'}
 path_bucket=p.hostname in {'s3.eu-west-2.amazonaws.com','s3.amazonaws.com'} and p.path.startswith('/layers-uploads-prod/')
 if p.scheme!='https' or p.username or p.password or p.port or p.path in {'','/'} or (p.hostname!='layers-r2.com' and p.hostname not in buckets and not path_bucket):raise Failure('LAYERS_MEDIA_URL')
 return urllib.parse.urlunsplit(p)
def layer(item):
 id=valid_id(item.get('id'));user=item.get('user') or {};author=user.get('username','')
 if not re.fullmatch(r'[A-Za-z0-9_.-]{1,80}',author):raise Failure('LAYERS_RESPONSE')
 url=media_url(item.get('imageUrl') or '');extension=urllib.parse.urlsplit(url).path.rsplit('.',1)[-1].lower()
 videos={'mp4','mov','webm','m4v','avi'};images={'jpg','jpeg','png','gif','webp','avif','tiff','svg'}
 if extension not in videos|images:raise Failure('LAYERS_FORMAT')
 # The site's video renderer serves the original object key from its R2 CDN.
 if extension in videos and urllib.parse.urlsplit(url).hostname!='layers-r2.com':
  path=urllib.parse.urlsplit(url).path
  if path.startswith('/layers-uploads-prod/'):path=path[len('/layers-uploads-prod'):]
  url=media_url('https://layers-r2.com'+path)
 preview=media_url(item['posterUrl']) if item.get('posterUrl') else '' if extension in videos else url
 return {'id':id,'url':'https://layers.to/layers/'+id,'title':str(item.get('title') or '')[:2000],
  'description':str(item.get('description') or '')[:200000],'author':author,'created':item.get('createdAt'),
  'components':[{'index':1,'mediaType':'video' if extension in videos else 'image','url':url,'previewUrl':preview,'extension':extension}]}
try:
 spec=json.load(open(sys.argv[1],encoding='utf8'))
 jar=http.cookiejar.MozillaCookieJar(spec['cookies']);jar.load(ignore_discard=True,ignore_expires=True)
 session=requests.Session(cookies=jar,impersonate='chrome');csrf='';user,csrf=bootstrap()
 operation=spec.get('operation');target=spec.get('target') or {}
 liked=spec.get('feed')=='liked'
 if (liked or operation in {'probe','catalog'} or not target) and (not isinstance(user,dict) or not user.get('username')):raise Failure('LAYERS_AUTH')
 if operation=='probe':
  print(json.dumps({'session':{'username':user['username'],'name':str(user.get('fullName') or user['username'])[:500]}}))
 elif operation=='catalog':print(json.dumps({'containers':catalog(user)}))
 elif operation=='discover':
  targets=spec.get('collections') or []
  if liked:targets=[{'id':owner_id(user.get('id')),'type':'LIKED','name':'Likes'}]
  elif target.get('type')=='POST':targets=[target]
  elif target.get('type')=='COLLECTION':targets=[target]
  elif target.get('type')=='ROOT':
   username=target.get('username','')
   if not re.fullmatch(r'[A-Za-z0-9_.-]{1,80}',username):raise Failure('LAYERS_URL')
   owner=read('https://layers.to/api/v1/users/'+username)
   if not isinstance(owner,dict) or owner.get('username')!=username:raise Failure('LAYERS_RESPONSE')
   targets=catalog(owner)
  elif target:raise Failure('LAYERS_URL')
  elif not targets:targets=catalog(user)
  posts={};known=set(spec.get('known',[]));boundary=str(spec.get('stopId') or '');limit=max(0,int(spec.get('limit',0)))
  per_folder=bool(spec.get('perFolder'));stop_targets=[];stopped=False;checked=0
  for container in targets:
   id=owner_id(container.get('id')) if liked else valid_id(container.get('id'));count=0;seen=set();stop=False
   batches=[[read('https://layers.to/api/v1/layers/'+id)]] if container.get('type')=='POST' else pages('layers',{'likerId':id} if liked else {'groupId':id})
   for batch in batches:
    for item in batch:
     post_id=valid_id(item.get('id'))
     if container.get('type')=='POST' and post_id!=id:raise Failure('LAYERS_RESPONSE')
     if post_id==boundary or post_id in known:
      stopped=True;stop=True
      if post_id==boundary:stop_targets.append(id)
      break
     if post_id in seen:continue
     seen.add(post_id);checked+=1;count+=1
     if post_id not in posts:posts[post_id]={**layer(item),'collections':[],**({'feed':'liked'} if liked else {})}
     if not liked and not any(ref['id']==id for ref in posts[post_id]['collections']):posts[post_id]['collections'].append({'id':id,'name':str(container.get('name') or id),'url':'https://layers.to/'+('layers/' if container.get('type')=='POST' else 'collections/')+id})
     print(json.dumps({'event':'progress','found':len(posts),'ids':[post_id]}),flush=True)
     if limit and (count>=limit if per_folder else len(posts)>=limit):stop=True;break
    if stop:break
   if not per_folder and (stopped or limit and len(posts)>=limit):break
  print(json.dumps({'posts':list(posts.values()),'checked':checked,'stoppedEarly':stopped,'stopLinkReached':bool(stop_targets),'stopLinkTargets':stop_targets}))
 else:raise Failure('LAYERS_OPERATION')
except Failure as error:
 print(json.dumps({'error':str(error)}));sys.exit(1)
except Exception:
 print(json.dumps({'error':'LAYERS_NETWORK'}));sys.exit(1)
`;
