export const dribbbleShotScript=String.raw`
def media_url(value,original=False):
 p=urllib.parse.urlsplit(value)
 if p.scheme!='https' or p.username or p.password or p.port or p.hostname not in {'cdn.dribbble.com','cdn2.dribbble.com'} or not re.match(r'^/(?:userupload|users)/',p.path):raise Failure('DRIBBBLE_MEDIA_URL')
 query=urllib.parse.parse_qsl(p.query,keep_blank_values=True)
 if original:query=[entry for entry in query if entry[0] not in {'resize','quality','vertical'}]
 return urllib.parse.urlunsplit((p.scheme,p.netloc,p.path,urllib.parse.urlencode(query),'') )
def rich_text(node,depth=0):
 if depth>40 or not isinstance(node,dict):raise Failure('DRIBBBLE_RESPONSE')
 if node.get('type')=='text':return str(node.get('text') or '')
 if node.get('type')=='hardBreak':return '\n'
 value=''.join(rich_text(child,depth+1) for child in node.get('content',[]))
 if node.get('type')=='listItem':value='• '+value.strip()
 return value+('\n\n' if node.get('type') in {'paragraph','heading','listItem'} else '')
def component(node,index,block):
 video=first(node,lambda n:n.tag=='video')
 if video:
  url=video.attrs.get('src') or next((n.attrs.get('src') for n in nodes(video) if n.tag=='source'),None)
  preview=video.attrs.get('poster') or '';kind='video'
 else:
  image=first(node,lambda n:n.tag=='img' and any((n.attrs.get(k) or '').startswith('https:') for k in ('src','data-src')))
  if not image:raise Failure('DRIBBBLE_FORMAT')
  url=next(image.attrs[k] for k in ('src','data-src') if (image.attrs.get(k) or '').startswith('https:'));preview=url;kind='image'
 url=media_url(url,original=kind=='image');preview=media_url(preview) if preview else ''
 ext=urllib.parse.urlsplit(url).path.rsplit('.',1)[-1].lower()
 if ext not in ({'mp4','webm','mov'} if kind=='video' else {'jpg','jpeg','png','gif','webp','avif'}):raise Failure('DRIBBBLE_FORMAT')
 return {'index':index,'blockId':str(block),'mediaType':kind,'url':url,'previewUrl':preview,'extension':ext,'description':''}
def shot_blocks(root,source,id):
 match=re.search(r'window\.__INITIAL_STATE__\s*=\s*',source)
 if match:
  try:state,end=json.JSONDecoder().raw_decode(source[match.end():])
  except (ValueError,TypeError):raise Failure('DRIBBBLE_FORMAT')
  return (state.get('props',{}).get('contentBlocks') or {}).get('results')
 # Public SSR pages also place the same block JSON in JsConfig.shotData.
 # Decode that literal only; never evaluate Object.assign or website code.
 for script in nodes(root):
  if script.tag!='script':continue
  text=''.join(c for c in script.children if isinstance(c,str))
  config=re.search(r'Dribbble\.JsConfig\s*=\s*Object\.assign\(\s*config\s*,\s*\{',text)
  match=re.search(r'(?:^|\n)\s*shotData\s*:\s*',text[config.end():]) if config else None
  if not match:continue
  try:state,end=json.JSONDecoder().raw_decode(text[config.end()+match.end():])
  except (ValueError,TypeError):raise Failure('DRIBBBLE_FORMAT')
  if not isinstance(state,dict) or str(state.get('shotId'))!=id:raise Failure('DRIBBBLE_RESPONSE')
  return (state.get('contentBlocks') or {}).get('results')
 raise Failure('DRIBBBLE_FORMAT')
def uploaded_components(block,start):
 # Original uploads in the site's JSON also cover slides outside the viewport.
 uploads=block.get('userUploadsAttributes')
 if uploads is None:return None
 content=block.get('content') or {};media=content.get('media');kind=block.get('contentType')
 if not isinstance(uploads,list) or not uploads or not isinstance(media,list) or not media:raise Failure('DRIBBBLE_FORMAT')
 if any(not isinstance(v,dict) for v in uploads+media):raise Failure('DRIBBBLE_FORMAT')
 sources={v.get('id'):v for v in media}
 if len(sources)!=len(media) or any(not isinstance(id,str) or not id for id in sources):raise Failure('DRIBBBLE_FORMAT')
 if kind=='slideshow':
  slides=content.get('slides')
  if not isinstance(slides,list) or not slides or any(not isinstance(v,dict) for v in slides):raise Failure('DRIBBBLE_FORMAT')
  positions=[v.get('position') for v in slides]
  if any(type(v)!=int or v<0 for v in positions) or len(set(positions))!=len(slides):raise Failure('DRIBBBLE_FORMAT')
  ids=[v.get('mediaId') for v in sorted(slides,key=lambda v:v['position'])]
 else:ids=[content.get('mediaId')]
 if any(not isinstance(id,str) for id in ids) or len(set(ids))!=len(ids) or set(ids)!=set(sources):raise Failure('DRIBBBLE_FORMAT')
 by_cache={v.get('shrineCacheId'):v for v in uploads}
 if len(by_cache)!=len(uploads) or len(uploads)!=len(ids):raise Failure('DRIBBBLE_FORMAT')
 result=[];used=set()
 for id in ids:
  source=sources[id];cache=source.get('shrineCacheId');upload=by_cache.get(cache);media_type=source.get('type')
  if not isinstance(cache,str) or not cache or not upload or cache in used or media_type not in {'image','video'}:raise Failure('DRIBBBLE_FORMAT')
  if kind!='slideshow' and media_type!=kind:raise Failure('DRIBBBLE_FORMAT')
  used.add(cache);original=media_url(upload.get('originalUrl') or '',original=media_type=='image')
  ext=urllib.parse.urlsplit(original).path.rsplit('.',1)[-1].lower()
  if ext!=str(source.get('fileExtension','')).lower():raise Failure('DRIBBBLE_FORMAT')
  if ext not in ({'mp4','webm','mov'} if media_type=='video' else {'jpg','jpeg','png','gif','webp','avif'}):raise Failure('DRIBBBLE_FORMAT')
  preview=upload.get('stillUrl') or (original if media_type=='image' else '')
  result.append({'index':start+len(result),'blockId':str(block['id'])+(':'+id if kind=='slideshow' else ''),
   'mediaType':media_type,'url':original,'previewUrl':media_url(preview) if preview else '', 'extension':ext,'description':''})
 return result
def slideshow(node,content,start,block):
 slides=content.get('slides');media=content.get('media')
 if not isinstance(slides,list) or not slides or not isinstance(media,list):raise Failure('DRIBBBLE_FORMAT')
 if any(not isinstance(v,dict) for v in slides+media):raise Failure('DRIBBBLE_FORMAT')
 positions=[v.get('position') for v in slides];ids=[v.get('mediaId') for v in slides]
 if any(type(v)!=int or v<0 for v in positions) or len(set(positions))!=len(slides):raise Failure('DRIBBBLE_FORMAT')
 if any(not isinstance(v,str) or not v for v in ids) or len(set(ids))!=len(slides):raise Failure('DRIBBBLE_FORMAT')
 sources={v.get('id'):v for v in media}
 if len(sources)!=len(media) or set(sources)!=set(ids):raise Failure('DRIBBBLE_FORMAT')
 carousel=first(node,lambda n:n.attrs.get('data-test')=='base-carousel')
 if carousel is None:raise Failure('DRIBBBLE_FORMAT')
 rendered=[n for n in carousel.children if isinstance(n,Node) and n.has('block-media-wrapper')]
 if len(rendered)!=len(slides):raise Failure('DRIBBBLE_FORMAT')
 result=[]
 for slide,render in zip(sorted(slides,key=lambda v:v['position']),rendered):
  source=sources[slide['mediaId']];value=component(render,start+len(result),str(block)+':'+slide['mediaId'])
  if value['mediaType']!=source.get('type') or value['extension']!=str(source.get('fileExtension','')).lower():raise Failure('DRIBBBLE_FORMAT')
  result.append(value)
 return result
def shot(item):
 source=read(item['url']);root=Tree(source).root;title=first(root,lambda n:n.has('shot-header__title'))
 if title is None:raise Failure('DRIBBBLE_RESPONSE')
 author=first(root,lambda n:n.tag=='a' and n.has('user-sticky-header__avatar'))
 author=(author.attrs.get('href','').strip('/') if author else '')
 if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',author):raise Failure('DRIBBBLE_RESPONSE')
 result=[];texts=[];intro=[];last_media=[]
 ssr=first(root,lambda n:n.attrs.get('id')=='ssr-app')
 if ssr is not None:
  blocks=shot_blocks(root,source,item['id'])
  if not isinstance(blocks,list) or not blocks:raise Failure('DRIBBBLE_FORMAT')
  positions=[b.get('position') for b in blocks]
  if any(type(n)!=int or n<0 for n in positions) or len(set(positions))!=len(positions):raise Failure('DRIBBBLE_FORMAT')
  rendered={n.attrs.get('data-test'):n for n in nodes(ssr) if n.attrs.get('data-test','').startswith('content-block-')}
  for block in sorted(blocks,key=lambda b:b['position']):
   if str(block.get('subjectId'))!=item['id'] or block.get('subjectType')!='Screenshot':raise Failure('DRIBBBLE_RESPONSE')
   kind=block.get('contentType');content=block.get('content') or {};block_id=block.get('id')
   if kind=='text':
    caption=clean_text(rich_text(content.get('text') or {}));texts.append(caption)
    if last_media:
     for media in last_media:media['description']=clean_text(media['description']+'\n\n'+caption)
    else:intro.append(caption)
   elif kind in {'image','video'}:
    uploaded=uploaded_components(block,len(result)+1)
    if uploaded is not None:
     result.extend(uploaded);last_media=uploaded;continue
    node=rendered.get('content-block-'+str(block_id))
    if not node:raise Failure('DRIBBBLE_FORMAT')
    media=component(node,len(result)+1,block_id)
    if media['mediaType']!=kind:raise Failure('DRIBBBLE_FORMAT')
    result.append(media);last_media=[media]
   elif kind=='slideshow':
    uploaded=uploaded_components(block,len(result)+1)
    if uploaded is not None:
     result.extend(uploaded);last_media=uploaded;continue
    node=rendered.get('content-block-'+str(block_id))
    if not node:raise Failure('DRIBBBLE_FORMAT')
    last_media=slideshow(node,content,len(result)+1,block_id);result.extend(last_media)
   else:raise Failure('DRIBBBLE_FORMAT')
 else:
  node=first(root,lambda n:n.has('shot-media-container'))
  if not node:raise Failure('DRIBBBLE_FORMAT')
  result.append(component(node,1,'legacy'))
  caption=clean_text(plain(first(root,lambda n:n.has('shot-description-container'))));result[0]['description']=caption;texts.append(caption)
 if not result:raise Failure('DRIBBBLE_FORMAT')
 return {'id':item['id'],'url':item['url'],'title':clean_text(plain(title))[:2000],'author':author,
  'description':'\n\n'.join(texts),'introDescription':'\n\n'.join(intro),'components':result}
`;
