import {checkpointScript} from './private-python.js';
import {xNetworkScript} from './x-network.js';
import {xPagingScript} from './x-paging.js';
export const xApiScript=String.raw`
import json,sys,re,urllib.parse,http.cookiejar,time,html
from curl_cffi import requests
from gallery_dl import config
from gallery_dl.extractor.twitter import TwitterBookmarkExtractor
class Failure(Exception):pass
${checkpointScript}
${xNetworkScript}
def media_url(value):
 p=urllib.parse.urlsplit(value)
 if p.scheme!='https' or p.username or p.password or p.port or p.hostname not in {'pbs.twimg.com','video.twimg.com'}:raise Failure('X_MEDIA_URL')
 return value
def normalize(tweet):
 legacy=tweet.get('legacy') or {};entities=(legacy.get('extended_entities') or {}).get('media') or []
 if not entities:return None
 components=[]
 for index,media in enumerate(entities,1):
  type=media.get('type');preview=media_url(media.get('media_url_https') or '')
  if type in ('video','animated_gif'):
   variants=[v for v in (media.get('video_info') or {}).get('variants',[]) if v.get('content_type')=='video/mp4']
   if not variants:raise Failure('X_MEDIA')
   chosen=max(variants,key=lambda v:v.get('bitrate',0));url=media_url(chosen.get('url') or '');extension='mp4'
  elif type=='photo':
   p=urllib.parse.urlsplit(preview);extension=p.path.rsplit('.',1)[-1].lower()
   if extension not in ('jpg','jpeg','png','webp','gif'):raise Failure('X_MEDIA')
   url=urllib.parse.urlunsplit((p.scheme,p.netloc,p.path.rsplit('.',1)[0],urllib.parse.urlencode({'format':extension,'name':'orig'}),''))
  else:raise Failure('X_MEDIA')
  components.append({'index':index,'mediaType':'video' if extension=='mp4' else 'image','extension':extension,
   'url':url,'previewUrl':preview,'description':str(media.get('ext_alt_text') or '')[:200000]})
 author=((tweet.get('core') or {}).get('user_results') or {}).get('result') or {}
 username=(author.get('core') or author.get('legacy') or {}).get('screen_name') or ''
 if not re.fullmatch(r'[A-Za-z0-9_]{1,15}',username):raise Failure('X_RESPONSE')
 note=((tweet.get('note_tweet') or {}).get('note_tweet_results') or {}).get('result') or {}
 description=html.unescape(str(note.get('text') or legacy.get('full_text') or legacy.get('text') or ''))[:200000]
 return {'id':str(tweet['rest_id']),'username':username,'description':description,'created':legacy.get('created_at'),'components':components}
${xPagingScript}
try:
 spec=json.load(open(sys.argv[1],encoding='utf8'))
 jar=http.cookiejar.MozillaCookieJar(spec['cookies']);jar.load(ignore_discard=True,ignore_expires=True)
 scoped=[cookie for cookie in jar if cookie.domain.lstrip('.') in {'x.com','twitter.com'}]
 if not all(any(c.name==name and c.value for c in scoped) for name in ('auth_token','ct0','twid')):raise Failure('X_AUTH')
 twid=urllib.parse.unquote(next(c.value for c in scoped if c.name=='twid')).strip('"');uid=re.fullmatch(r'u=(\d+)',twid)
 if not uid:raise Failure('X_AUTH')
 config.set(('cache',),'file',':memory:')
 for key,value in {'cookies':spec['cookies'],'cookies-update':False,'retries':0,'retries-api':0,'ratelimit':'abort','sleep-request':0,
  'cards':False,'articles':False,'twitpic':False,'quoted':False}.items():config.set(('extractor','twitter'),key,value)
 e=TwitterBookmarkExtractor.from_url('https://x.com/i/history');e.initialize()
 session=requests.Session(cookies=jar,impersonate='chrome');e.request=read;e.api._call=api_call
 if not e.api.headers.get('x-twitter-auth-type'):raise Failure('X_AUTH')
 if spec.get('operation')=='probe':
  user=e.api.user_by_rest_id(uid[1]);core=user.get('core') or user.get('legacy') or {}
  if str(user.get('rest_id'))!=uid[1] or not core.get('screen_name'):raise Failure('X_AUTH')
  output={'session':{'username':core['screen_name'],'name':core.get('name') or core['screen_name']}}
 else:
  queries=resolve_queries()
  if spec.get('operation')=='catalog':
   data=graph('BookmarkFoldersSlice',{});node=data['data']['viewer']['user_results']['result']['bookmark_collections_slice']
   items=node['items']
   if not isinstance(items,list):raise Failure('X_RESPONSE')
   # Never silently truncate a catalog that the platform marks incomplete.
   if node.get('next_cursor') or node.get('nextCursor'):raise Failure('X_FOLDERS')
   output={'containers':[{'id':str(v['id']),'name':str(v.get('name') or v['id'])[:500]} for v in items if re.fullmatch(r'\d+',str(v.get('id','')))]}
  elif spec.get('operation')=='discover':output=discover()
  else:raise Failure('X_OPERATION')
 print(json.dumps(output))
except Failure as error:
 print(json.dumps({'error':str(error)}));sys.exit(1)
except Exception:
 print(json.dumps({'error':'X_NETWORK'}));sys.exit(1)
`;
