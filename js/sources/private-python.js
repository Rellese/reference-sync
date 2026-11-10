// Cookies are scoped before writing for each source.
export const browserCookiesScript=String.raw`
import http.cookiejar,json,sys
from yt_dlp.cookies import extract_cookies_from_browser
class Silent:
 def __getattr__(self,name):return lambda *args,**kwargs:None
try:
 site=sys.argv[4] if len(sys.argv)>4 else 'vimeo'
 domains={'vimeo':('vimeo.com',),'x':('x.com','twitter.com'),'dribbble':('dribbble.com',),'layers':('layers.to',),'instagram':('instagram.com',),'threads':('threads.com','threads.net')}[site]
 browser,sep,profile=sys.argv[2].partition(':')
 if browser=='file':
  source=http.cookiejar.MozillaCookieJar(sys.argv[3]);source.load(ignore_discard=True,ignore_expires=True)
 else:
  if browser not in {'brave','chrome','chromium','edge','firefox','opera','safari','vivaldi'}:raise ValueError()
  source=extract_cookies_from_browser(browser,profile or None,logger=Silent())
 jar=http.cookiejar.MozillaCookieJar(sys.argv[1])
 for cookie in source:
  domain=cookie.domain.lstrip('.').lower()
  if any(domain==base or domain.endswith('.'+base) for base in domains):jar.set_cookie(cookie)
 jar.save(ignore_discard=True,ignore_expires=True)
 print(json.dumps({'ok':True}))
except Exception:
 print(json.dumps({'error':'COOKIE_EXPORT'}));sys.exit(1)
`;

export const checkpointScript=String.raw`
def checkpoint():
 if not spec.get('control'):return
 while True:
  with open(spec['control'],encoding='utf8') as handle:state=json.loads(handle.read(100))
  if state.get('stopped'):raise Failure('JOB_STOPPED')
  if not state.get('paused'):return
  time.sleep(.1)
`;
