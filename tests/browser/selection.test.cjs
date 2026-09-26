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
      if (pathname === '/js/main.js') body += '\nwindow.__testPicker = selectCollectionsInTable; window.__testConfirmedImport = recordConfirmedImport; window.__testFinishImportSelection = finishImportSelection; window.__testShowImportResult = showImportResult; window.__testReportError = reportRunError;';
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

test('same publication in multiple folders can switch its selected destination', async t => {
  const page = await setup(t); await seed(page, { duplicate: true });
  assert.equal(await row(page, 'a').count(), 2);
  await all(page).click();
  for (const check of await row(page, 'a').all()) await checked(check, false);
  await row(page, 'a').first().click();
  await checked(row(page, 'a').first(), true);
  await checked(row(page, 'a').nth(1), false);
  await row(page, 'a').nth(1).click();
  await checked(row(page, 'a').first(), false);
  await checked(row(page, 'a').nth(1), true);
  assert.equal(await page.evaluate(() => [...window.__rs.state.selected].filter(id => id === 'a').length), 1);
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

test('long table: stable scroll extent and immediate text while thumbnails load', async t => {
  const page = await setup(t);
  await page.route('**/delayed-thumbnail.svg', async route => {
    await new Promise(resolve => setTimeout(resolve, 250));
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>' });
  });
  await page.evaluate(() => {
    const { state, setPosts } = window.__rs;
    state.settings.folderSearch = false;
    state.settings.thumbnails = true;
    state.collections = [];
    setPosts(Array.from({ length: 1000 }, (_, i) => ({
      postId: `long-${i}`, username: '@fixture', description: `Visible text ${i}`,
      url: `https://www.instagram.com/p/long-${i}/`, type: 'photo', componentCount: 1,
      previewUrl: '/delayed-thumbnail.svg', components: [{ index: 1, type: 'image' }],
    })));
  });
  const sizes = await page.evaluate(async () => {
    const body = document.querySelector('.rs-table__body');
    const initial = body.scrollHeight;
    body.scrollTop = body.scrollHeight;
    await new Promise(requestAnimationFrame);
    const last = body.querySelector('.rs-row:last-child');
    return { initial, final: body.scrollHeight, text: last.textContent,
      rowHeight: last.getBoundingClientRect().height,
      visibility: getComputedStyle(last).contentVisibility };
  });
  assert.equal(sizes.initial, sizes.final);
  assert.equal(sizes.rowHeight, 70);
  assert.equal(sizes.visibility, 'visible');
  assert.match(sizes.text, /Visible text 999/);
  await page.locator('.rs-row:last-child .rs-thumb img').waitFor();
  await page.waitForFunction(() => !document.querySelector('.rs-row:last-child .rs-thumb').classList.contains('is-loading'));
});

test('design: panel resizing and switch hover settle without a layout error', async t => {
  const page = await setup(t);
  const handle = page.locator('.rs-panel-resizer--width');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 62, box.y + 100);
  await page.mouse.up();
  const width = await page.locator('.rs-work').evaluate(el => getComputedStyle(el).gridTemplateColumns);
  assert.match(width, /^463px/);
  const sw = page.locator('.rs-switch').first();
  await sw.hover();
  assert.equal(await sw.locator('.rs-switch__knob').evaluate(el => getComputedStyle(el).animationDuration), '0.3s');
  await page.waitForTimeout(350);
  assert.equal(await sw.locator('.rs-switch__knob').evaluate(el => getComputedStyle(el).transform), 'none');
  await sw.click();
  assert.equal(await sw.evaluate(el => el.classList.contains('is-hover-suppressed')), true);
  assert.equal(await sw.locator('.rs-switch__knob').evaluate(el => getComputedStyle(el).animationName), 'none');
});

test('naming: add independent counters and descriptions, remove without leaking dropdowns', async t => {
  const page = await setup(t);
  await seed(page, { folders: false });
  const cards = page.locator('.rs-naming__card');
  assert.equal(await cards.count(), 3);
  const menus = await page.locator('.rs-select-menu').count();
  await page.getByRole('button', { name: '+ Добавить ещё счётчик', exact: true }).click();
  assert.equal(await cards.count(), 4);
  await page.getByRole('button', { name: 'Удалить счётчик', exact: true }).last().click();
  assert.equal(await cards.count(), 3);
  assert.equal(await page.locator('.rs-select-menu').count(), menus);
  await page.getByRole('button', { name: '+ Добавить ещё описание', exact: true }).click();
  assert.equal(await cards.count(), 4);
  const text = page.locator('.rs-naming__text').last();
  await text.fill('Custom footer');
  await text.blur();
  const saved = await page.evaluate(() => window.__rs.state.settings.descriptions);
  assert.equal(saved[1].text, 'Custom footer');
  assert.equal(await page.locator('.rs-row').first().textContent().then(s => s.includes('Custom footer')), true);
});

test('folder design: checkboxes stay aligned at every depth and thumbnails indent by 33px', async t => {
  const page = await setup(t);
  await seed(page);
  await page.evaluate(() => {
    window.__rs.state.settings.thumbnails = true;
    window.__rs.setPosts(window.__rs.state.posts);
  });
  const positions = await page.evaluate(() => {
    const x = selector => document.querySelector(selector).getBoundingClientRect().x;
    return {
      root: x('[data-collection-id="board"] > .rs-collection__head [role=checkbox]'),
      child: x('[data-collection-id="section"] > .rs-collection__head [role=checkbox]'),
      post: x('[data-table-post-id="b"] [role=checkbox]'),
      rootThumb: x('[data-table-post-id="a"] .rs-thumb'),
      childThumb: x('[data-table-post-id="b"] .rs-thumb'),
    };
  });
  assert.equal(positions.root, positions.child);
  assert.equal(positions.child, positions.post);
  assert.equal(positions.childThumb - positions.rootThumb, 33);
  if (process.env.UI_SCREENSHOT) await page.screenshot({ path: `${process.env.UI_SCREENSHOT}-tree.png` });
});

test('archive mode replaces browser fields with a file drop zone', async t => {
  const page = await setup(t);
  await page.getByText('Из архива', { exact: true }).click();
  assert.equal(await page.locator('.rs-archive__drop').isVisible(), true);
  assert.equal(await page.getByText('Браузер с выполненным входом', { exact: true }).isVisible(), false);
  await page.locator('.rs-archive input[type=file]').setInputFiles({ name: 'test.json', mimeType: 'application/json', buffer: Buffer.from('[]') });
  await page.getByText('Чтение архивов доступно внутри Eagle', { exact: true }).waitFor();
  await page.getByText('Через авторизованный браузер', { exact: true }).click();
  assert.equal(await page.locator('.rs-archive__drop').isVisible(), false);
});

test('picker: dragging paints selection and deselection independently across folders', async t => {
  const page = await setup(t);
  await page.evaluate(() => { window.__testPicker([
    { id: 'board', name: 'Board' }, { id: 'section', name: 'Section', parentId: 'board' }, { id: 'other', name: 'Other' },
  ]); });
  for (const expected of [true, false]) {
    const start = await picker(page, 'board').boundingBox();
    const end = await picker(page, 'other').boundingBox();
    await page.mouse.move(start.x + 6, start.y + 6);
    await page.mouse.down();
    await page.mouse.move(end.x + 6, end.y + 6, { steps: 12 });
    await page.mouse.up();
    for (const id of ['board', 'section', 'other']) await checked(picker(page, id), expected);
  }
});

test('picker: root and child folders have the same compact checkbox-to-icon gap', async t => {
  const page = await setup(t);
  await page.evaluate(() => { window.__testPicker([{ id: 'board', name: 'Board' }, { id: 'section', name: 'Section', parentId: 'board' }]); });
  const gaps = await page.locator('[data-collection-picker-id]').evaluateAll(rows => rows.map(row =>
    row.querySelector('.rs-collection__folder').getBoundingClientRect().left - row.querySelector('[role=checkbox]').getBoundingClientRect().right));
  assert.deepEqual(gaps, [10, 10]);
});

test('panel divider double-click restores default width and automatic naming height', async t => {
  const page = await setup(t);
  const width = page.locator('.rs-panel-resizer--width');
  await width.focus(); await page.keyboard.press('ArrowRight');
  await width.dblclick();
  assert.equal(await page.locator('.rs-work').evaluate(el => parseFloat(getComputedStyle(el).gridTemplateColumns)), 403);
  const height = page.locator('.rs-panel-resizer--height');
  await height.focus(); await page.keyboard.press('ArrowUp');
  assert.notEqual(await page.locator('.rs-right').evaluate(el => el.style.getPropertyValue('--rs-naming-height')), '');
  await height.dblclick();
  assert.equal(await page.locator('.rs-right').evaluate(el => el.style.getPropertyValue('--rs-naming-height')), '');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rs-panel-sizes')));
  assert.deepEqual(saved, { width: 403, height: null });
});

test('naming reference: two sections, stacked counters and responsive collapse', async t => {
  const page = await setup(t);
  await page.evaluate(() => {
    const root = document.querySelector('.rs-naming');
    document.body.appendChild(root);
    Object.assign(root.style, { position: 'fixed', left: '0', top: '0', width: '1132px', height: '906px', maxHeight: 'none', zIndex: '9999' });
    Object.assign(root.querySelector('.rs-naming__body').style, { height: '100%', maxHeight: 'none' });
  });
  const geometry = await page.locator('.rs-naming').evaluate(root => {
    const sections = [...root.querySelectorAll('.rs-naming__section')].map(node => node.getBoundingClientRect());
    const counters = [...root.querySelectorAll('.rs-naming__section:first-child .rs-naming__card')].map(node => node.getBoundingClientRect());
    const spinner = root.querySelector('.rs-spinner').getBoundingClientRect();
    return { tops: sections.map(r => r.top), widths: sections.map(r => r.width), gap: sections[1].left - sections[0].right,
      counterLefts: counters.map(r => r.left), stacked: counters[1].top >= counters[0].bottom,
      spinnerWidth: spinner.width, counterWidth: counters[0].width };
  });
  assert.equal(geometry.tops[0], geometry.tops[1]);
  assert.equal(geometry.widths[0], geometry.widths[1]);
  assert.equal(geometry.gap, 30);
  assert.equal(geometry.counterLefts[0], geometry.counterLefts[1]);
  assert.equal(geometry.stacked, true);
  assert.equal(geometry.spinnerWidth, geometry.counterWidth);
  if (process.env.UI_SCREENSHOT) await page.locator('.rs-naming').screenshot({ path: `${process.env.UI_SCREENSHOT}-naming.png` });
  await page.locator('.rs-naming').evaluate(root => { root.style.width = '650px'; });
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('.rs-naming__section')].map(node => node.getBoundingClientRect());
    return rows[1].top >= rows[0].bottom;
  });
  assert.equal(await page.locator('.rs-naming').evaluate(root => root.scrollWidth <= root.clientWidth), true);
});

