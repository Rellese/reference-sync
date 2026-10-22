import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {COVER_FETCH_SCRIPT} from '../../js/case/cover-python.js';

test('Python cover transport validates every redirect, size and credential boundary without browser data',t=>{
 const available=spawnSync('python3',['--version']);
 if(available.status!==0){t.skip('Python 3 required for helper fixture');return;}
 const fixture=`
import sys,types,base64
calls=[]
class Reply:
    def __init__(self,status,headers,data=b'png'):
        self.status_code,self.headers,self.data=status,headers,data
    def __enter__(self): return self
    def __exit__(self,*args): pass
    def raise_for_status(self): assert self.status_code==200
    def iter_content(self,size): yield self.data
class Session:
    def __init__(self): self.cookies=set(); self.headers={}
    def get(self,url,**kwargs):
        assert self.auth('request')=='request'
        assert not self.cookies
        assert kwargs['allow_redirects'] is False and kwargs['stream'] is True
        assert 'verify' not in kwargs # requests' verified TLS default
        assert kwargs['timeout']>0
        calls.append(url)
        self.cookies.add('anonymous')
        return replies.pop(0)
sys.modules['requests']=types.SimpleNamespace(Session=Session)
script=base64.b64decode(sys.argv[1]).decode()
start='https://mir-s3-cdn-cf.behance.net/cover.png'
def run(queue):
    global replies
    replies=queue;calls.clear();sys.argv=['helper',start,'8','10']
    exec(script,{})
run([Reply(302,{'Location':'/other.png'}),Reply(200,{},b'png')])
assert calls==[start,'https://mir-s3-cdn-cf.behance.net/other.png']
for location in ['http://mir-s3-cdn-cf.behance.net/a','https://example.test/a','https://user:pass@mir-s3-cdn-cf.behance.net/a','https://mir-s3-cdn-cf.behance.net:444/a']:
    try: run([Reply(302,{'Location':location}),Reply(200,{})])
    except ValueError: assert calls==[start]
    else: raise AssertionError('Unsafe redirect accepted')
for response in [Reply(200,{'Content-Length':'9'}),Reply(200,{},b'123456789')]:
    try: run([response])
    except ValueError: pass
    else: raise AssertionError('Oversized response accepted')
`;
 const result=spawnSync('python3',['-c',fixture,Buffer.from(COVER_FETCH_SCRIPT).toString('base64')],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});
