import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { installedBrowserOptions, parseFirefoxProfiles } from '../../js/browser-installations.js';
import { createProfileSessionController } from '../../js/profile-session.js';
import { buildCookieSpec } from '../../js/browser-profiles.js';
import { pinterestSessionFromHtml } from '../../js/sources/pinterest-containers.js';

test('browser list contains only installed applications and excludes Safari on Windows', () => {
  const files = new Set(['/Applications/Google Chrome.app', '/System/Applications/Safari.app']);
  assert.deepEqual(installedBrowserOptions({ platform: 'darwin', home: '/home/test', exists: p => files.has(p), join: path.posix.join }).map(b => b.value), ['chrome', 'safari']);
  assert.deepEqual(installedBrowserOptions({ platform: 'win32', home: 'C:/Users/test', env: { LOCALAPPDATA: 'C:/Apps' }, exists: p => p.endsWith('chrome.exe'), join: path.win32.join }).map(b => b.value), ['chrome']);
});
test('Firefox profiles use exact paths and reject traversal', () => {
  const profiles = parseFirefoxProfiles('[Profile0]\nName=Work\nPath=Profiles/abc.default\nIsRelative=1\nDefault=1\n[Profile1]\nPath=../private', '/Firefox', path.posix);
  assert.equal(profiles.length, 1);
  assert.equal(buildCookieSpec({ browser: 'firefox', profileId: profiles[0].id }), 'firefox:/Firefox/Profiles/abc.default');
});
test('Yandex cannot silently fall back to another browser account', () => {
  assert.throws(() => buildCookieSpec({ browser: 'yandex' }));
  assert.equal(buildCookieSpec({ browser: 'yandex', profileRoot: '/Yandex' }), 'chrome:/Yandex');
});
test('late account probe cannot overwrite a newer profile identity', async () => {
  const states = [], resolvers = [];
  const session = createProfileSessionController({ probe: () => new Promise(resolve => resolvers.push(resolve)), onState: s => states.push(s) });
  const first = session.refresh({ browserProfile: 'old' });
  const second = session.refresh({ browserProfile: 'new' });
  resolvers[1]({ authenticated: true, username: 'new-user' }); await second;
  resolvers[0]({ authenticated: true, username: 'old-user' }); await first;
  assert.equal(states.at(-1).username, 'new-user');
  assert.equal(states[1].username, undefined);
});
test('Pinterest identity requires an authenticated session context, never a pin author', () => {
  const html = data => `<script id="__PWS_DATA__">${JSON.stringify(data)}</script>`;
  assert.equal(pinterestSessionFromHtml(html({ initialReduxState: { pins: { username: 'author' } } })).status, 'unknown');
  assert.equal(pinterestSessionFromHtml(html({ initialReduxState: { context: { isAuth: true, user: { username: 'owner' } } } })).username, 'owner');
});

test('Pinterest supports initial props and session user references, without guessing public identities', async () => {
  const { pinterestSessionFromHtml, pinterestCookieHeaderForHost, pinterestRedirect } = await import('../../js/pinterest-session.js');
  const html = data => `<script id="__PWS_INITIAL_PROPS__">${JSON.stringify(data)}</script>`;
  assert.equal(pinterestSessionFromHtml(html({ initialReduxState: { context: { isAuth: true, user: '7' }, users: { 7: { username: 'owner' }, 8: { username: 'someone-else' } } } })).username, 'owner');
  assert.equal(pinterestSessionFromHtml(html({ context: { isAuth: true, user: { username: 'session-owner' } } })).username, 'session-owner');
  assert.equal(pinterestSessionFromHtml(html({ initialReduxState: { users: { 7: { username: 'public-user' } } } })).status, 'unknown');
  const jar = '.pinterest.com\tTRUE\t/\tTRUE\t0\tsession\tshared\nwww.pinterest.com\tFALSE\t/\tTRUE\t0\thostonly\tprivate';
  assert.equal(pinterestCookieHeaderForHost(jar, 'ru.pinterest.com'), 'session=shared');
  assert.equal(pinterestCookieHeaderForHost(jar, 'evil.test'), '');
  assert.equal(pinterestRedirect('https://ru.pinterest.com/', 'https://www.pinterest.com/').hostname, 'ru.pinterest.com');
  assert.equal(pinterestRedirect('https://pinterest.com.evil.test/', 'https://www.pinterest.com/'), null);
});
