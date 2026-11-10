const fs=require('fs'),path=require('path');
const {openCase}=require('../lib/case.js');
module.exports=async({src,dest,item})=>{
 const opened=await openCase(src,{coverOnly:true});
 try {
  const logo=path.join(__dirname,'../assets/logo.png');
  let png,width,height;
  try {
   const {nativeImage}=require('electron');
   const cover=opened.assets.get(opened.manifest.cover)?.path;
   let image=cover?nativeImage.createFromPath(cover):nativeImage.createEmpty();
   if(image.isEmpty())image=nativeImage.createFromPath(logo);
   const size=image.getSize();
   if(!size.width||!size.height)throw new Error('NO_THUMBNAIL');
   const ratio=Math.min(1,400/Math.max(size.width,size.height));
   image=image.resize({width:Math.max(1,Math.round(size.width*ratio)),height:Math.max(1,Math.round(size.height*ratio))});
   png=image.toPNG();({width,height}=image.getSize());
  }catch{
   // The bundled trusted PNG is also usable if nativeImage is unavailable.
   png=fs.readFileSync(logo);width=png.readUInt32BE(16);height=png.readUInt32BE(20);
  }
  fs.writeFileSync(dest,png);item.width=width;item.height=height;return item;
 }finally{opened.dispose();}
};
