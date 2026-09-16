// Run with Node's test runner and Playwright available (see tests/README.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
let browser, server, base;
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };

test.before(async () => {
  server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
      let body = await fs.readFile(file);
      // Expose the actual picker only in the test response, never in shipped code.
      if (pathname === '/js/main.js') body += '\nwindow.__testPicker = selectCollectionsInTable;';
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
});
test.after(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve));
});

async function setup(t) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.goto(base);
  await page.waitForSelector('#reference-sync');
  await page.waitForFunction(() => window.__rs?.ui.results?.engine);
  await page.evaluate(() => window.__rs.ui.results.engine.setState('ready', 'Fixture engine'));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  return page;
}
const all = page => page.locator('.rs-results__tools [role=checkbox]');
const row = (page, id) => page.locator(`[data-table-post-id="${id}"] [role=checkbox]`);
const folder = (page, id) => page.locator(`[data-collection-id="${id}"] > .rs-collection__head [role=checkbox]`);
const picker = (page, id) => page.locator(`[data-collection-picker-id="${id}"] [role=checkbox]`);
async function checked(locator, value) {
  await locator.page().waitForFunction(({ selector, value }) =>
    document.querySelector(selector)?.getAttribute('aria-checked') === value,
  { selector: await locator.evaluate(el => {
    if (!el.id) el.id = `check-${crypto.randomUUID()}`;
    return '#' + el.id;
  }), value: String(value) });
}
async function seed(page, { folders = true, duplicate = false, imported = false } = {}) {
  await page.evaluate(({ folders, duplicate, imported }) => {
    const { state, setPosts } = window.__rs;
    state.settings.folderSearch = folders;
    state.settings.thumbnails = false;
    state.collections = folders ? [
      { id: 'board', name: 'Board' },
      { id: 'section', name: 'Section', parentId: 'board', parentName: 'Board' },
      { id: 'other', name: 'Other' },
    ] : [];
    state.knownPostIds = new Set(imported ? ['b'] : []);
    const posts = ['a', 'b', 'c', 'd'].map((postId, i) => ({
      postId, shortcode: postId, author: 'fixture', description: `Publication ${postId}`,
      url: `https://www.instagram.com/p/${postId}/`, type: 'photo', componentCount: 1,
      components: [{ index: 1, type: 'image', url: '' }],
      collectionId: i === 0 ? 'other' : 'section',
      collectionName: i === 0 ? 'Other' : 'Section',
      collectionParentId: i === 0 ? '' : 'board',
    }));
    if (duplicate) posts[0].collectionOccurrences = [
      { collectionId: 'other', collectionName: 'Other' },
      { collectionId: 'section', collectionName: 'Section', parentId: 'board', parentName: 'Board' },
    ];
    setPosts(posts);
  }, { folders, duplicate, imported });
}

test('picker: select all, clear all, Shift range, independent child and collapsed child', async t => {
  const page = await setup(t);
  await page.evaluate(() => { window.__testPicker([
    { id: 'board', name: 'Board' }, { id: 'section', name: 'Section', parentId: 'board' },
    { id: 'other', name: 'Other' },
  ]); });
  await all(page).click();
  for (const id of ['board', 'section', 'other']) await checked(picker(page, id), true);
  await all(page).click();
  for (const id of ['board', 'section', 'other']) await checked(picker(page, id), false);
  await picker(page, 'section').click();
  await checked(picker(page, 'board'), false);
  await checked(all(page), 'mixed');
  await all(page).click(); await all(page).click();
  await picker(page, 'board').click();
  await picker(page, 'other').click({ modifiers: ['Shift'] });
  await checked(picker(page, 'section'), true);
  await checked(all(page), true);
  await page.locator('[data-collection-picker-id="board"] .rs-collection__chevron').click();
  await all(page).click();
  await all(page).click();
  await page.locator('[data-collection-picker-id="board"] .rs-collection__chevron').click();
  await checked(picker(page, 'section'), true);
});

