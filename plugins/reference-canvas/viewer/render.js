(() => {
 const viewport=document.getElementById('viewport'),surface=document.getElementById('surface'),canvas=document.getElementById('canvas');
 let scale=1,width=1400,drag=null;
 const strings={en:['Fit','Unavailable block','Unsupported block','Cannot play this media','Open source'],ru:['По ширине','Блок недоступен','Неподдерживаемый блок','Не удалось открыть медиа','Открыть источник'],fr:['Ajuster','Bloc indisponible','Bloc non pris en charge','Lecture impossible','Ouvrir la source'],es:['Ajustar','Bloque no disponible','Bloque no compatible','No se puede reproducir','Abrir fuente'],zh:['适应宽度','内容块不可用','不支持的内容块','无法播放媒体','打开来源']};
 const language=(new URLSearchParams(location.search).get('lang')||navigator.language||'en').toLowerCase();
 const words=strings[language.split(/[-_]/)[0]]||strings.en;
 const zoomLabels=({ru:['Уменьшить','Увеличить'],fr:['Réduire','Agrandir'],es:['Reducir','Ampliar'],zh:['缩小','放大']})[language.split(/[-_]/)[0]]||['Zoom out','Zoom in'];
 document.getElementById('out').setAttribute('aria-label',zoomLabels[0]);document.getElementById('in').setAttribute('aria-label',zoomLabels[1]);
 document.documentElement.lang=language;document.getElementById('fit').textContent=words[0];
 function measure(){surface.style.width=`${width*scale}px`;surface.style.height=`${canvas.scrollHeight*scale}px`;canvas.style.transform=`scale(${scale})`;document.getElementById('zoom').textContent=`${Math.round(scale*100)}%`;}
 function zoom(next,x=viewport.clientWidth/2,y=viewport.clientHeight/2){const previous=scale;scale=Math.min(4,Math.max(.05,next));const left=surface.offsetLeft;const px=(viewport.scrollLeft+x-left)/previous,py=(viewport.scrollTop+y-24)/previous;measure();viewport.scrollLeft=px*scale+surface.offsetLeft-x;viewport.scrollTop=py*scale+24-y;}
 function fit(){zoom(Math.min(1,(viewport.clientWidth-48)/width),0,0);viewport.scrollTop=0;viewport.scrollLeft=0;}
 document.getElementById('in').onclick=()=>zoom(scale*1.2);document.getElementById('out').onclick=()=>zoom(scale/1.2);document.getElementById('fit').onclick=fit;
 viewport.addEventListener('wheel',event=>{if(event.ctrlKey||event.metaKey){event.preventDefault();const rect=viewport.getBoundingClientRect();zoom(scale*Math.exp(-event.deltaY*.003),event.clientX-rect.left,event.clientY-rect.top);}},{passive:false});
 viewport.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('button,video,a'))return;drag={x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.setPointerCapture(event.pointerId);viewport.classList.add('is-dragging');});
 viewport.addEventListener('pointermove',event=>{if(!drag)return;viewport.scrollLeft=drag.left+drag.x-event.clientX;viewport.scrollTop=drag.top+drag.y-event.clientY;});
 const stop=()=>{drag=null;viewport.classList.remove('is-dragging');};viewport.addEventListener('pointerup',stop);viewport.addEventListener('pointercancel',stop);window.addEventListener('blur',stop);
 viewport.addEventListener('keydown',event=>{if(event.target!==viewport)return;if(['+','=','-','0'].includes(event.key)){event.preventDefault();event.key==='0'?fit():zoom(event.key==='-'?scale/1.2:scale*1.2);}});
 new ResizeObserver(measure).observe(canvas);window.addEventListener('resize',measure);
 const element=(tag,className,text)=>{const el=document.createElement(tag);el.className=className||'';if(text!==undefined)el.textContent=text;return el;};
 window.renderReferenceCase=(manifest,assets,openLink)=>{
  canvas.replaceChildren();width=manifest.canvasWidth;canvas.style.width=`${width}px`;document.getElementById('title').textContent=manifest.title||'ReferenceCanvas';document.title=manifest.title||'ReferenceCanvas';
  for(const block of manifest.blocks){const section=element('section');section.dataset.blockId=block.id;
   if(block.status==='local'&&assets.has(block.asset)){
    const media=element(block.kind==='video'?'video':'img');media.src=assets.get(block.asset).url;
    if(block.kind==='video'){media.controls=true;media.preload='metadata';media.playsInline=true;}else{media.loading='lazy';media.alt=block.text||'';media.draggable=false;}
    if(block.width&&block.height){media.width=block.width;media.height=block.height;}
    media.addEventListener('error',()=>{media.replaceWith(element('div','placeholder',words[3]));},{once:true});section.append(media);
    if(block.text)section.append(element('div','caption',block.text));
   }else if(block.kind==='text'){const text=element('div','text',block.text);text.style.textAlign=block.alignment;section.append(text);}
   else section.append(element('div','placeholder',block.status==='unsupported'?words[2]:words[1]));
   if(block.links.length){const links=element('div','links');for(const link of block.links){const button=element('button','',link.text||link.url);button.type='button';button.onclick=()=>openLink(link.url);links.append(button);}section.append(links);}
   canvas.append(section);
  }
  if(manifest.sourceUrl){const source=element('button','',words[4]);source.onclick=()=>openLink(manifest.sourceUrl);canvas.append(source);}
  measure();fit();document.getElementById('status').textContent='';
 };
})();
