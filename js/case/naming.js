import {caseModes,caseRegistryId} from './download.js';

const isCase = post => post?.source==='behance' && Boolean(post.caseDocument);
const blockKey = (post,number) => `${post.postId}:block:${number}`;

// Names and counters describe Eagle items, not files needed inside the ZIP.
export function caseNamingPlan({posts=[],selected,knownPostIds=new Set(),missingComponents=new Map()}={}) {
 posts=Array.isArray(posts)?posts:[];
 const chosen=selected instanceof Set ? selected : new Set(selected || []);
 const expanded=[],expandedSelected=new Set(),groups=new Map();
 posts.forEach((post,tablePosition)=>{
  if(!isCase(post)) {
   expanded.push(post);if(chosen.has(post.postId))expandedSelected.add(post.postId);return;
  }
  const mode=caseModes(post),targets=[],missing=missingComponents.get(post.postId);
  if(mode.whole&&!knownPostIds.has(caseRegistryId(post)))targets.push({kind:'case',key:caseRegistryId(post),number:1});
  if(mode.blocks&&!knownPostIds.has(post.postId)) {
   const numbers=new Set((post.selectedComponents ?? (post.components || []).map(c=>c.index)).map(Number));
   (post.components || []).forEach((component,position)=>{
    const number=Number(component.index);
    if(numbers.has(number)&&(!missing||missing.has(String(position))))targets.push({kind:'block',key:blockKey(post,number),number,position});
   });
  }
  // An unselected/fully imported row still has readable metadata.
  if(!targets.length)targets.push({kind:'preview',key:`${post.postId}:preview`,number:1});
  groups.set(post.postId,targets);
  targets.forEach((target,outputPosition)=>{
   const single=target.kind!=='block';
   expanded.push({...post,postId:target.key,
    ...(single?{componentCount:1,components:[{index:1}],selectedComponents:[1]}:{selectedComponents:[target.number]}),
    caseNamingUnit:{parent:post.postId,tablePosition,outputPosition}});
   if(chosen.has(post.postId)&&target.kind!=='preview')expandedSelected.add(target.key);
  });
 });
 return {posts:expanded,selected:expandedSelected,collapse(generated){
  const result=new Map();
  for(const post of posts) {
   const targets=groups.get(post.postId);
   if(!targets){result.set(post.postId,generated.get(post.postId));continue;}
   const entries=targets.map(target=>({...target,values:generated.get(target.key)}));
   const whole=entries.find(entry=>entry.kind==='case')?.values;
   const componentNames=[],componentDescriptions=[],counterValuesByComponent=[];
   for(const entry of entries.filter(entry=>entry.kind==='block')) {
    componentNames[entry.position]=entry.values.componentNames[entry.number-1] ?? entry.values.name;
    componentDescriptions[entry.position]=entry.values.componentDescriptions[entry.number-1] ?? entry.values.description;
    counterValuesByComponent[entry.position]=entry.values.counterValuesByComponent[entry.number-1] ?? entry.values.counterValues;
   }
   result.set(post.postId,{name:entries.map(e=>e.values.name).join('\n'),
    description:[...new Set(entries.map(e=>e.values.description))].join('\n\n'),
    postNumber:whole?.postNumber ?? entries[0]?.values.postNumber,
    counterValues:whole?.counterValues ?? entries[0]?.values.counterValues ?? {},
    caseName:whole?.name,caseDescription:whole?.description,caseCounterValues:whole?.counterValues,
    componentNames,componentDescriptions,counterValuesByComponent,
    outputComponents:entries.filter(e=>e.kind==='block').map(e=>e.position)});
  }
  return result;
 }};
}

export function orderCaseNamingUnits(posts,counter) {
 const units=posts.filter(post=>post.caseNamingUnit);
 if(!units.length)return posts;
 const parentOrder=new Map();
 for(const post of units)if(!parentOrder.has(post.caseNamingUnit.parent))parentOrder.set(post.caseNamingUnit.parent,parentOrder.size);
 units.sort((a,b)=>{
  const left=a.caseNamingUnit,right=b.caseNamingUnit;
  // Legacy settings have no direction control: Behance follows table order.
  const parent=counter.independent ? parentOrder.get(left.parent)-parentOrder.get(right.parent) : left.tablePosition-right.tablePosition;
  return parent || left.outputPosition-right.outputPosition;
 });
 let index=0;return posts.map(post=>post.caseNamingUnit ? units[index++] : post);
}

// Table edits follow the displayed output lines: case, then chosen blocks.
export function caseOutputName({names,componentIndex,nameOverride,fallback=''}) {
 if(nameOverride!==undefined) {
  const lines=String(nameOverride).split('\n');
  const position=componentIndex===undefined ? 0 : (names?.caseName!==undefined?1:0)+(names?.outputComponents?.indexOf(componentIndex) ?? 0);
  return lines[position] || lines[0] || fallback;
 }
 return componentIndex===undefined ? names?.caseName ?? fallback : names?.componentNames?.[componentIndex] ?? fallback;
}

// Persist only values of confirmed Eagle items, including partial block imports.
export function caseNamingHistory(created,posts) {
 if(!created.some(({item})=>item?.numberingValues))return null;
 const byId=new Map(posts.map(post=>[post.postId,post]));
 const historyPosts=[],generated=new Map(),importedPostIds=new Set();
 for(const {item} of created) {
  if(!item.numberingValues)continue;
  const parent=byId.get(item.sourcePostId || item.postId);if(!parent)continue;
  const id=item.importKind==='case' ? caseRegistryId(parent) : blockKey(parent,parent.components[Number(item.component)]?.index ?? Number(item.component)+1);
  historyPosts.push({...parent,postId:id});generated.set(id,{counterValues:item.numberingValues});importedPostIds.add(id);
 }
 return {posts:historyPosts,generated,importedPostIds};
}
