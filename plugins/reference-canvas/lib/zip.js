const fs = require('fs');
const {Transform, pipeline, Readable} = require('stream');
const MAX_BYTES = 2 ** 31 - 1;
const crcTable = Array.from({length:256},(_,value)=>{
  for(let i=0;i<8;i++) value=value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crcUpdate(crc, buffer) {
  for(const value of buffer) crc=crcTable[(crc ^ value) & 255] ^ (crc >>> 8);
  return crc;
}
function fail() { throw new Error('INVALID_CASE'); }
function read(fd, length, offset) {
  const result=Buffer.alloc(length);
  if(fs.readSync(fd,result,0,length,offset)!==length) fail();
  return result;
}
function openZip(file) {
  const fd=fs.openSync(file,'r');
  try {
    const stat=fs.fstatSync(fd),size=stat.size;
    if(!stat.isFile() || size<22 || size>MAX_BYTES) fail();
    const length=Math.min(size,65557),tail=read(fd,length,size-length);
    let end=-1;
    for(let i=tail.length-22;i>=0;i--) {
      if(tail.readUInt32LE(i)===0x06054b50 && i+22+tail.readUInt16LE(i+20)===tail.length) {end=i;break;}
    }
    if(end<0) fail();
    const count=tail.readUInt16LE(end+10),bytes=tail.readUInt32LE(end+12),offset=tail.readUInt32LE(end+16);
    if(!count || count>10000 || bytes>2*1024*1024 || offset+bytes!==size-length+end ||
      tail.readUInt16LE(end+4) || tail.readUInt16LE(end+6) || tail.readUInt16LE(end+8)!==count) fail();
    const directory=read(fd,bytes,offset),entries=new Map(),ranges=[];
    let cursor=0,total=0;
    for(let i=0;i<count;i++) {
      if(cursor+46>bytes || directory.readUInt32LE(cursor)!==0x02014b50) fail();
      const flags=directory.readUInt16LE(cursor+8),method=directory.readUInt16LE(cursor+10);
      const crc=directory.readUInt32LE(cursor+16),packed=directory.readUInt32LE(cursor+20),length=directory.readUInt32LE(cursor+24);
      const nameLength=directory.readUInt16LE(cursor+28),extra=directory.readUInt16LE(cursor+30),comment=directory.readUInt16LE(cursor+32);
      const local=directory.readUInt32LE(cursor+42),kind=(directory.readUInt32LE(cursor+38)>>>16)&0xf000;
      if(cursor+46+nameLength+extra+comment>bytes || method!==0 || (flags & ~0x808) || packed!==length ||
        directory.readUInt16LE(cursor+34) || (kind && kind!==0x8000)) fail();
      const name=directory.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
      if(!/^(?:manifest\.json|cover\.svg|assets\/[1-9]\d*\.(?:jpg|jpeg|png|gif|webp|avif|mp4|webm|mov|m4v|mkv))$/.test(name) || entries.has(name)) fail();
      if(local+30>offset) fail();
      const header=read(fd,30,local),localNameLength=header.readUInt16LE(26);
      if(header.readUInt32LE(0)!==0x04034b50 || header.readUInt16LE(6)!==flags || header.readUInt16LE(8)!==0) fail();
      const start=local+30+localNameLength+header.readUInt16LE(28);
      if(start+length>offset || localNameLength!==nameLength || read(fd,nameLength,local+30).toString('utf8')!==name) fail();
      if(!(flags & 8) && (header.readUInt32LE(14)!==crc || header.readUInt32LE(18)!==length || header.readUInt32LE(22)!==length)) fail();
      ranges.push([local,start+length]); total+=length;
      if(total>MAX_BYTES) fail();
      entries.set(name,{name,start,length,crc});
      cursor+=46+nameLength+extra+comment;
    }
    ranges.sort((a,b)=>a[0]-b[0]);
    if(cursor!==bytes || ranges.some((range,index)=>index>0 && range[0]<ranges[index-1][1])) fail();
    return {fd,entries};
  } catch(error) {fs.closeSync(fd);throw error;}
}
function readEntry(zip,name,max=16*1024*1024) {
  const entry=zip.entries.get(name);
  if(!entry || entry.length>max) fail();
  const data=read(zip.fd,entry.length,entry.start);
  if(((crcUpdate(0xffffffff,data)^0xffffffff)>>>0)!==entry.crc) fail();
  return data;
}
async function extractEntry(zip,entry,destination,signal) {
  if(signal?.aborted) throw new Error('CANCELLED');
  let size=0,crc=0xffffffff;
  const input=entry.length ? fs.createReadStream(null,{fd:zip.fd,autoClose:false,start:entry.start,end:entry.start+entry.length-1}) : Readable.from([]);
  const output=fs.createWriteStream(destination,{flags:'wx',mode:0o600});
  const verify=new Transform({transform(chunk,encoding,done){size+=chunk.length;crc=crcUpdate(crc,chunk);done(size>entry.length?new Error('INVALID_CASE'):null,chunk);}});
  const abort=()=>input.destroy(new Error('CANCELLED'));
  signal?.addEventListener('abort',abort,{once:true});
  try {
    await new Promise((resolve,reject)=>pipeline(input,verify,output,error=>error?reject(error):resolve()));
    if(size!==entry.length || ((crc^0xffffffff)>>>0)!==entry.crc) fail();
  } finally {signal?.removeEventListener('abort',abort);}
}
module.exports={openZip,readEntry,extractEntry};
