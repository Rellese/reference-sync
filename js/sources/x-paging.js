export const xPagingScript=String.raw`
def unwrap(item):
 if not isinstance(item,dict):raise Failure('X_RESPONSE')
 if item.get('__typename')=='TweetWithVisibilityResults':item=item.get('tweet') or {}
 if item.get('__typename') in {'TweetUnavailable','TweetTombstone'}:return None
 if not re.fullmatch(r'\d+',str(item.get('rest_id',''))):raise Failure('X_RESPONSE')
 return item
def timeline(data,folder):
 try:
  node=data['data']['bookmark_collection_timeline' if folder else 'bookmark_timeline_v2']['timeline']
  instructions=node['instructions']
 except (KeyError,TypeError):raise Failure('X_RESPONSE')
 if not isinstance(instructions,list):raise Failure('X_RESPONSE')
 tweets=[];cursor=None
 def entry(value):
  nonlocal cursor
  content=value.get('content') or value.get('item') or {}
  if content.get('cursorType')=='Bottom':cursor=content.get('value');return
  if content.get('entryType')=='TimelineTimelineModule' or content.get('items'):
   for child in content.get('items',[]):entry(child)
   return
  item=content.get('itemContent') or content
  result=(item.get('tweet_results') or {}).get('result')
  if result:
   tweet=unwrap(result)
   if tweet:tweets.append(tweet)
  elif str(value.get('entryId','')).startswith('tweet-'):raise Failure('X_RESPONSE')
 for instruction in instructions:
  kind=instruction.get('type')
  if kind=='TimelineAddEntries':
   for value in instruction.get('entries',[]):entry(value)
  elif kind in {'TimelineReplaceEntry','TimelinePinEntry'}:entry(instruction.get('entry') or {})
  elif kind=='TimelineAddToModule':
   for value in instruction.get('moduleItems',[]):entry(value)
 return tweets,cursor
def discover():
 result=[];seen=set();visited=set();cursor=None;checked=0;stopped=False;reached=False
 limit=max(0,int(spec.get('limit',0)));known=set(spec.get('known',[]));boundary=str(spec.get('stopId') or '')
 folder=str(spec.get('folder') or '');post_id=str(spec.get('postId') or '')
 if folder and not re.fullmatch(r'\d+',folder):raise Failure('X_FOLDERS')
 for page in range(10000):
  checkpoint()
  if post_id:
   if not re.fullmatch(r'\d+',post_id):raise Failure('X_URL')
   data=graph('TweetResultByRestId',{'tweetId':post_id,'withCommunity':False,'includePromotedContent':False,'withVoice':True})
   tweet=unwrap((data.get('data') or {}).get('tweetResult',{}).get('result',{}));batch=[tweet] if tweet else [];following=None
  else:
   variables={'count':50,'includePromotedContent':False}
   if folder:variables['bookmark_collection_id']=folder
   if cursor:variables['cursor']=cursor
   batch,following=timeline(graph('BookmarkFolderTimeline' if folder else 'Bookmarks',variables),bool(folder))
  ids=[]
  for tweet in batch:
   id=str(tweet['rest_id'])
   if id==boundary or id in known:stopped=True;reached=id==boundary;break
   if id in seen:continue
   seen.add(id);checked+=1
   media=normalize(tweet)
   if media:result.append(media);ids.append(id)
   # N counts saved publications, including text-only posts without imports.
   if limit and checked>=limit:break
  print(json.dumps({'event':'progress','found':len(result),'ids':ids}),flush=True)
  if stopped or (limit and checked>=limit) or not following:break
  if following in visited:
   # X ends Bookmarks with an empty page repeating the final bottom cursor.
   # A repeated nonempty page is a loop, not a successful complete search.
   if not batch:break
   raise Failure('X_PAGING')
  visited.add(following);cursor=following
 else:raise Failure('X_PAGING')
 return {'posts':result,'checked':checked,'skippedText':checked-len(result),'stoppedEarly':stopped,'stopLinkReached':reached}
`;
