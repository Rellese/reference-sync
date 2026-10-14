// HTTP add acknowledges a queued ID; the item may not exist yet. Never resend it.
const API_URL='http://localhost:41595';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function httpEagleItemReady(id,{request=globalThis.fetch}={}){
 try{
  const response=await request(`${API_URL}/api/item/info?id=${encodeURIComponent(id)}`);
  if(!response.ok)return false;
  const payload=await response.json(),item=payload?.data;
  return payload?.status==='success'&&item?.id===id&&item.isDeleted!==true&&Number(item.size)>0;
 }catch{return false;}
}
export async function waitForHttpEagleItem(id,{request=globalThis.fetch,wait=sleep,timeoutMs=120000,now=Date.now}={}){
 const deadline=now()+timeoutMs;
 do{
  if(await httpEagleItemReady(id,{request}))return id;
  if(now()>=deadline)break;
  await wait(Math.min(250,Math.max(0,deadline-now())));
 }while(now()<=deadline);
 throw Object.assign(Error('Eagle ещё не подтвердил добавление файла'),{unconfirmed:true});
}
