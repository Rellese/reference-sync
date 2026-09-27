import test from 'node:test';
import assert from 'node:assert/strict';
import {collectBehanceBoards,parseBehancePage} from '../../js/sources/behance-collections.js';
const page=(collections,hasMore=false)=>({collections,hasMore,endCursor:'cursor'});
const board=(id,label)=>({id,label});
const initial=(list,actual='designer')=>`<script id="beconfig-store_state">${JSON.stringify({user:{loggedInUser:actual ? {username:actual,displayName:'Display Name With Spaces'}:null},profile:{user:{username:'untrusted-profile'},activeSection:{collections:list}}})}</script>`;
test('saved boards derive username from session, ignore typed nickname and paginate with cursor',async()=>{
 const urls=[];const result=await collectBehanceBoards({username:'wrong manual nickname'},async (url,options)=>{
  urls.push(url);
  if(urls.length<=2)return initial(page([board(1,'One'),board(2,'Two')],true));
  assert.equal(options.json.variables.after,'cursor');assert.equal(options.json.variables.username,'designer');
  return JSON.stringify({data:{user:{moodboards:{nodes:[board(2,'Two'),board(3,'Three')],pageInfo:{hasNextPage:false}}}}});
 });
 assert.deepEqual(result.map(x=>x.id),['1','2','3']);assert.equal(result[2].name,'Three');
 assert.equal(urls[0],'https://www.behance.net/');assert.equal(urls[1],'https://www.behance.net/designer/moodboards');
 assert.match(urls[2],/\/v3\/graphql$/);
});
test('signed out stops before boards; a session change between requests is rejected',async()=>{
 let calls=0;
 await assert.rejects(collectBehanceBoards({},async()=>{calls++;return initial(page([]),null);}),{code:'BEHANCE_SESSION_INVALID'});
 assert.equal(calls,1);calls=0;
 await assert.rejects(collectBehanceBoards({},async()=>initial(page([]),++calls===1?'designer':'another')),{code:'BEHANCE_ACCOUNT_MISMATCH'});
});
test('empty boards succeed; malformed pages and repeated cursors do not silently truncate',async()=>{
 assert.deepEqual(await collectBehanceBoards({},async()=>initial(page([]))),[]);
 assert.throws(()=>parseBehancePage('<script>not state</script>'));
 let call=0;
 await assert.rejects(collectBehanceBoards({},async()=>++call<=2?initial(page([board(1,'One')],true)):JSON.stringify({data:{user:{moodboards:{nodes:[board(1,'One')],pageInfo:{hasNextPage:true,endCursor:'cursor'}}}}})),/повторил/);
 const ac=new AbortController();ac.abort();await assert.rejects(collectBehanceBoards({signal:ac.signal},async()=>initial(page([]))));
});
