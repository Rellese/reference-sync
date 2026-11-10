const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');const {chromium}=require('playwright');
const plugin=path.resolve(__dirname,'../../plugins/reference-canvas');
const {openCase,safeUrl}=require(path.join(plugin,'lib/case.js'));
test('ReferenceCanvas renders a real archive, keeps text inert, opens explicit links and supports zoom/pan',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'canvas-browser-'));let opened,browser;
 t.after(async()=>{await browser?.close();opened?.dispose();fs.rmSync(root,{recursive:true,force:true});});
 const {nodeApi}=await import('../../js/node-bridge.js');Object.assign(nodeApi,{fs,path,crypto,Buffer});
 const {writeCaseZip}=await import('../../js/case/zip-writer.js');
 const archive=path.join(root,'test.rscase');
 const media=process.env.CANVAS_TEST_MEDIA;
 const mediaEntries=media?[{name:'assets/2.mp4',data:fs.readFileSync(media+'.mp4')},{name:'assets/3.gif',data:fs.readFileSync(media+'.gif')}]:[];
 await writeCaseZip(archive,[{name:'manifest.json',data:JSON.stringify({format:'reference-sync-case',version:1,source:{title:'ReferenceCanvas · Preview',url:'https://www.behance.net/gallery/12/a'},canvasWidth:1400,cover:'assets/1.png',blocks:[
  {id:'1',position:0,kind:'image',status:'local',asset:'assets/1.png',width:1400,height:1400},
  {id:'2',position:1,kind:'text',status:'text',text:'<script>window.injected=true</script>\nA continuous canvas.',links:[{url:'https://example.test/',text:'Source'}]},
  {id:'3',position:2,kind:'video',status:'unavailable'},
  {id:'4',position:3,kind:'unsupported',status:'unsupported'},
  ...(media?[{id:'5',position:4,kind:'video',status:'local',asset:'assets/2.mp4'},{id:'6',position:5,kind:'gif',status:'local',asset:'assets/3.gif'}]:[])
 ]})},{name:'assets/1.png',data:fs.readFileSync(path.join(plugin,'assets/logo.png'))},...mediaEntries]);
 opened=await openCase(archive,{lazy:true});
 assert.equal(opened.assets.size,0);
 browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
 const page=await browser.newPage({viewport:{width:1200,height:850}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.exposeFunction('loadAssetFixture',name=>opened.loadAsset(name));
 await page.exposeFunction('loadCaseFixture',()=>({manifest:opened.manifest,assets:[...opened.assets]}));
 await page.addInitScript(()=>{
  window.openedLinks=[];
  window.require=name=>{
   if(name==='path')return {dirname:()=>'',join:()=> 'case-reader'};
   if(name==='url')return {fileURLToPath:value=>value};
   if(name==='case-reader')return {openCase:async()=>{const value=await window.loadCaseFixture();return {...value,assets:new Map(value.assets),dispose(){},loadAsset:name=>window.loadAssetFixture(name)};},safeUrl:value=>/^https?:\/\//.test(value)?value:''};
   if(name==='electron')return {shell:{openExternal:async value=>window.openedLinks.push(value)}};
   throw new Error(name);
  };
 });
 await page.goto(pathToFileURL(path.join(plugin,'viewer/index.html')).href+'?path=fixture&lang=en');
 await page.waitForFunction(()=>document.querySelectorAll('section').length>=4);
 await page.waitForFunction(()=>document.querySelector('section img').naturalWidth>0);
 assert.equal(await page.evaluate(()=>window.injected),undefined);
 assert.equal(await page.locator('.placeholder').count(),2);
 assert.match(await page.locator('.text').textContent(),/<script>/);
 await page.locator('#zoom-range').focus();await page.keyboard.press('ArrowRight');
 const first=await page.locator('#zoom').textContent();
 await page.locator('#zoom-range').focus();await page.keyboard.press('ArrowRight');assert.notEqual(await page.locator('#zoom').textContent(),first);
 await page.locator('#viewport').evaluate(node=>{node.scrollTop=0;});
 await page.mouse.move(600,500);await page.mouse.down();await page.mouse.move(450,300,{steps:4});await page.mouse.up();
 assert.ok(await page.locator('#viewport').evaluate(node=>node.scrollTop)>0);
 await page.getByRole('button',{name:'Source',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.openedLinks),['https://example.test/']);
 await page.getByRole('button',{name:'Fit',exact:true}).click();
 assert.equal(await page.locator('#minimap').isVisible(),true);
 await page.locator('#minimap').click({position:{x:60,y:90}});
 assert.ok(await page.locator('#viewport').evaluate(node=>node.scrollTop)>0);
 await page.getByRole('button',{name:'Fit',exact:true}).click();
 if(process.env.UI_SCREENSHOT)await page.screenshot({path:process.env.UI_SCREENSHOT+'-reference-canvas.png'});
 if(media){
  await page.locator('video').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>document.querySelector('video').duration>0);
  await page.locator('video').evaluate(async video=>{video.muted=true;await video.play();});
  await page.waitForFunction(()=>document.querySelector('video').currentTime>.1);
  await page.locator('video').evaluate(video=>video.pause());
  await page.locator('section img').last().scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>[...document.querySelectorAll('section img')].every(image=>image.naturalWidth>0));
 }
 const themes={dark:'rgb(24, 25, 28)',gray:'rgb(55, 56, 60)',blue:'rgb(13, 22, 48)',purple:'rgb(28, 20, 36)',light:'rgb(255, 255, 255)',lightgray:'rgb(227, 228, 230)'};
 for(const [theme,color] of Object.entries(themes)){
  await page.goto(pathToFileURL(path.join(plugin,'viewer/index.html')).href+'?path=fixture&lang=en&theme='+theme);
  assert.equal(await page.locator('header').evaluate(node=>getComputedStyle(node).backgroundColor),color);
 }
 await page.emulateMedia({colorScheme:'dark'});
 await page.goto(pathToFileURL(path.join(plugin,'viewer/index.html')).href+'?path=fixture&lang=en&theme=auto');
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 assert.deepEqual(errors,[]);assert.equal(safeUrl('file:///etc/passwd'),'');
});
