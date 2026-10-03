import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSourceLink,sourceLinkTarget,searchSettings} from '../../js/source-link.js';

test('links are scoped to selected source, HTTPS, supported post/profile paths', () => {
  for (const input of ['https://www.behance.net/gallery/123/a','http://instagram.com/artist/','https://instagram.com.evil.test/p/x/',
    'https://user:pass@instagram.com/p/x/','https://instagram.com:8443/p/x/','https://instagram.com/accounts/login/', 'https://instagram.com/saved/']) {
    assert.throws(() => validateSourceLink('instagram',input));
  }
  assert.equal(validateSourceLink('instagram','https://www.instagram.com/p/abc/?utm=1#x'),'https://www.instagram.com/p/abc/');
  assert.equal(sourceLinkTarget('instagram','https://www.instagram.com/artist/'),'https://www.instagram.com/artist/posts/');
  assert.equal(sourceLinkTarget('pinterest','https://www.pinterest.com/artist/'),'https://www.pinterest.com/artist/pins/');
  assert.equal(sourceLinkTarget('behance','https://www.behance.net/moodboard/12/art'),'https://www.behance.net/collection/12/a');
});
test('link mode ignores hidden saved options without overwriting user preferences', () => {
  const original={platform:'behance',downloadMode:'link',sourceUrl:'https://www.behance.net/gallery/12/a',source:'meta',folderSearch:true,stopLinkEnabled:true,searchMode:'recent'};
  const next=searchSettings(original);
  assert.equal(next.folderSearch,false);assert.equal(next.stopLinkEnabled,false);assert.equal(next.source,'browser');assert.equal(next.searchMode,'full');
  assert.equal(original.searchMode,'recent');assert.equal(original.folderSearch,true);
  assert.equal(searchSettings({...original,downloadMode:'saved',folderSearch:false}).folderSearch,true);
  assert.equal(searchSettings({...original,downloadMode:'saved',source:'meta',username:''}).source,'browser');
});