test('languages: switch live, retain user data and selection, restore saved locale', async t => {
  const page = await setup(t);
  await seed(page, { folders: false });
  await page.evaluate(() => {
    const input = document.querySelector('.rs-step input:not([readonly]):not([type=file])');
    input.value = 'Описание'; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const selected = await page.evaluate(() => [...window.__rs.state.selected]);
  const removeCount = await page.locator('.rs-naming__remove').count();
  for (const [button, code, expected] of [
    ['EN', 'en', 'Use numbering'], ['FR', 'fr', 'Utiliser la numérotation'],
    ['ES', 'es', 'Usar numeración'], ['中文', 'zh-CN', '使用编号'], ['РУ', 'ru', 'Использовать нумерацию'],
  ]) {
    await page.getByRole('button', { name: button, exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('lang'), code);
    assert.equal(await page.locator('.rs-naming__section').first().locator('.rs-switch-row__label').textContent(), expected);
    assert.equal(await page.locator('.rs-step input:not([readonly]):not([type=file])').first().inputValue(), 'Описание');
    assert.deepEqual(await page.evaluate(() => [...window.__rs.state.selected]), selected);
  }
  assert.equal(await page.locator('.rs-naming__remove').count(), removeCount);
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('button', { name: '+ Add another counter', exact: true }).click();
  assert.equal(await page.locator('.rs-naming__card-title').first().evaluate(el => el.firstChild.textContent), 'First number');
  assert.equal(await page.locator('.rs-naming__section').first().locator('.rs-naming__card-title').nth(1).evaluate(el => el.firstChild.textContent), 'Second number');
  await page.evaluate(() => window.__rs.ui.status.set('Готов к работе', 'Найдено: 12'));
  assert.equal(await page.locator('.rs-status__text').textContent(), 'Ready');
  await page.reload();
  await page.waitForSelector('#reference-sync');
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await page.locator('.rs-lang__item.is-active').textContent(), 'EN');
  if (process.env.UI_SCREENSHOT) await page.screenshot({ path: process.env.UI_SCREENSHOT + '-english.png' });
  const untranslated = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const values = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (/[А-Яа-яЁё]/.test(node.textContent) && node.textContent !== 'РУ') values.push(node.textContent);
    }
    return values;
  });
  assert.deepEqual(untranslated, []);

});

