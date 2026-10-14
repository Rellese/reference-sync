import test from 'node:test';
import assert from 'node:assert/strict';
import {behancePreview} from '../../js/sources/behance-preview.js';
import {behanceMediaSource} from '../../js/sources/behance.js';
const sizes=['original','808','202'].map(size=>({url:`https://cdn.example/projects/${size}/cover.jpg`}));
test('Behance table uses its compact cover, never its HTML project URL',()=>{
 const post={id:123,url:'https://www.behance.net/gallery/123/Case',covers:{allAvailable:sizes}};
 assert.equal(behancePreview({...post,_galleryType:2}),sizes[2].url);
 const [assembled]=behanceMediaSource.assemble([{...post,_galleryType:2},{...post,_galleryType:3,_galleryUrl:'https://cdn.example/source/image.jpg',num:1,extension:'jpg',module:{__typename:'ImageModule',imageSizes:{allAvailable:[{url:'https://cdn.example/max_316/image.jpg'}]}}}],{target:{id:'board',name:'Board'}});
 assert.equal(assembled.previewUrl,sizes[2].url);
 assert.equal(assembled.components[0].previewUrl,'https://cdn.example/max_316/image.jpg');
 assert.equal(assembled.components[0].url,'https://cdn.example/source/image.jpg');
});
test('video and iframe URLs are never passed off as image previews',()=>{
 for(const url of ['https://player.vimeo.com/video/123','https://cdn.example/video.mp4','https://www.behance.net/gallery/123/a']) {
  assert.equal(behancePreview({_galleryType:3,_galleryUrl:url,url,extension:'mp4',module:{__typename:'EmbedModule'}}),'');
 }
 assert.equal(behancePreview({module:{__typename:'VideoModule',thumbnail:{url:'https://cdn.example/poster.jpg'}}}),'https://cdn.example/poster.jpg');
});
