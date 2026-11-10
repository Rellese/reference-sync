import test from 'node:test';import assert from 'node:assert/strict';
import {embeddedVideoTarget,selectVimeoStream,vimeoPlayerUrl,vimeoStreamUrl} from '../../js/case/vimeo-config.js';
import {requireFullDuration} from '../../js/case/vimeo-stream.js';
const player='https://player.vimeo.com/video/123?h=abc&muted=1';
const target={id:'123',referrer:'https://www.behance.net/gallery/456/a'};
const config={id:'123',nodeAccess:false,duration:20,files:{hls:{default_cdn:'main',cdns:{main:{url:'https://cdn.vimeocdn.com/playlist.m3u8?token=fixture'}}}}};

test('embedded recovery uses exactly the selected Behance video and original player query',()=>{
 const post={url:target.referrer,components:[{index:7,mediaType:'video',url:'ytdl:'+player},{index:8,mediaType:'video',url:player.replace('123','789')}]};
 assert.deepEqual(embeddedVideoTarget(post,7),{...target,url:player});assert.equal(embeddedVideoTarget(post,6),null);
 post.caseDocument={blocks:[{kind:'video',componentNumber:7,embedUrl:player.replace('muted=1','muted=0')}]};
 assert.equal(embeddedVideoTarget(post,7).url,player.replace('muted=1','muted=0'));
 for(const url of [target.referrer.replace('https:','http:'),'https://behance.net.attacker.test/gallery/456/a','https://user:pass@www.behance.net/gallery/456/a'])assert.equal(embeddedVideoTarget({...post,url},7),null);
});
test('player and stream URLs reject plaintext, credentials, spoofed hosts, local files and other videos',()=>{
 for(const url of ['http://player.vimeo.com/video/123','https://player.vimeo.com.attacker.test/video/123','file:///video/123','https://user@player.vimeo.com/video/123','https://player.vimeo.com:444/video/123','https://player.vimeo.com/video/123/other'])assert.equal(vimeoPlayerUrl(url),null);
 for(const url of ['http://cdn.vimeocdn.com/a.mp4','https://vimeocdn.com.attacker.test/a.mp4','https://user:pass@cdn.vimeocdn.com/a.mp4','file:///a.mp4','https://127.0.0.1/a.mp4','https://cdn.vimeocdn.com:444/a.mp4'])assert.equal(vimeoStreamUrl(url),null);
});
test('configuration selects a complete manifest or highest-width progressive file, never observed segments',()=>{
 assert.equal(selectVimeoStream(config,target).kind,'hls');
 const files={...config.files,progressive:[{width:640,url:'https://cdn.vimeocdn.com/low.mp4'},{width:1920,url:'https://cdn.vimeocdn.com/high.mp4'},{width:4000,url:'http://cdn.vimeocdn.com/unsafe.mp4'}]};
 assert.equal(selectVimeoStream({...config,files},target).url,'https://cdn.vimeocdn.com/high.mp4');
 assert.throws(()=>selectVimeoStream({...config,files:{},resources:['https://cdn.vimeocdn.com/segment.mp4']},target),/полный видеопоток/);
});
test('foreign video, privileged guest, missing duration and unsafe manifests cannot produce an importable stream',()=>{
 for(const change of [{id:'999'},{nodeAccess:true},{nodeAccess:undefined},{duration:0},{duration:Infinity},
  {files:{hls:{default_cdn:'a',cdns:{a:{url:'http://cdn.vimeocdn.com/a.m3u8'}}}}}])assert.throws(()=>selectVimeoStream({...config,...change},target));
});
test('full-duration validation rejects short segments and truncated or missing durations',()=>{
 requireFullDuration(20.04,20);
 for(const duration of [0,NaN,2,18,25])assert.throws(()=>requireFullDuration(duration,20),/Длительность/);
});
