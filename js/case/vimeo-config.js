// Read only the selected player's configuration. Network resource MP4s can be
// short DASH/HLS fragments and are never treated as complete video files.
export const VIMEO_CONFIG_SCRIPT = `(() => {
 const c = window.playerConfig;
 return {nodeAccess:typeof require!=='undefined'||typeof process!=='undefined'||typeof eagle!=='undefined',
  id:String(c?.video?.id || ''),duration:c?.video?.duration,files:c?.request?.files};
})()`;

export function vimeoPlayerUrl(value) {
 try {
  const u=new URL(String(value || '').replace(/^ytdl:/,''));
  if(u.protocol!=='https:'||u.hostname!=='player.vimeo.com'||u.port||u.username||u.password||!/^\/video\/\d+$/.test(u.pathname))return null;
  return {url:u.href,id:u.pathname.split('/').pop()};
 }catch{return null;}
}

export function embeddedVideoTarget(post,number) {
 try {
  const ref=new URL(post?.url);
  if(ref.protocol!=='https:'||!['www.behance.net','behance.net'].includes(ref.hostname)||ref.port||ref.username||ref.password||!/^\/gallery\/\d+(?:\/|$)/.test(ref.pathname))return null;
  const block=post.caseDocument?.blocks?.find(b=>b.kind==='video'&&Number(b.componentNumber)===Number(number));
  const component=post.components?.find(c=>c.mediaType==='video'&&Number(c.index)===Number(number));
  const target=[block?.embedUrl,block?.sourceUrl,component?.url].map(vimeoPlayerUrl).find(Boolean);
  return target ? {...target,referrer:ref.href} : null;
 }catch{return null;}
}

export function vimeoStreamUrl(value) {
 try {
  if(typeof value!=='string'||value.length>16384)return null;
  const u=new URL(value);
  return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/(?:^|\.)vimeocdn\.com$/.test(u.hostname) ? u.href : null;
 }catch{return null;}
}

export function selectVimeoStream(config,target) {
 if(config?.nodeAccess!==false)throw Error('Удалённый плеер не изолирован.');
 if(String(config.id)!==target.id)throw Error('Плеер вернул другое видео.');
 const duration=Number(config.duration);
 if(!Number.isFinite(duration)||duration<=0)throw Error('Плеер не вернул длительность видео.');
 const files=config.files || {};
 const progressive=(Array.isArray(files.progressive)?files.progressive:[])
  .filter(f=>vimeoStreamUrl(f?.url)&&/\.mp4$/i.test(new URL(f.url).pathname))
  .sort((a,b)=>(Number(b.width)||0)-(Number(a.width)||0));
 if(progressive.length)return {id:target.id,duration,url:vimeoStreamUrl(progressive[0].url),kind:'mp4',referrer:target.referrer};
 for(const kind of ['hls','dash']) {
  const spec=files[kind],url=vimeoStreamUrl(spec?.cdns?.[spec.default_cdn]?.url);
  if(url && new RegExp(kind==='hls'?'\\.m3u8$':'\\.mpd$','i').test(new URL(url).pathname))return {id:target.id,duration,url,kind,referrer:target.referrer};
 }
 throw Error('Плеер не вернул доступный полный видеопоток.');
}
