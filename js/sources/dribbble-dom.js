// Fixed, bounded HTML parser. No website scripts are executed.
export const dribbbleDomScript=String.raw`
from html.parser import HTMLParser
class Node:
 def __init__(self,tag='',attrs=None):self.tag=tag;self.attrs=dict(attrs or []);self.children=[]
 def has(self,value):return value in (self.attrs.get('class') or '').split()
class Tree(HTMLParser):
 def __init__(self,source):
  super().__init__(convert_charrefs=True);self.root=Node();self.stack=[self.root];self.count=0;self.feed(source)
 def handle_starttag(self,tag,attrs):
  self.count+=1
  if self.count>200000 or len(self.stack)>200:raise Failure('DRIBBBLE_RESPONSE')
  node=Node(tag,attrs);self.stack[-1].children.append(node)
  if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}:self.stack.append(node)
 def handle_startendtag(self,tag,attrs):
  self.handle_starttag(tag,attrs)
  if self.stack[-1].tag==tag:self.stack.pop()
 def handle_endtag(self,tag):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i].tag==tag:del self.stack[i:];return
 def handle_data(self,value):self.stack[-1].children.append(value)
def nodes(node):
 stack=[node]
 while stack:
  value=stack.pop();yield value
  stack.extend(child for child in reversed(value.children) if isinstance(child,Node))
def first(root,predicate):return next((node for node in nodes(root) if predicate(node)),None)
def plain(node):
 if node is None:return ''
 if isinstance(node,str):return node
 if node.tag in {'script','style','noscript'}:return ''
 if node.tag=='br':return '\n'
 value=''.join(plain(child) for child in node.children)
 return value+('\n\n' if node.tag in {'p','h1','h2','h3','h4','li','div'} else '')
def clean_text(value):return re.sub(r'\n[ \t]*\n(?:[ \t]*\n)+','\n\n',value.replace('\xa0',' ')).strip()[:200000]
def identity(root):
 link=first(root,lambda n:n.tag=='a' and n.has('site-nav-user__avatar-link'))
 match=re.fullmatch(r'/([A-Za-z0-9_-]{1,80})',link.attrs.get('href','')) if link else None
 if not match:raise Failure('DRIBBBLE_AUTH')
 return match[1]
def pagination(root,current,page):
 link=first(root,lambda n:n.tag=='a' and n.has('next_page'))
 if not link:return None
 next=urllib.parse.urljoin(current,link.attrs.get('href') or '')
 p=safe_url(next);previous=urllib.parse.urlsplit(current);query=urllib.parse.parse_qs(p.query)
 if p.path!=previous.path or set(query)!={'page'} or len(query['page'])!=1 or not re.fullmatch(r'[1-9]\d*',query['page'][0]) or int(query['page'][0])<=page:raise Failure('DRIBBBLE_PAGING')
 return next
def cards(root,fragment=False):
 grid=first(root,lambda n:n.tag=='ol' and n.has('shots-grid'))
 if not grid and fragment and all((isinstance(n,str) and not n.strip()) or (isinstance(n,Node) and n.tag in {'li','script'}) for n in root.children):grid=root
 if not grid:raise Failure('DRIBBBLE_RESPONSE')
 result=[]
 for card in grid.children:
  if not isinstance(card,Node):continue
  match=re.fullmatch(r'screenshot-(\d+)',card.attrs.get('id',''))
  if not match or card.attrs.get('data-boost-id') or card.attrs.get('data-is-boost-fallback'):continue
  link=first(card,lambda n:n.tag=='a' and re.fullmatch(r'/shots/'+match[1]+r'(?:-[^/]+)?',n.attrs.get('href','')) is not None)
  if not link:raise Failure('DRIBBBLE_RESPONSE')
  result.append({'id':match[1],'url':'https://dribbble.com'+link.attrs['href']})
 return result
def catalog(profile):
 url='https://dribbble.com/'+profile+'/collections';visited=set();result={};page=1
 while url:
  if url in visited or len(visited)>=10000:raise Failure('DRIBBBLE_PAGING')
  visited.add(url);root=Tree(read(url)).root
  # Only the requested profile's collection links can enter the catalog.
  found=[]
  for node in nodes(root):
   if node.tag!='a':continue
   match=re.fullmatch('/'+re.escape(profile)+r'/collections/(\d+)(?:-[^/]+)?',node.attrs.get('href',''))
   if not match:continue
   name=clean_text(plain(node));name=re.split(r'\s+\d+\s+Shots?\b',name)[0].strip()
   item={'id':match[1],'name':name or match[1],'url':'https://dribbble.com'+node.attrs['href']};found.append(item)
   if item['id'] not in result or result[item['id']]['name']==item['id']:result[item['id']]=item
  # The owner came from authenticated bootstrap. Public collection pages may
  # hydrate their navbar later; exact owner links/grid validate this response.
  if not found and not first(root,lambda n:n.has('collections-grid')):identity(root)
  next=pagination(root,url,page)
  if next and not found:raise Failure('DRIBBBLE_RESPONSE')
  url=next;page=int(urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)['page'][0]) if url else page
 return list(result.values())
`;
