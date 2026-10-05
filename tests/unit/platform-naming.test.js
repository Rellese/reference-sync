import test from 'node:test';
import assert from 'node:assert/strict';
import { state, defaultSettings, loadSettings, setSetting, settingsForPlatform, setPlatformNaming, appHistory } from '../../js/state.js';
import { createNumberingProgress } from '../../js/numbering-progress.js';
function setup(t) {
  const previous = state.settings, storage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key,value) => values.set(key,value) };
  state.settings = { ...defaultSettings };
  appHistory.clear();
  t.after(() => { state.settings = previous; globalThis.localStorage = storage; appHistory.clear(); });
  return values;
}
test('legacy naming belongs to the active platform; other platforms get independent defaults', t => {
  const values = setup(t);
  values.set('reference-sync.settings.v1', JSON.stringify({platform:'pinterest',numberingStart:17,extraDescription:'Pinterest only'}));
  loadSettings();
  assert.equal(state.settings.counterOneStart,17);
  setSetting('platform','instagram');
  assert.equal(state.settings.counterOneStart,1);
  assert.equal(state.settings.extraDescription,'');
  setSetting('extraDescription','Instagram only');
  setSetting('platform','pinterest');
  assert.equal(state.settings.extraDescription,'Pinterest only');
  assert.equal(state.settings.counterOneStart,17);
});
test('multiple counters and descriptions survive platform switches and application reload', t => {
  setup(t);
  for (const [i, platform] of ['instagram','pinterest','vimeo'].entries()) {
    setSetting('platform',platform);
    setSetting('counters',[{id:'a',mode:'global',start:i+7},{id:'b',mode:'global',start:i+70}]);
    setSetting('descriptions',[{id:'text',text:platform,destination:'both',placement:'end'}]);
    setSetting('numberingEnabled',i !== 1);
  }
  state.settings = { ...defaultSettings }; loadSettings();
  for (const [i, platform] of ['instagram','pinterest','vimeo'].entries()) {
    setSetting('platform',platform);
    assert.equal(state.settings.counters[0].start,i+7);
    assert.equal(state.settings.counters[1].start,i+70);
    assert.equal(state.settings.descriptions[0].text,platform);
    assert.equal(state.settings.numberingEnabled,i !== 1);
  }
});
test('ten confirmations advance only the originating platform to 11 even after switching networks', t => {
  setup(t);
  const initial = { ...state.settings };
  const generated = new Map(Array.from({length:10},(_,i)=>[String(i),{counterValues:{'counter-1':i+1}}]));
  const advance = createNumberingProgress(initial,generated);
  setSetting('platform','pinterest'); setSetting('counterOneStart',88);
  for(let i=0;i<10;i++) for(const [key,value] of Object.entries(advance(settingsForPlatform('instagram'),String(i)))) setPlatformNaming('instagram',key,value);
  assert.equal(state.settings.counterOneStart,88);
  state.settings = { ...defaultSettings }; loadSettings();
  setSetting('platform','instagram'); assert.equal(state.settings.counterOneStart,11);
  setSetting('platform','pinterest'); assert.equal(state.settings.counterOneStart,88);
});
test('undo of a naming edit targets its original platform', t => {
  setup(t);
  setSetting('extraDescription','IG');
  setSetting('platform','pinterest',{record:false});
  setSetting('extraDescription','PIN',{record:false});
  appHistory.undo();
  assert.equal(state.settings.extraDescription,'PIN');
  assert.equal(settingsForPlatform('instagram').extraDescription,'');
});

test('author and type numbering resume independently per network after serialized reload', async () => {
  const { rememberCounterHistory, counterHistorySeeds, serializeCounterHistoryRecords, parseCounterHistoryRecords } = await import('../../js/numbering-history.js');
  for (const mode of ['author','type']) {
    const counters = [{id:'counter-1',mode,start:1}];
    const posts = Array.from({length:10},(_,i)=>({postId:String(i),username:'@same',type:'Видео'}));
    const generated = new Map(posts.map((post,i)=>[post.postId,{counterValues:{'counter-1':i+1}}]));
    let records = rememberCounterHistory({records:new Map(),platform:'instagram',counters,posts,generated,importedPostIds:new Set(posts.map(p=>p.postId))});
    records = parseCounterHistoryRecords(serializeCounterHistoryRecords(records));
    const seed = counterHistorySeeds({records,platform:'instagram',counters});
    assert.equal(mode === 'author' ? seed['counter-1'].authors.same : seed['counter-1'].types['видео'],11);
    assert.deepEqual(counterHistorySeeds({records,platform:'pinterest',counters}),{});
  }
});
