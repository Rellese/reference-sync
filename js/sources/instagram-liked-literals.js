// Decode typed data literals from the web layout. Never execute Bloks actions or JavaScript.
export const instagramLikedLiterals=String.raw`
class ParseError(Exception):pass
class Symbol(str):pass
def parse_expr(source,start=0):
 decoder=json.JSONDecoder();steps=0
 def read(pos,depth=0):
  nonlocal steps
  steps+=1
  if steps>100000 or depth>80:raise ParseError()
  while pos<len(source) and source[pos].isspace():pos+=1
  if pos>=len(source):raise ParseError()
  if source[pos]=='(':
   parts=[];pos+=1
   while True:
    while pos<len(source) and (source[pos].isspace() or source[pos]==','):pos+=1
    if pos>=len(source):raise ParseError()
    if source[pos]==')':return parts,pos+1
    value,pos=read(pos,depth+1);parts.append(value)
  if source[pos]=='"':return decoder.raw_decode(source,pos)
  match=re.match(r'-?\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_.:]*',source[pos:])
  if not match:raise ParseError()
  token=match[0];end=pos+len(token)
  if token in {'true','false','null'}:return json.loads(token),end
  if re.fullmatch(r'-?\d+(?:\.\d+)?',token):return json.loads(token),end
  return Symbol(token),end
 return read(start)
def walk(data):
 stack=[data];count=0
 while stack:
  value=stack.pop();count+=1
  if count>200000:raise ParseError()
  yield value
  if isinstance(value,dict):stack.extend(reversed(list(value.values())))
  elif isinstance(value,list):stack.extend(reversed(value))
def literal(value,refs=None,defaults=None,depth=0):
 if depth>30:raise ParseError()
 if not isinstance(value,list):
  if isinstance(value,Symbol):raise ParseError()
  return value
 if not value or not isinstance(value[0],Symbol):raise ParseError()
 name=value[0];args=value[1:]
 decode=lambda v:literal(v,refs,defaults,depth+1)
 if name in {'bk.action.bool.Const','bk.action.i32.Const','bk.action.i64.Const','bk.action.f32.Const','bk.action.string.Const'} and len(args)==1:return decode(args[0])
 if name=='bk.action.array.Make':return [decode(v) for v in args]
 if name=='bk.action.array.Get' and len(args)==2:
  values,index=(decode(v) for v in args)
  if not isinstance(values,list) or type(index)!=int or not 0<=index<len(values):raise ParseError()
  return values[index]
 if name=='bk.action.map.Make' and len(args)==2:
  keys,values=(decode(v) for v in args)
  if not isinstance(keys,list) or not isinstance(values,list) or len(keys)!=len(values) or not all(type(k)==str for k in keys) or len(set(keys))!=len(keys):raise ParseError()
  return dict(zip(keys,values))
 if name=='bk.action.bloks.GetVariable2' and len(args)==1 and refs and args[0] in refs:
  decl=refs[args[0]];values=[]
  for expression in (defaults or {}).get(decl.get('key'),[]):
   try:values.append(decode(parse_expr(expression)[0]))
   except ParseError:pass
  if not values or len({json.dumps(v,sort_keys=True) for v in values})!=1:raise ParseError()
  return values[0]
 raise ParseError()
def action_params(payload,handler):
 if handler not in {'liked_refresh','liked_next'}:raise ParseError()
 refs={};defaults={}
 for item in walk(payload):
  if isinstance(item,dict) and isinstance(item.get('data'),dict) and 'initial_lispy' in item['data'] and 'id' in item:
   refs[item['id']]=item['data'];defaults.setdefault(item['data'].get('key'),[]).append(item['data']['initial_lispy'])
 marker='(bk.action.bloks.AsyncActionWithDataManifest, "com.instagram.privacy.activity_center.'+handler+'"'
 results=[]
 for item in walk(payload):
  if not isinstance(item,str):continue
  start=item.find(marker)
  if start<0:continue
  call,end=parse_expr(item,start)
  results.append(literal(call[2],refs,defaults))
 if not results:return None
 if len({json.dumps(v,sort_keys=True) for v in results})!=1:raise ParseError()
 return results[0]
def media_records(payload):
 result=[];seen=set()
 marker='(bk.action.map.Make, (bk.action.array.Make, "media_id", "media_code"'
 for item in walk(payload):
  if not isinstance(item,str):continue
  start=0
  while True:
   start=item.find(marker,start)
   if start<0:break
   expr,end=parse_expr(item,start);data=literal(expr);start=end
   id=str(data.get('media_id','')).split('_')[0];code=data.get('media_code')
   if not re.fullmatch(r'\d{1,30}',id) or type(code)!=str or not re.fullmatch(r'[A-Za-z0-9_-]{1,30}',code):raise ParseError()
   if id not in seen:seen.add(id);result.append({'id':id,'code':code})
 return result
`;
