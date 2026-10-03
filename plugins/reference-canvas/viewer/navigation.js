// Own viewer controls matching Eagle's dimensions; no dependency on its private scripts.
window.createCaseNavigation=(viewport,surface,canvas)=>{
 const map=document.getElementById('minimap'),preview=map.querySelector('canvas'),frame=document.getElementById('map-view');
 const bars=[...document.querySelectorAll('.scrollbar')];
 let scale=1,width=1400,ratio=1,dx=0,dy=0,tick=0;
 function geometry(){
  const height=canvas.scrollHeight;
  ratio=Math.min(118/width,118/Math.max(1,height));dx=(118-width*ratio)/2;dy=(118-height*ratio)/2;
  return height;
 }
 function position(){
  tick=0;const height=geometry();
  map.hidden=width*scale<=viewport.clientWidth&&height*scale<=viewport.clientHeight;
  const left=Math.max(0,(viewport.scrollLeft-surface.offsetLeft)/scale),top=Math.max(0,(viewport.scrollTop-24)/scale);
  const right=Math.min(width,(viewport.scrollLeft+viewport.clientWidth-surface.offsetLeft)/scale),bottom=Math.min(height,(viewport.scrollTop+viewport.clientHeight-24)/scale);
  Object.assign(frame.style,{left:`${dx+left*ratio}px`,top:`${dy+top*ratio}px`,width:`${Math.max(0,right-left)*ratio}px`,height:`${Math.max(0,bottom-top)*ratio}px`});
  for(const bar of bars){const vertical=bar.classList.contains('vertical'),size=vertical?viewport.clientHeight:viewport.clientWidth,total=vertical?viewport.scrollHeight:viewport.scrollWidth;
   bar.hidden=total<=size;if(bar.hidden)continue;
   const track=vertical?bar.clientHeight:bar.clientWidth;
   const length=Math.max(20,track*size/total),offset=(vertical?viewport.scrollTop:viewport.scrollLeft)/Math.max(1,total-size)*(track-length),thumb=bar.firstElementChild;
   thumb.style[vertical?'height':'width']=`${length}px`;thumb.style[vertical?'top':'left']=`${offset}px`;
  }
 }
 function schedule(){if(!tick)tick=requestAnimationFrame(position);}
 function redraw(){
  geometry();const ctx=preview.getContext('2d');ctx.clearRect(0,0,240,240);ctx.save();ctx.scale(2,2);ctx.translate(dx,dy);ctx.scale(ratio,ratio);
  for(const section of canvas.querySelectorAll('section')){
   const y=section.offsetTop,h=section.offsetHeight,media=section.querySelector('img,video');
   ctx.fillStyle='#666';ctx.fillRect(0,y,width,h);
   if(media && (media.naturalWidth||media.videoWidth)){try{ctx.drawImage(media,0,y,width,media.offsetHeight);}catch{}}
   else if(section.querySelector('.text')){ctx.fillStyle='#aaa';for(let i=20;i<Math.min(h,300);i+=24)ctx.fillRect(width*.05,y+i,width*.8,6);}
  }
  ctx.restore();schedule();
 }
 function moveMap(event){const rect=map.getBoundingClientRect();viewport.scrollLeft=((event.clientX-rect.left-dx)/ratio)*scale+surface.offsetLeft-viewport.clientWidth/2;viewport.scrollTop=((event.clientY-rect.top-dy)/ratio)*scale+24-viewport.clientHeight/2;}
 map.addEventListener('pointerdown',event=>{if(event.button!==0)return;map.setPointerCapture(event.pointerId);moveMap(event);});
 map.addEventListener('pointermove',event=>{if(map.hasPointerCapture(event.pointerId))moveMap(event);});
 for(const bar of bars){let drag;
  bar.addEventListener('pointerdown',event=>{if(event.button!==0)return;const vertical=bar.classList.contains('vertical'),thumb=bar.firstElementChild,rect=bar.getBoundingClientRect(),coord=vertical?event.clientY:event.clientX,origin=vertical?rect.top:rect.left,thumbSize=vertical?thumb.offsetHeight:thumb.offsetWidth;
   drag={vertical,grab:event.target===thumb?coord-origin-(vertical?thumb.offsetTop:thumb.offsetLeft):thumbSize/2};bar.setPointerCapture(event.pointerId);move(event);
  });
  function move(event){if(!drag)return;const rect=bar.getBoundingClientRect(),size=drag.vertical?bar.clientHeight:bar.clientWidth,length=drag.vertical?bar.firstElementChild.offsetHeight:bar.firstElementChild.offsetWidth,total=drag.vertical?viewport.scrollHeight-viewport.clientHeight:viewport.scrollWidth-viewport.clientWidth,offset=(drag.vertical?event.clientY-rect.top:event.clientX-rect.left)-drag.grab;viewport[drag.vertical?'scrollTop':'scrollLeft']=offset/Math.max(1,size-length)*total;}
  bar.addEventListener('pointermove',move);bar.addEventListener('pointerup',()=>drag=null);bar.addEventListener('pointercancel',()=>drag=null);
 }
 viewport.addEventListener('scroll',schedule,{passive:true});new ResizeObserver(redraw).observe(canvas);
 return {update(next,nextWidth){scale=next;width=nextWidth;schedule();},redraw};
};