test('localized layout: labels and controls fit minimum window and narrow panels', async t => {
  const page = await setup(t);
  await page.setViewportSize({ width: 1200, height: 760 });
  await page.evaluate(() => {
    const { ui, state } = window.__rs;
    state.settings.extraFilters = true; ui.settings.sync();
    ui.status.set('Поиск завершён на Stop Link без новых публикаций.', 'Проверьте выбор и нажмите «Скачать и добавить в Eagle»');
    for (let i = 0; i < 13; i++) document.querySelector('.rs-panel-resizer--width').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    ui.naming.node.style.setProperty('--rs-naming-height', '300px');
  });
  for (const code of ['EN', 'FR', 'ES', '中文', 'РУ']) {
    await page.getByRole('button', { name: code, exact: true }).click();
    const overflow = await page.evaluate(() => {
      const selectors = '.rs-step__title,.rs-radio-row,.rs-switch-row,.rs-field-label,.rs-naming__label,.rs-naming__add,.rs-results__title-row';
      return [...document.querySelectorAll(selectors)].filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 2)
        .map(el => ({ className: el.className, text: el.textContent, excess: el.scrollWidth - el.clientWidth }));
    });
    assert.deepEqual(overflow, [], code);
    const overlappingHeaders = await page.locator('.rs-table__col').evaluateAll(cells => cells.filter(cell => {
      const range = document.createRange(); range.selectNodeContents(cell.firstChild);
      const box = cell.getBoundingClientRect();
      return [...range.getClientRects()].some(rect => rect.right > box.right + 1 || rect.bottom > box.bottom + 1);
    }).map(cell => cell.textContent));
    assert.deepEqual(overlappingHeaders, [], `${code} table headings`);

    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.UI_SCREENSHOT && code === 'FR') await page.screenshot({ path: process.env.UI_SCREENSHOT + '-french-small.png' });
    await page.evaluate(() => window.__rs.ui.carouselModal.open({
      post: { postId: 'layout', components: [{ index: 1, mediaType: 'image' }, { index: 2, mediaType: 'video' }] },
      selection: new Set([0, 1]), thumbnails: false,
    }));
    const clipped = await page.locator('.rs-carousel-modal__controls > *').evaluateAll(buttons => buttons
      .filter(button => button.scrollWidth > button.clientWidth + 2)
      .map(button => button.textContent));
    assert.deepEqual(clipped, [], `${code} carousel controls`);
    if (process.env.UI_SCREENSHOT && code === 'FR') await page.screenshot({ path: process.env.UI_SCREENSHOT + '-french-carousel.png' });
    await page.evaluate(() => window.__rs.ui.carouselModal.close());

  }
});

