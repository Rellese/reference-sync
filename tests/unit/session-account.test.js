import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchingAccount, sessionErrorTitle, accountSearchSettings } from '../../js/session-account.js';
test('all adapters share explicit mismatch, signed-out and unverified errors', () => {
  for (const platform of ['pinterest','behance','vimeo','x']) {
    const options = {platform,title:platform,username:'@Expected',browser:'Chrome'};
    assert.doesNotThrow(()=>assertMatchingAccount({authenticated:true,username:'expected'},options));
    assert.throws(()=>assertMatchingAccount({authenticated:true,username:'other'},options), error => {
      assert.equal(error.code,`${platform.toUpperCase()}_ACCOUNT_MISMATCH`);
      assert.match(error.message,/@other.*@Expected/);
      assert.match(sessionErrorTitle(error),/Выбран другой/); return true;
    });
    assert.throws(()=>assertMatchingAccount({status:'network-error'},options),{code:`${platform.toUpperCase()}_SESSION_UNVERIFIED`});
    assert.throws(()=>assertMatchingAccount({status:'signed-out'},options),{code:`${platform.toUpperCase()}_SESSION_INVALID`});
  }
});
test('legacy Instagram modal remains compatible',()=>assert.equal(sessionErrorTitle({code:'INSTAGRAM_ACCOUNT_MISMATCH'}),'Выбран другой Instagram-аккаунт'));
for (const platform of ['instagram','pinterest']) {
  test(`${platform} owned feeds use the verified account despite a blank/stale manual setting`,()=>{
    for(const username of ['', 'old-account']) {
      const settings={platform,source:'browser',username,browser:'chrome',browserProfile:'Profile 1',folderSearch:true,searchMode:'recent',limit:10};
      const next=accountSearchSettings(settings,{authenticated:true,username:'@actual-owner'});
      assert.equal(next.username,'actual-owner');assert.equal(next.browserProfile,'Profile 1');assert.equal(next.folderSearch,true);assert.equal(next.limit,10);
      assert.equal(settings.username,username);
    }
  });
  test(`${platform} cannot substitute a stored login or tooltip for an unverified session`,()=>{
    for(const [session,code] of [[{status:'signed-out'},'SESSION_INVALID'],[{status:'network-error'},'SESSION_UNVERIFIED'],[{authenticated:true,username:''},'SESSION_UNVERIFIED']])
      assert.throws(()=>accountSearchSettings({platform,source:'browser',username:'old-owner'},session),{code:platform.toUpperCase()+'_'+code});
  });
  test(`${platform} public links and archives never require or inherit a manual account`,()=>{
    for(const options of [{targetUrl:'https://example.test/post'},{source:'meta'}]){
      const next=accountSearchSettings({platform,source:'browser',username:'old-owner',...options},null);assert.equal(next.username,'');
    }
  });
}
test('other source adapters keep their own account discovery contract',()=>{
  const settings={platform:'dribbble',source:'browser'};assert.equal(accountSearchSettings(settings,null),settings);
});
