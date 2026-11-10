// Fixed Python helper; reads X only. Credentials never leave the process.
export const xNetworkScript=String.raw`
def safe_url(url):
 p=urllib.parse.urlsplit(url)
 if p.scheme!='https' or p.username or p.password or p.port or p.hostname not in {'x.com','www.x.com','twitter.com','www.twitter.com','abs.twimg.com'}:raise Failure('X_URL')
 return p
def read(url,method='GET',params=None,headers=None,**kwargs):
 if method!='GET':raise Failure('X_URL')
 for attempt in range(4):
  checkpoint();p=safe_url(url)
  if headers and p.hostname not in {'x.com','www.x.com'}:raise Failure('X_URL')
  until=time.monotonic()+{'safe':2,'balanced':1}.get(spec.get('speed'),0)
  while time.monotonic()<until:checkpoint();time.sleep(.1)
  response=session.get(url,params=params,headers=headers or {},timeout=30,allow_redirects=False)
  if response.status_code in (301,302,303,307,308):
   location=urllib.parse.urljoin(url,response.headers.get('Location',''))
   if safe_url(location).hostname!=p.hostname:raise Failure('X_URL')
   url=location;params=None;continue
  if response.status_code==429:raise Failure('X_RATE_LIMIT')
  if response.status_code in (401,403):raise Failure('X_AUTH')
  if response.status_code!=200:raise Failure('X_RESPONSE')
  if len(response.content)>12*1024*1024:raise Failure('X_RESPONSE')
  return response
 raise Failure('X_URL')
def api_call(endpoint,params,method='GET',auth=True,root=None):
 if method!='GET' or root not in (None,'https://x.com/i/api') or not re.fullmatch(r'/graphql/[\w-]+/[A-Za-z]+',endpoint):raise Failure('X_URL')
 url=e.api.root+endpoint
 e.api._transaction_id(url,'GET')
 data=read(url,params=params,headers=e.api.headers).json()
 if data.get('errors'):
  codes={item.get('code') for item in data['errors']}
  raise Failure('X_RATE_LIMIT' if 88 in codes else 'X_FOLDERS' if 37 in codes and 'BookmarkFolder' in endpoint else 'X_AUTH' if codes&{32,37,89,215,326} else 'X_RESPONSE')
 return data
def graph(name,variables):
 query=queries.get(name)
 if not query:raise Failure('X_FOLDERS' if 'Folder' in name else 'X_RESPONSE')
 return api_call('/graphql/'+query+'/'+name,{'variables':json.dumps(variables,separators=(',',':')),
  'features':json.dumps(e.api.features_pagination,separators=(',',':')),'fieldToggles':json.dumps({'withArticleRichContentState':False})})
def resolve_queries():
 # Read endpoint IDs from the platform's current public JS; never execute JS.
 home=read('https://x.com/home').text
 urls=re.findall(r'<script[^>]+src=["\'](https://abs\.twimg\.com/responsive-web/client-web/[^"\']+\.js)["\']',home)
 result={};bundles=[home]
 liked=spec.get('feed')=='liked'
 wanted={'Likes'} if liked else {'Bookmarks','BookmarkFoldersSlice','BookmarkFolderTimeline','TweetResultByRestId'}
 for url in urls[:8]:
  if '/main.' not in url:continue
  bundles.append(read(url).text)
 for bundle in bundles:
  for id,name in re.findall(r'queryId:"([\w-]+)",operationName:"([A-Za-z]+)"',bundle):
   if name in wanted:result[name]=id
 # X may put folder operations in a lazy bundle. Resolve only Bookmarks chunks
 # from the verified main chunk table, with bounded requests and strict URLs.
 for bundle in bundles:
  names=dict(re.findall(r'(\d+):"([A-Za-z0-9_.~]*(?:Like|Profile)[A-Za-z0-9_.~]*)"' if liked else r'(\d+):"([A-Za-z0-9_.~]*Bookmark[A-Za-z0-9_.~]*)"',bundle))
  hashes=dict(re.findall(r'(\d+):"([a-f0-9]{8,32})"',bundle))
  for id,name in list(names.items())[:8]:
   if wanted.issubset(result):break
   if id not in hashes:continue
   source=read('https://abs.twimg.com/responsive-web/client-web/'+name+'.'+hashes[id]+'a.js').text
   for qid,operation in re.findall(r'queryId:"([\w-]+)",operationName:"([A-Za-z]+)"',source):
    if operation in wanted:result[operation]=qid
 return result
`;