test('languages: dynamic errors, progress, carousel files and user content stay correctly separated', async t => {
  const page = await setup(t);
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.evaluate(async () => {
    const { el } = await import('/js/ui.js');
    document.body.appendChild(el('div', 'fixture-user-content', 'Готов к работе'));
    const { ui } = window.__rs;
    ui.status.set('Ошибка поиска', 'Вставьте ссылку на публикацию.');
    ui.status.progress.update({ mode: 'complete', found: 'Найдено: 21', selected: 'Выбрано: 2/21 публикаций', interest: '2 ПУБ. / 3 ЭЛ.' });
    ui.carouselModal.open({ post: { postId: 'lang', components: [
      { index: 1, mediaType: 'image', extension: 'jpg' }, { index: 2, mediaType: 'video', extension: 'mp4' },
    ] }, selection: new Set([0, 1]), thumbnails: false });
  });
  assert.deepEqual(await page.locator('.rs-carousel-modal__media').allTextContents(), ['Image · JPG', 'Video · MP4']);
  await page.evaluate(() => window.__rs.ui.carouselModal.close());
  assert.equal(await page.locator('.rs-status__text').textContent(), 'Search error');
  assert.equal(await page.locator('.rs-status__hint').textContent(), 'Paste a link to a post.');
  assert.equal(await page.locator('.rs-progress__interest').textContent(), '2 POSTS / 3 ITEMS');
  await page.getByRole('button', { name: 'FR', exact: true }).click();
  assert.equal(await page.locator('.fixture-user-content').textContent(), 'Готов к работе');
  assert.equal(await page.locator('.rs-status__text').textContent(), 'Erreur de recherche');
  assert.equal(await page.locator('.rs-status__hint').getAttribute('title'), 'Collez un lien vers une publication.');
  assert.deepEqual(await page.locator('.rs-carousel-modal__media').allTextContents(), ['Image · JPG', 'Vidéo · MP4']);
  assert.equal(await page.locator('.rs-panel-resizer--width').getAttribute('aria-label'), 'Largeur des paramètres');
});

