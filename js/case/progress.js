import {nodeApi} from '../node-bridge.js';
import {finalMediaName} from '../downloaded-media.js';
import {caseModes} from './download.js';

// Read only this job's final filenames, never .part / yt-dlp fragment files.
// No extra network requests; polling stops on success, failure or cancellation.
export function watchCaseProgress({post,postDir,current,total,onProgress},interval=500) {
  if(post.source!=='behance'||!caseModes(post).whole||!onProgress)return ()=>{};
  const expected=new Set((post.components||[]).map(c=>Number(c.index)));
  let previous=-1;
  const publish=()=>{
    const found=new Set();
    try{for(const name of nodeApi.fs.readdirSync(postDir)){
      const number=Number(name.split('.')[0]);
      if(finalMediaName(name)&&expected.has(number)&&nodeApi.fs.statSync(nodeApi.path.join(postDir,name)).size>0)found.add(number);
    }}catch{/* Directory may disappear during cancellation. */}
    const completed=Math.max(previous,found.size);if(completed===previous)return;previous=completed;
    onProgress({stage:'download',post,current,total,caseBlocks:{completed,total:expected.size,current:Math.min(completed+1,expected.size)}});
  };
  publish();const timer=setInterval(publish,interval);
  return ()=>{clearInterval(timer);publish();};
}

export function caseProgressInfo(progress) {
  const blocks=progress.caseBlocks;
  if(!blocks)return null;
  return {fraction:((progress.current-1)+(blocks.total?blocks.completed/blocks.total:0))/progress.total,
    found:`Скачиваемый блок: ${blocks.current}`,displayed:`Общее количество блоков: ${blocks.total}`};
}
