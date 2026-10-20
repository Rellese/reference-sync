// Parse only data scripts; never execute downloaded JavaScript or HTML.
export const threadsParsingScript=String.raw`
class PageData(HTMLParser):
 def __init__(self,source):
  super().__init__(convert_charrefs=True);self.blocks=[];self.assets=[];self.current=None;self.feed(source)
 def handle_starttag(self,tag,attrs):
  if tag!='script':return
  a=dict(attrs)
  if a.get('src'):self.assets.append(a['src'])
  self.current=[] if a.get('type')=='application/json' else None
 def handle_data(self,data):
  if self.current is not None:self.current.append(data)
 def handle_endtag(self,tag):
  if tag=='script' and self.current is not None:
   try:self.blocks.append(json.loads(''.join(self.current)))
   except (ValueError,TypeError):raise Failure('THREADS_RESPONSE')
   self.current=None
def walk(root):
 queue=[(root,0)];count=0
 while queue:
  value,depth=queue.pop();count+=1
  if depth>80 or count>600000:raise Failure('THREADS_RESPONSE')
  yield value
  if isinstance(value,dict):queue.extend((v,depth+1) for v in reversed(list(value.values())) if isinstance(v,(dict,list)))
  elif isinstance(value,list):queue.extend((v,depth+1) for v in reversed(value) if isinstance(v,(dict,list)))
def modules(blocks):
 return {v[0]:v[2] for v in walk(blocks) if isinstance(v,list) and len(v)>=3 and isinstance(v[0],str) and isinstance(v[2],dict)}
def connection(blocks,field):
 for value in walk(blocks):
  if not isinstance(value,dict):continue
  viewer=value.get('xdt_text_app_viewer')
  if isinstance(viewer,dict) and field in viewer:
   conn=viewer[field]
   if not isinstance(conn,dict) or not isinstance(conn.get('edges'),list) or not isinstance(conn.get('page_info'),dict):raise Failure('THREADS_RESPONSE')
   return conn
 raise Failure('THREADS_RESPONSE')
def media_url(value):
 if not isinstance(value,str):raise Failure('THREADS_MEDIA_URL')
 p=urllib.parse.urlsplit(value)
 if p.scheme!='https' or p.username or p.password or p.port or p.path in {'','/'} or not any((p.hostname or '').endswith('.'+host) for host in ('cdninstagram.com','fbcdn.net')):raise Failure('THREADS_MEDIA_URL')
 return value
def candidate(values):
 if not isinstance(values,list) or not values:raise Failure('THREADS_FORMAT')
 best=max(values,key=lambda v:(v.get('width') or 0)*(v.get('height') or 0))
 return media_url(best.get('url'))
def post_media(post,feed):
 code=post.get('code');author=(post.get('user') or {}).get('username')
 if not isinstance(code,str) or not re.fullmatch(r'[A-Za-z0-9_-]{5,40}',code) or not isinstance(author,str) or not re.fullmatch(r'[A-Za-z0-9_.]{1,80}',author):raise Failure('THREADS_RESPONSE')
 kind=post.get('media_type');items=post.get('carousel_media') if kind==8 else [post]
 if kind==19:return None
 if kind not in (1,2,8) or not isinstance(items,list) or not items or len(items)>100:raise Failure('THREADS_FORMAT')
 if post.get('carousel_media_count') is not None and post['carousel_media_count']!=len(items):raise Failure('THREADS_FORMAT')
 components=[]
 for i,item in enumerate(items,1):
  typ=item.get('media_type')
  if typ not in (1,2):raise Failure('THREADS_FORMAT')
  preview=candidate((item.get('image_versions2') or {}).get('candidates'))
  url=candidate(item.get('video_versions')) if typ==2 else preview
  extension='mp4' if typ==2 else urllib.parse.urlsplit(url).path.rsplit('.',1)[-1].lower()
  if extension not in {'jpg','jpeg','png','webp','gif','avif','heic','mp4'}:raise Failure('THREADS_FORMAT')
  components.append({'index':i,'mediaType':'video' if typ==2 else 'image','url':url,'previewUrl':preview,'extension':extension})
 return {'id':code,'author':author,'url':'https://www.threads.com/@'+author+'/post/'+code,
  'description':str((post.get('caption') or {}).get('text') or '')[:200000],'takenAt':post.get('taken_at') or 0,'components':components,'feed':feed}
`;