test('table columns: drag, persistence and double-click reset preserve rows and selection', async t => {
  const page = await setup(t);
  page.on('crash', () => assert.fail('Column resizing crashed the renderer'));
  await seed(page, { folders: false });
  if (await all(page).getAttribute('aria-checked') !== 'false') await all(page).click();
  await row(page, 'b').click();
  await checked(row(page, 'b'), true);
  const widths = () => page.locator('.rs-results').evaluate(el =>
    ['lead', 'author', 'structure', 'name', 'description'].map(name =>
      parseFloat(getComputedStyle(el).getPropertyValue(`--rs-table-${name}-width`))));
  const defaults = await widths();
  const dividers = page.locator('.rs-table__column-resizer');
  assert.equal(await dividers.count(), 4);
  for (let i = 0; i < 4; i++) {
    const box = await dividers.nth(i).boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // The document-wide SVG cursor crashed Eagle on pointerdown, even on an empty table.
    assert.equal(await page.locator('html').evaluate(el => getComputedStyle(el).cursor), 'col-resize');
    await page.mouse.move(x + 35, y, { steps: 8 });
    await page.mouse.up();
    const resized = await widths();
    assert.notDeepEqual(resized, defaults);
    assert.equal(resized.reduce((a, b) => a + b), defaults.reduce((a, b) => a + b));
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('reference-sync.table-columns.v2'))), resized);
    await checked(row(page, 'b'), true);
    assert.equal(await page.locator('[data-table-post-id]').count(), 4);
    await dividers.nth(i).dblclick();
    await page.mouse.move(5, 5);
    await page.waitForFunction(() => !document.querySelector('.rs-table').classList.contains('is-column-resize-hovered'));
    assert.deepEqual(await widths(), defaults);
    assert.equal(await page.evaluate(() => localStorage.getItem('reference-sync.table-columns.v2')), null);
    assert.equal(await page.locator('html').evaluate(el => el.classList.contains('is-resizing-table-column')), false);
    await checked(row(page, 'b'), true);
  }
});

test('fonts: all bundled faces decode and load without falling back', async t => {
  const page = await setup(t);
  const fonts = await page.evaluate(async () => {
    const faces = [...document.fonts];
    await Promise.all(faces.map(face => face.load()));
    return faces.map(face => ({ family: face.family, weight: face.weight, status: face.status }));
  });
  assert.equal(fonts.length, 8);
  for (const font of fonts) assert.equal(font.status, 'loaded', `${font.family} ${font.weight}`);
});

test('table columns: invalid saved widths recover and valid widths survive reopening', async t => {
  const page = await setup(t);
  const read = () => page.locator('.rs-results').evaluate(el =>
    ['lead', 'author', 'structure', 'name', 'description'].map(name =>
      parseFloat(getComputedStyle(el).getPropertyValue(`--rs-table-${name}-width`))));
  const defaults = await read();
  for (const invalid of [[-90, 150, 150, 270, 325], [1e100, 150, 150, 270, 325], [90, 150]]) {
    await page.evaluate(value => localStorage.setItem('reference-sync.table-columns.v2', JSON.stringify(value)), invalid);
    await page.reload();
    await page.waitForFunction(() => window.__rs?.ui.results?.engine);
    assert.deepEqual(await read(), defaults);
  }
  const valid = [120, 120, 150, 270, 325];
  await page.evaluate(value => localStorage.setItem('reference-sync.table-columns.v2', JSON.stringify(value)), valid);
  await page.reload();
  await page.waitForFunction(() => window.__rs?.ui.results?.engine);
  assert.deepEqual(await read(), valid);
});

