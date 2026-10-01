import {caseModes} from './download.js';
import {translate} from '../i18n.js';
export function caseStructure(post,selected,total) {
 const mode=caseModes(post);
 return {label:mode.whole ? mode.blocks?'Кейс + блоков':'Кейс целиком':'Блоков',count:mode.whole&&!mode.blocks?'':`${selected}/${total}`};
}
export function fitCaseStructureColumn(root,posts,selection) {
 const labels=new Set();
 for(const post of posts){
  if(post.source!=='behance'||!post.caseDocument)continue;
  const state=selection(post),value=caseStructure(post,state?.selectedCount||0,state?.total||post.componentCount||0);
  labels.add(JSON.stringify([translate(value.label),value.count]));
 }
 if(!labels.size){root.style.removeProperty('--rs-table-structure-content-width');return;}
 const probe=document.createElement('div');probe.className='rs-carousel-button';
 Object.assign(probe.style,{position:'absolute',visibility:'hidden',pointerEvents:'none',left:'-10000px',maxWidth:'none',width:'max-content'});
 const label=document.createElement('span'),count=document.createElement('span');label.className='rs-carousel-button__label';count.className='rs-carousel-button__count';probe.append(label,count);root.append(probe);
 let width=0;
 for(const value of labels){const [text,number]=JSON.parse(value);label.textContent=text;count.textContent=number;count.hidden=!number;width=Math.max(width,probe.offsetWidth);}
 probe.remove();root.style.setProperty('--rs-table-structure-content-width',`${width+12}px`);
}
