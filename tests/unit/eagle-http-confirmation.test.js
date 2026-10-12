import test from 'node:test';import assert from 'node:assert/strict';
import {httpEagleItemReady,waitForHttpEagleItem} from '../../js/eagle-http-confirmation.js';
const response=data=>({ok:true,json:async()=>({status:'success',data})});
test('queued ID is confirmed after temporary 500 and zero-size metadata without another write',async()=>{
 let calls=0,time=0;const sequence=[{ok:false,status:500},response({id:'EAGLE1',size:0}),response({id:'EAGLE1',size:10})];
 const id=await waitForHttpEagleItem('EAGLE1',{request:async url=>{assert.match(url,/\/api\/item\/info\?id=EAGLE1$/);return sequence[calls++];},wait:async ms=>time+=ms,now:()=>time});
 assert.equal(id,'EAGLE1');assert.equal(calls,3);assert.equal(time,500);
});
test('wrong ID, deleted item and unreadable API cannot confirm a queued write',async()=>{
 for(const data of [{id:'OTHER',size:4},{id:'EAGLE1',size:4,isDeleted:true},null])assert.equal(await httpEagleItemReady('EAGLE1',{request:async()=>response(data)}),false);
 assert.equal(await httpEagleItemReady('EAGLE1',{request:async()=>{throw Error('offline');}}),false);
});
test('confirmation timeout is explicitly uncertain rather than a failed add that can be retried',async()=>{
 let time=0,calls=0;await assert.rejects(waitForHttpEagleItem('QUEUED',{request:async()=>{calls++;return {ok:false,status:500};},wait:async ms=>time+=ms,now:()=>time,timeoutMs:500}),error=>error.unconfirmed===true);
 assert.equal(calls,3);
});