test('unavailable sources: translated tooltip, keyboard access and no activation', async t => {
  const page = await setup(t);
  for (const name of ['Dribbble', 'Behance', 'Vimeo', 'X', 'Layers.to']) {
    const button = page.getByRole('button', { name, exact: true });
    assert.equal(await button.getAttribute('aria-disabled'), 'true');
    await button.hover();
    const tip = page.locator('.rs-soc-tip.is-visible');
    assert.equal(await tip.count(), 1);
    assert.equal(await tip.textContent(), 'Поддержка будет добавлена в будущих обновлениях');
    // Exercise the actual guarded click despite aria-disabled.
    await button.click({ force: true });
    assert.equal(await page.evaluate(() => window.__rs.state.settings.platform), 'instagram');
    await button.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__rs.state.settings.platform), 'instagram');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.rs-soc-tip.is-visible').count(), 0);
  }
  for (const [language, expected] of [
    ['EN', 'Support will be added in future updates'],
    ['FR', 'La prise en charge sera ajoutée lors de futures mises à jour'],
    ['ES', 'La compatibilidad se añadirá en futuras actualizaciones'],
    ['中文', '将在未来更新中添加支持'],
  ]) {
    await page.getByRole('button', { name: language, exact: true }).click();
    await page.getByRole('button', { name: 'Dribbble', exact: true }).hover();
    assert.equal(await page.locator('.rs-soc-tip.is-visible').textContent(), expected);
  }
  await page.getByRole('button', { name: 'Pinterest', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__rs.state.settings.platform), 'pinterest');
  await page.evaluate(() => {
    const key = 'reference-sync.settings.v1';
    const settings = JSON.parse(localStorage.getItem(key));
    settings.platform = 'dribbble'; localStorage.setItem(key, JSON.stringify(settings));
  });
  await page.reload();
  await page.waitForFunction(() => window.__rs?.ui.results?.engine);
  assert.equal(await page.evaluate(() => window.__rs.state.settings.platform), 'instagram');
});

test('numbering: confirmed imports update the visible next number and persist across toggle and reload', async t => {
  const page = await setup(t);
  await page.evaluate(async () => {
    const { createNumberingProgress } = await import('/js/numbering-progress.js');
    const { setSetting } = await import('/js/state.js');
    const { state, ui } = window.__rs;
    setSetting('numberingEnabled', true);
    setSetting('counters', [{ id: 'counter-1', mode: 'global', start: 2, destination: 'name', independent: true }]);
    const generated = new Map(Array.from({ length: 10 }, (_, i) => [String(i), { counterValues: { 'counter-1': i + 2 } }]));
    const advance = createNumberingProgress(state.settings, generated);
    for (let i = 0; i < 10; i++) {
      for (const [key, value] of Object.entries(advance(state.settings, String(i)))) setSetting(key, value);
    }
    ui.naming.sync(state.settings);
  });
  const field = page.locator('.rs-naming .rs-spinner input').first();
  assert.equal(await field.inputValue(), '12');
  const toggle = page.locator('.rs-naming [role=switch]').first();
  await toggle.click(); await toggle.click();
  assert.equal(await field.inputValue(), '12');
  await page.reload(); await page.waitForFunction(() => window.__rs?.ui.results?.engine);
  assert.equal(await field.inputValue(), '12');
});


test('picker: dragging below the viewport paints newly auto-scrolled folders', async t => {
  const page = await setup(t);
  await page.evaluate(() => { window.__testPicker(Array.from({ length: 80 }, (_, i) => ({ id: `folder-${i}`, name: `Folder ${i}` }))); });
  const start = await picker(page, 'folder-0').boundingBox();
  const body = page.locator('.rs-table__body');
  const bounds = await body.boundingBox();
  await page.mouse.move(start.x + 6, start.y + 6);
  await page.mouse.down();
  await page.mouse.move(start.x + 6, bounds.y + bounds.height + 12, { steps: 8 });
  await page.waitForFunction(() => document.querySelector('.rs-table__body').scrollTop > 400);
  await page.mouse.up();
  const selection = await page.locator('[data-collection-picker-id]').evaluateAll(rows => rows.map(row => ({
    id: row.dataset.collectionPickerId, checked: row.querySelector('[role=checkbox]').getAttribute('aria-checked'),
    top: row.getBoundingClientRect().top,
  })));
  const visibleBottom = selection.filter(row => row.top < bounds.y + bounds.height).at(-1);
  assert.equal(visibleBottom.checked, 'true');
  const checkedRows = selection.filter(row => row.checked === 'true');
  assert.ok(checkedRows.length > 10);
  for (const entry of selection.slice(0, checkedRows.length)) assert.equal(entry.checked, 'true');
});


