import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBehanceCase,caseText,caseUrl} from '../../js/sources/behance-case.js';
import {behanceMediaSource} from '../../js/sources/behance.js';
import {normalizeRecoveryState} from '../../js/job-recovery.js';
const post={postId:'behance:123',externalId:'123',url:'https://www.behance.net/gallery/123/a',plainUsername:'artist'};
test('case retains text and unsupported blocks in source order without renumbering downloadable media',()=>{
 const modules=[{id:1,__typename:'ImageModule'}, {id:2,__typename:'TextModule',text:'<div>Hello <a href="https://example.test/?x=1&amp;y=2">world</a><br>Again</div>'},
  {id:3,__typename:'EmbedModule',originalEmbed:'<iframe src="https://player.vimeo.com/video/3"></iframe>'},
  {id:4,__typename:'VideoModule'}, {id:5,__typename:'AudioModule'}];
 const records=[{_galleryType:2,allModules:modules,name:'Case',canvasWidth:1600},
  {_galleryType:3,module:modules[0],num:1,extension:'gif',_galleryUrl:'https://cdn.example/a.gif'},
  {_galleryType:3,module:modules[2],num:2,extension:'mp4',_galleryUrl:'ytdl:https://player.vimeo.com/video/3'}];
 const doc=buildBehanceCase(post,records);
 assert.deepEqual(doc.blocks.map(b=>b.kind),['gif','text','video','video','unsupported']);
 assert.deepEqual(doc.blocks.map(b=>b.status),['downloadable','text','downloadable','unavailable','unsupported']);
 assert.deepEqual(doc.blocks.map(b=>b.componentNumber),[1,null,2,null,null]);
 assert.equal(doc.blocks[1].text,'Hello world\nAgain');assert.equal(doc.blocks[1].links[0].url,'https://example.test/?x=1&y=2');
 assert.equal(doc.canvasWidth,1600);assert.equal(doc.blocks[2].embedUrl,'https://player.vimeo.com/video/3');
 assert.equal(doc.blocks[2].sourceUrl,'https://player.vimeo.com/video/3');
 assert.deepEqual(JSON.parse(JSON.stringify(doc)),doc);
});
test('assembled cases survive recovery without changing the downloadable component count',()=>{
 const modules=[{id:1,__typename:'TextModule',text:'<p>Intro</p>'},{id:2,__typename:'ImageModule'}];
 const metadata={id:123,url:post.url,allModules:modules};
 const [assembled]=behanceMediaSource.assemble([
  {...metadata,_galleryType:2},
  {...metadata,_galleryType:3,module:modules[1],num:1,extension:'jpg',_galleryUrl:'https://cdn.example/image.jpg'},
 ],{target:{id:'board',name:'Board'}});
 assert.equal(assembled.componentCount,1);
 assert.deepEqual(assembled.caseDocument.blocks.map(b=>b.kind),['text','image']);
 const recovered=normalizeRecoveryState({jobId:'case-job',phase:'ready',posts:[assembled]}).posts[0];
 assert.deepEqual(recovered.caseDocument,assembled.caseDocument);
 assert.notEqual(recovered.caseDocument,assembled.caseDocument);
 assert.equal(recovered.componentCount,1);
});
test('case data does not preserve executable HTML or unsafe links',()=>{
 const html='<script>alert(1)</script><p onclick="bad()">Hi &lt;b&gt;</p><a href="javascript&#58;alert(1)">bad</a>';
 const doc=buildBehanceCase(post,[{allModules:[{id:1,__typename:'TextModule',text:html}]}]);
 assert.equal(doc.blocks[0].text,'Hi <b>\nbad');assert.deepEqual(doc.blocks[0].links,[]);
 assert.equal(caseUrl('file:///etc/passwd'),'');assert.equal(caseUrl('https://user:pass@example.test/'),'');
 assert.equal(caseText('A&#x1f600;&nbsp;B'),'A😀 B');
});
test('media collections keep their group, ordering and missing members',()=>{
 const module={id:10,__typename:'MediaCollectionModule',components:[{},{},{}]};
 const doc=buildBehanceCase(post,[{allModules:[module]},...[1,2].map(num=>({_galleryType:3,module,num,extension:'jpg',_galleryUrl:`https://cdn.example/${num}.jpg`}))]);
 assert.equal(doc.blocks.length,3);assert.deepEqual(doc.blocks.map(b=>b.groupId),['10','10','10']);
 assert.equal(doc.blocks[2].status,'unavailable');assert.equal(new Set(doc.blocks.map(b=>b.id)).size,3);
});
test('a separate project cover survives discovery and recovery without becoming a media block',()=>{
 const base='https://mir-s3-cdn-cf.behance.net/projects/';
 const records=[{id:123,_galleryType:2,modules:[{id:1,__typename:'ImageModule'}],covers:{allAvailable:[{url:base+'202/cover.png'},{url:base+'max_808/cover.png'},{url:base+'max_808_webp/cover.png'}]}},
  {id:123,_galleryType:3,num:1,module:{id:1,__typename:'ImageModule'},extension:'png',_galleryUrl:'https://cdn.example/block.png'}];
 const [assembled]=behanceMediaSource.assemble(records,{target:{id:'board',name:'Board'}});
 const recovered=normalizeRecoveryState({jobId:'cover',phase:'ready',posts:[assembled]}).posts[0];
 assert.equal(recovered.caseDocument.coverUrl,base+'max_808/cover.png');
 assert.equal(recovered.caseDocument.coverUrls[1],base+'max_808_webp/cover.png');
 assert.equal(recovered.componentCount,1);
 assert.deepEqual(recovered.caseDocument.blocks.map(block=>block.sourceUrl),['https://cdn.example/block.png']);
 const legacy=buildBehanceCase({...post,previewUrl:'https://cdn.example/first-block.png'},records.map(({covers,...record})=>record));
 assert.equal(legacy.coverUrl,''); // A post preview is not evidence of the project cover.
});
test('project cover metadata can be separate from the record containing the module tree',()=>{
 const cover='https://mir-s3-cdn-cf.behance.net/projects/max_808/cover.png';
 const document=buildBehanceCase(post,[{modules:[{id:1,__typename:'TextModule',text:'Hello'}]},
  {covers:{size_808:{url:cover}}}]);
 assert.equal(document.coverUrl,cover);assert.equal(document.blocks.length,1);
});
