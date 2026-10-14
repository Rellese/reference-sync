(async()=>{
 const status=document.getElementById('status'),params=new URLSearchParams(location.search);
 const lang=(params.get('lang')||navigator.language).toLowerCase().split(/[-_]/)[0];
 const words=({ru:['Открываю кейс','Не удалось открыть кейс. Проверьте файл и версию ReferenceCanvas.','Не удалось открыть ссылку'],en:['Opening case','Could not open case. Check the file and ReferenceCanvas version.','Could not open link'],fr:['Ouverture du projet','Impossible d’ouvrir le projet. Vérifiez le fichier et la version de ReferenceCanvas.','Impossible d’ouvrir le lien'],es:['Abriendo proyecto','No se pudo abrir el proyecto. Comprueba el archivo y la versión de ReferenceCanvas.','No se pudo abrir el enlace'],zh:['正在打开项目','无法打开项目。请检查文件和 ReferenceCanvas 版本。','无法打开链接']})[lang]||['Opening case','Could not open case. Check the file and ReferenceCanvas version.','Could not open link'];
 const abort=new AbortController();let opened;
 window.addEventListener('beforeunload',()=>{abort.abort();document.querySelectorAll('video').forEach(video=>{video.pause();video.removeAttribute('src');video.load();});try{opened?.dispose();}catch{}});
 try {
  if(typeof require!=='function')throw new Error('EAGLE_REQUIRED');
  const path=require('path'),{fileURLToPath}=require('url');
  const base=path.dirname(fileURLToPath(location.href.split('?')[0]));
  const {openCase,safeUrl}=require(path.join(base,'../lib/case.js'));
  const file=params.get('path');if(!file)throw new Error('NO_FILE');
  status.textContent=words[0]+'…';
  opened=await openCase(file,{lazy:true,signal:abort.signal,onProgress:({current,total})=>{status.textContent=`${words[0]}: ${current}/${total}`;}});
  if(abort.signal.aborted){opened.dispose();return;}
  window.renderReferenceCase(opened.manifest,opened.assets,url=>{const clean=safeUrl(url);if(clean)require('electron').shell.openExternal(clean).catch(()=>{status.textContent=words[2];});},opened.loadAsset);
 }catch(error){status.textContent=words[1];}
})();