test('folders: collapse and expand retain thousands of row nodes and selection', async t => {
  const page = await setup(t);
  await page.evaluate(() => {
    const { state, setPosts } = window.__rs;
    state.settings.folderSearch = true;
    state.settings.thumbnails = false;
    state.collections = [{ id: 'large', name: 'Large folder' }];
    setPosts(Array.from({ length: 2000 }, (_, i) => ({ postId: `large-${i}`, username: 'Fixture',
      description: '', components: [{ index: 1, type: 'image' }], componentCount: 1,
      collectionId: 'large', collectionName: 'Large folder', type: 'Фото' })));
    window.__retainedRow = document.querySelector('[data-table-post-id]');
  });
  const head = page.locator('[data-collection-id="large"] > .rs-collection__head');
  const selected = await page.evaluate(() => [...window.__rs.state.selected]);
  await head.click();
  assert.equal(await head.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => window.__retainedRow.isConnected), true);
  await head.click();
  assert.equal(await head.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.evaluate(() => window.__retainedRow === document.querySelector('[data-table-post-id]')), true);
  assert.deepEqual(await page.evaluate(() => [...window.__rs.state.selected]), selected);
});


test('folders: hiding previews removes the same 78px gap as the flat table', async t => {
  const page = await setup(t);
  await seed(page);
  const measure = () => page.locator('[data-table-post-id="b"] .rs-table__grid').evaluate(el => parseFloat(getComputedStyle(el).gridTemplateColumns.split(' ')[0]));
  // The class is owned by the results panel, independently of folder depth.
  await page.locator('.rs-results').evaluate(el => el.classList.remove('is-thumbnails-hidden'));
  const shown = await measure();
  await page.locator('.rs-results').evaluate(el => el.classList.add('is-thumbnails-hidden'));
  assert.equal(shown - await measure(), 78);
  assert.match(await page.locator('.rs-collection__chevron').first().evaluate(el => getComputedStyle(el).maskImage), /folder-chevron.svg/);
});


test('confirmed imports immediately disable every source and leave unimported posts selectable', async t => {
  const page = await setup(t);
  for (const source of ['instagram', 'pinterest', 'dribbble', 'behance', 'vimeo', 'x', 'layers']) {
    await seed(page, { folders: true, duplicate: true });
    await page.evaluate(source => {
      window.__rs.state.settings.platform = source;
      window.__testConfirmedImport({ id: `eagle-${source}`, item: { postId: 'a', component: '0', componentCount: 1 } });
    }, source);
    for (const copy of await row(page, 'a').all()) {
      assert.equal(await copy.getAttribute('aria-disabled'), 'true');
      await checked(copy, false);
    }
    assert.equal(await row(page, 'b').getAttribute('aria-disabled'), 'false');
    assert.equal(await page.evaluate(() => window.__rs.state.knownPostIds.has('a')), true);
  }
});


test('finishing a partial import clears remaining checkboxes and displays download errors', async t => {
  const page = await setup(t);
  await seed(page, { folders: true, duplicate: true });
  await page.evaluate(() => {
    const state = window.__rs.state;
    state.posts.find(post => post.postId === 'b').downloadIssue = { label: 'Ошибка загрузки — можно повторить', detail: 'HTTP 403' };
    window.__testConfirmedImport({ id: 'confirmed', item: { postId: 'a', component: '0', componentCount: 1 } });
    window.__testFinishImportSelection();
  });
  assert.equal(await page.evaluate(() => window.__rs.state.selected.size), 0);
  assert.equal(await page.evaluate(() => window.__rs.state.selectedOccurrences.size), 0);
  for (const copy of await row(page, 'b').all()) await checked(copy, false);
  assert.equal(await page.locator('.rs-download-issue').first().getAttribute('title'), 'HTTP 403');
  assert.equal(await row(page, 'b').getAttribute('aria-disabled'), 'false');
});


