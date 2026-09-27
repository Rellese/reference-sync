import test from 'node:test';
import assert from 'node:assert/strict';
import {collectBehanceBoards,parseBehancePage} from '../../js/sources/behance-collections.js';
const page=(collections,hasMore=false)=>({collections,hasMore,endCursor:"cursor"});
const board=(id,label)=>({id,label});
const initial=(list,actual='designer')=>`<script id="beconfig-store_state">${JSON.stringify({user:{loggedInUser:actual ? {username:actual}:null},profile:{user:{username:'designer'},activeSection:{collections:list}}})}</script>`;
test('saved boards verify session owner and paginate using website cursor, deduplicating IDs',async()=>{
 const urls=[]; const result=await collectBehanceBoards({username:'designer'},async (url,options)=>{urls.push(url);if(urls.length===1)return initial(page([board(1,'One'),board(2,'Two')],true));assert.equal(options.json.variables.after,'cursor');return JSON.stringify({data:{user:{moodboards:{nodes:[board(2,'Two'),board(3,'Three')],pageInfo:{hasNextPage:false}}}}});});
 assert.deepEqual(result.map(x=>x.id),['1','2','3']);assert.equal(result[2].name,'Three');assert.match(urls[1],/\/v3\/graphql$/);
});
test('viewed profile cannot pass as session owner; signed out and mismatch stop before pagination',async()=>{
 for(const [actual,code] of [[null,'BEHANCE_SESSION_INVALID'],['another','BEHANCE_ACCOUNT_MISMATCH']]) {
  await assert.rejects(collectBehanceBoards({username:'designer'},async()=>initial(page([]),actual)),{code});
 }
});
test('empty boards succeed, malformed pages and repeated pagination fail instead of silently truncating',async()=>{
 assert.deepEqual(await collectBehanceBoards({username:'designer'},async()=>initial(page([]))),[]);
 assert.throws(()=>parseBehancePage('<script>not state</script>'));
 let call=0;
 await assert.rejects(collectBehanceBoards({username:'designer'},async()=>++call===1?initial(page([board(1,'One')],true)):JSON.stringify({data:{user:{moodboards:{nodes:[board(1,'One')],pageInfo:{hasNextPage:true,endCursor:'cursor'}}}}})),/повторил/);
 const ac=new AbortController();ac.abort();await assert.rejects(collectBehanceBoards({username:'designer',signal:ac.signal},async()=>initial(page([]))));
});
