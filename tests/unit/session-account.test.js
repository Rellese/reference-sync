import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchingAccount, sessionErrorTitle } from '../../js/session-account.js';
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
