import test from 'node:test';
import assert from 'node:assert/strict';
import {behanceLayout} from '../../js/sources/behance-layout.js';
import {caseLayout} from '../../js/case/layout.js';
import {behanceMediaSource} from '../../js/sources/behance.js';
import {normalizeRecoveryState} from '../../js/job-recovery.js';
import {buildBehanceCase} from '../../js/sources/behance-case.js';

test('Behance project styles retain background, top inset and generated module gaps',()=>{
 const layout=behanceLayout({stylesInline:`
  #primary-project-content .module { padding-bottom: 24px; }
  #primary-project-content { padding-top: 12px; background-color: #F5F6FC; }
  .spacer { height: 8px; } .divider { display: none; }
  #primary-project-content .module h2 { background-color: #123456; }
 `});
 assert.deepEqual(layout,{backgroundColor:'#F5F6FC',topSpacing:12,blockSpacing:32});
});
test('empty text modules remain inside the case without becoming downloadable components',()=>{
 const post={postId:'behance:123',externalId:'123',url:'https://www.behance.net/gallery/123/a'};
 const document=buildBehanceCase(post,[{allModules:[{id:1,__typename:'TextModule',text:'<div><br></div>'}],
  stylesInline:'#primary-project-content {background-color: #F5F6FC;}'}]);
 assert.equal(document.blocks.length,1);assert.equal(document.blocks[0].kind,'text');
 assert.equal(document.blocks[0].text,'');assert.equal(document.blocks[0].componentNumber,null);
 assert.equal(document.layout.backgroundColor,'#F5F6FC');
});
test('zero spacing overrides metadata and project-specific selectors override global spacers',()=>{
 assert.deepEqual(behanceLayout({styles:{spacing:{projectTopMargin:'42'}},stylesInline:`
  /* #primary-project-content { background-color: #000; } */
  .spacer {height: 100px;} #primary-project-content .spacer {height: 0px;}
  #primary-project-content {padding-top: 0px; background-color: #abc;}
 `}),{backgroundColor:'#AABBCC',topSpacing:0,blockSpacing:0});
 assert.deepEqual(behanceLayout({styles:{spacing:{projectTopMargin:'42'}}}),{backgroundColor:'',topSpacing:42,blockSpacing:0});
 assert.equal(behanceLayout(),null);
});
test('source CSS is never copied or executed and invalid geometry cannot become project styling',()=>{
 const unsafe={stylesInline:`
  #other {background-color: #FFF; padding-top: 12px;}
  #primary-project-content {background-color: url(https://example.test/secret); padding-top: -12px;}
  #primary-project-content .module {padding-bottom: calc(100vh);}
  .spacer {height: 10001px;}
 `};
 assert.equal(behanceLayout(unsafe),null);
 assert.deepEqual(caseLayout({backgroundColor:'#abcd',topSpacing:4.5,blockSpacing:'12px',css:'secret'}),
  {backgroundColor:'#AABBCCDD',topSpacing:4.5,blockSpacing:12});
 for(const invalid of [NaN,Infinity,-1,10001,'1e3','100%','var(--gap)','url(secret)',null]){
  assert.deepEqual(caseLayout({backgroundColor:'red; background:url(secret)',topSpacing:invalid,blockSpacing:invalid}),
   {backgroundColor:'',topSpacing:0,blockSpacing:0});
 }
});
test('project layout survives recovery without adding selectable files or changing component numbers',()=>{
 const module={id:1,__typename:'ImageModule',width:1400,height:700};
 const metadata={id:123,url:'https://www.behance.net/gallery/123/a',allModules:[module],
  stylesInline:'#primary-project-content {padding-top: 0px; background-color: #F5F6FC;} .spacer {height: 32px;}'};
 const [post]=behanceMediaSource.assemble([{...metadata,_galleryType:2},
  {...metadata,_galleryType:3,module,num:1,extension:'png',_galleryUrl:'https://cdn.example/image.png'}],{target:{id:'board'}});
 assert.equal(post.componentCount,1);assert.equal(post.caseDocument.blocks.length,1);
 assert.equal(post.caseDocument.blocks[0].componentNumber,1);
 const recovered=normalizeRecoveryState({jobId:'layout',phase:'ready',posts:[post]}).posts[0];
 assert.deepEqual(recovered.caseDocument.layout,{backgroundColor:'#F5F6FC',topSpacing:0,blockSpacing:32});
 assert.equal(JSON.stringify(recovered.caseDocument).includes('stylesInline'),false);
});