test('import totals occupy three corners and selection restores normal counters without replacing rows', async t => {
  const page = await setup(t);
  await seed(page, { folders: false });
  const show = async errors => page.evaluate(errors => {
    window.__testFinishImportSelection();
    window.__rs.ui.status.showProgress(true);
    window.__testShowImportResult({complete:420,total:444,partial:0,notImported:24,files:421}, errors);
    window.__savedRow = document.querySelector('[data-table-post-id="b"]');
  }, errors);
  const progress = page.locator('.rs-progress');
  for (const errors of [true, false]) {
    await show(errors);
    assert.equal(await progress.locator('.rs-progress__publication').isVisible(), true);
    assert.equal(await progress.locator('.rs-progress__manage').isVisible(), false);
    const top = progress.locator('.rs-progress__row > .rs-progress__label').last();
    assert.equal(await top.textContent(), 'Полностью добавленных публикаций: 420/444');
    assert.equal(await progress.locator('.rs-progress__found').textContent(), 'Частично: 0Не импортировано: 24');
    assert.equal(await progress.locator('.rs-progress__publication > .rs-progress__label').textContent(), 'Файлов добавлено: 421');
    const colors = await top.evaluate(el => [...el.children].map(node => getComputedStyle(node).color));
    assert.notEqual(colors[0], colors[1]);
    if (errors) await row(page, 'b').click(); else await all(page).click();
    await page.waitForFunction(() => document.querySelector('.rs-progress').dataset.summary === 'false');
    assert.equal(await progress.locator('.rs-progress__found').textContent(), 'Найдено: 4Показано: 4');
    assert.match(await progress.locator('.rs-progress__publication > .rs-progress__label').textContent(), /^Выбрано: [14]\/4 публикаций$/);
    assert.equal(await page.evaluate(() => window.__savedRow === document.querySelector('[data-table-post-id="b"]')), true);
  }
});

test('social buttons restore independent naming cards and persisted next numbers', async t => {
  const page = await setup(t);
  const configure = async (number, text) => page.evaluate(async ({number,text}) => {
    const { setSetting } = await import('/js/state.js');
    setSetting('counters',[{id:'counter-1',mode:'global',start:number,destination:'name',independent:true}]);
    setSetting('descriptions',[{id:'text',text,destination:'description',placement:'end'}]);
    window.__rs.ui.naming.sync();
  }, {number,text});
  await configure(11,'Instagram description');
  await page.getByRole('button',{name:'Pinterest',exact:true}).click();
  assert.equal(await page.locator('.rs-naming__text').inputValue(),'');
  await configure(31,'Pinterest description');
  await page.getByRole('button',{name:'Instagram',exact:true}).click();
  assert.equal(await page.locator('.rs-naming__text').inputValue(),'Instagram description');
  assert.equal(await page.evaluate(()=>window.__rs.state.settings.counters[0].start),11);
  await page.getByRole('button',{name:'Pinterest',exact:true}).click();
  await page.reload();
  await page.waitForFunction(()=>window.__rs?.ui.naming);
  assert.equal(await page.locator('.rs-naming__text').inputValue(),'Pinterest description');
  assert.equal(await page.evaluate(()=>window.__rs.state.settings.counters[0].start),31);
  await page.getByRole('button',{name:'Instagram',exact:true}).click();
  assert.equal(await page.locator('.rs-naming__text').inputValue(),'Instagram description');
  assert.equal(await page.evaluate(()=>window.__rs.state.settings.counters[0].start),11);
});


test('Pinterest account mismatch opens an explanatory modal, as Instagram does', async t => {
  const page = await setup(t);
  await page.evaluate(async()=>{
    const { assertMatchingAccount } = await import('/js/session-account.js');
    try { assertMatchingAccount({authenticated:true,username:'actual'}, {platform:'pinterest',title:'Pinterest',username:'expected',browser:'Chrome'}); }
    catch(error) { window.__testReportError('Ошибка поиска',error); }
  });
  assert.equal(await page.getByText('Выбран другой Pinterest-аккаунт',{exact:true}).count() > 0,true);
  assert.equal(await page.getByText(/@actual, а указан @expected/).count() > 0,true);
});
