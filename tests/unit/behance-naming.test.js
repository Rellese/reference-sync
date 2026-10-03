import test from 'node:test';import assert from 'node:assert/strict';
import {buildNames} from '../../js/eagle-import.js';
const post={postId:'behance:123',source:'behance',username:'@artist',description:'Project description',componentCount:3,
 components:[1,2,3].map(index=>({index,mediaType:'image'})),selectedComponents:[],caseDocument:{source:{title:'Project'}}};
const counter={id:'counter-1',mode:'global',independent:true,start:4,marker:'ref-',destination:'name'};
for(const selected of [false,true])test(`Behance empty block selection retains text (${selected?'whole case selected':'unselected'})`,()=>{
 const generated=buildNames({posts:[post],selected:new Set(selected?[post.postId]:[]),counters:[counter],
  descriptions:[{text:'Extra',destination:'description',placement:'end'}]}).get(post.postId);
 assert.equal(generated.name,'@artist');assert.equal(generated.description,'Project description\n\nExtra');
 assert.deepEqual(generated.componentNames,[]);
});
test('unselected case text remains when numbering and descriptions are disabled',()=>{
 const generated=buildNames({posts:[post],selected:new Set(),numberingEnabled:false,descriptionEnabled:false,descriptions:[]}).get(post.postId);
 assert.equal(generated.name,'@artist');assert.equal(generated.description,'Project description');
});
test('restoring block selection applies its generated name without losing original description',()=>{
 const selectedPost={...post,selectedComponents:[2]};
 const generated=buildNames({posts:[selectedPost],selected:new Set([post.postId]),counters:[counter],descriptions:[]}).get(post.postId);
 assert.equal(generated.componentNames[1],'@artist ref-4');assert.equal(generated.description,'Project description');
});