test('results: select all updates both folder levels; individual selections show mixed', async t => {
  const page = await setup(t); await seed(page);
  await all(page).click();
  for (const id of ['board', 'section', 'other']) await checked(folder(page, id), false);
  await row(page, 'b').click();
  await checked(folder(page, 'section'), 'mixed');
  await checked(folder(page, 'board'), 'mixed');
  await checked(all(page), 'mixed');
  if (process.env.UI_SCREENSHOT) await page.screenshot({ path: process.env.UI_SCREENSHOT + '-mixed.png' });
  await row(page, 'b').click();
  await checked(folder(page, 'board'), false);
  await all(page).click();
  await checked(folder(page, 'board'), true);
  await all(page).click();
  await checked(folder(page, 'board'), false);
});

test('results: Shift follows folder display order, not discovery order', async t => {
  const page = await setup(t); await seed(page);
  await all(page).click();
  // Discovery order: a,b,c,d. Tree order: b,c,d,a.
  await row(page, 'c').click();
  await row(page, 'a').click({ modifiers: ['Shift'] });
  await checked(row(page, 'b'), false);
  for (const id of ['a', 'c', 'd']) await checked(row(page, id), true);
  await checked(folder(page, 'board'), 'mixed');
});

test('flat results: select all and Shift work; imported rows stay disabled; Undo restores selection', async t => {
  const page = await setup(t); await seed(page, { folders: false, imported: true });
  await all(page).click();
  await row(page, 'a').click();
  await row(page, 'd').click({ modifiers: ['Shift'] });
  for (const id of ['a', 'c', 'd']) await checked(row(page, id), true);
  assert.equal(await row(page, 'b').getAttribute('aria-disabled'), 'true');
  await checked(all(page), true);
  await all(page).click();
  await checked(all(page), false);
  await page.keyboard.press('Control+z');
  for (const id of ['a', 'c', 'd']) await checked(row(page, id), true);
});

test('same publication in multiple folders updates every visible copy', async t => {
  const page = await setup(t); await seed(page, { duplicate: true });
  assert.equal(await row(page, 'a').count(), 2);
  await all(page).click();
  for (const check of await row(page, 'a').all()) await checked(check, false);
  await row(page, 'a').first().click();
  for (const check of await row(page, 'a').all()) await checked(check, true);
});

test('Stop Link: neutral until search; exact error and placeholder colors; correction and reset', async t => {
  const page = await setup(t);
  const toggle = page.locator('.rs-stop-link [role=switch]');
  await toggle.click();
  const input = page.locator('#stop-link-input');
  assert.equal(await input.getAttribute('aria-invalid'), 'false');
  assert.equal(await page.locator('#stop-link-message').isVisible(), false);
  for (const part of await page.locator('.rs-stop-link .rs-field__split-placeholder span').all()) {
    assert.equal(await part.evaluate(el => getComputedStyle(el).color), 'rgb(112, 112, 112)');
  }
  await page.getByRole('button', { name: 'Начать поиск', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#stop-link-input').getAttribute('aria-invalid') === 'true');
  assert.equal(await page.locator('#stop-link-message').evaluate(el => getComputedStyle(el).color), 'rgb(211, 82, 45)');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.rs-stop-link .rs-field')).borderTopColor === 'rgb(211, 82, 45)');
  if (process.env.UI_SCREENSHOT) await page.screenshot({ path: process.env.UI_SCREENSHOT + '-error.png' });
  await input.fill('https://www.instagram.com/p/AbC123/');
  assert.equal(await input.getAttribute('aria-invalid'), 'false');
  await toggle.click(); await toggle.click(); await input.fill('');
  assert.equal(await input.getAttribute('aria-invalid'), 'false');
});

test('folder selection restores carousel components after select-all clears them', async t => {
  const page = await setup(t); await seed(page);
  await page.evaluate(() => {
    const posts = window.__rs.state.posts;
    posts[1].componentCount = 3;
    posts[1].type = 'carousel';
    posts[1].components = [1, 2, 3].map(index => ({ index, type: 'image' }));
    window.__rs.setPosts(posts);
  });
  await all(page).click();
  await folder(page, 'section').click();
  await checked(row(page, 'b'), true);
  assert.deepEqual(await page.evaluate(() => window.__rs.state.posts[1].selectedComponents), [1, 2, 3]);
  await folder(page, 'board').click();
  await checked(row(page, 'b'), false);
  await checked(folder(page, 'section'), false);
  await page.keyboard.press('Control+z');
  await checked(row(page, 'b'), true);
  await checked(folder(page, 'board'), true);
});
