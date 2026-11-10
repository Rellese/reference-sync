const idPattern=/^[a-z0-9]{10,40}$/;
const reserved=new Set(['api','auth','account','explore','jobs','layers','collections','groups','lists','legal','notifications','messages','profile','tags','colors','palettes','connect','search','admin','onboarding','verify']);
const invalid=()=>Error('Вставьте HTTPS-ссылку на работу, коллекцию или профиль Layers.');
export function layersTarget(input){
 let url;try{url=new URL(String(input||'').trim());}catch{}
 if(!url||url.protocol!=='https:'||url.username||url.password||url.port||!['layers.to','www.layers.to'].includes(url.hostname))throw invalid();
 let match=url.pathname.match(/^\/(layers|collections)\/([a-z0-9]{10,40})(?:-[^/]+)?\/?$/);
 if(match)return {id:match[2],type:match[1]==='layers'?'POST':'COLLECTION',url:`https://layers.to/${match[1]}/${match[2]}`,name:'Layers '+match[2]};
 match=url.pathname.match(/^\/([A-Za-z0-9_.-]{1,80})(?:\/groups)?\/?$/);
 if(match&&!reserved.has(match[1].toLowerCase()))return {id:match[1],username:match[1],type:'ROOT',url:`https://layers.to/${match[1]}/groups`,name:match[1]};
 throw invalid();
}
export function layersCollection(item){
 const id=String(item.id||'');if(!idPattern.test(id))throw Error('LAYERS_COLLECTION');
 const target=layersTarget(item.url||'https://layers.to/collections/'+id);
 if(target.type!=='COLLECTION'||target.id!==id)throw Error('LAYERS_COLLECTION');
 return {...target,name:String(item.name||target.name)};
}
// Exact platform storage buckets only; never allow arbitrary AWS/R2 tenants.
export function layersMediaUrl(value){
 let url;try{url=new URL(value);}catch{}
 if(!url||url.protocol!=='https:'||url.username||url.password||url.port||!url.pathname||url.pathname==='/')throw Error('LAYERS_MEDIA_URL');
 const buckets=['layers-uploads-prod.s3.eu-west-2.amazonaws.com','layers-uploads-prod.s3.amazonaws.com','layers-uploads-prod.s3-accelerate.amazonaws.com'];
 const pathBucket=['s3.eu-west-2.amazonaws.com','s3.amazonaws.com'].includes(url.hostname)&&url.pathname.startsWith('/layers-uploads-prod/');
 if(url.hostname!=='layers-r2.com'&&!buckets.includes(url.hostname)&&!pathBucket)throw Error('LAYERS_MEDIA_URL');
 return url.href;
}
