import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBrowserProfileLabel,
  buildCookieSpec,
  parseChromiumProfileCache,
  shouldShowProfileSelector,
} from '../../js/browser-profiles.js';

test('reads real Chrome profile names and account emails', () => {
  const profiles = parseChromiumProfileCache({
    profile: {
      info_cache: {
        'Profile 1': {
          name: 'Ян',
          gaia_name: 'Yan',
          user_name: 'yan@gmail.com',
        },
        'Profile 6': {
          name: 'Shahriar',
          user_name: 'shahriar@gmail.com',
        },
      },
    },
  });

  assert.deepEqual(profiles, [
    {
      id: 'Profile 1',
      name: 'Ян',
      email: 'yan@gmail.com',
    },
    {
      id: 'Profile 6',
      name: 'Shahriar',
      email: 'shahriar@gmail.com',
    },
  ]);
});

test('uses GAIA name when local profile name is missing', () => {
  const profiles = parseChromiumProfileCache({
    profile: {
      info_cache: {
        Default: {
          gaia_name: 'Shahriar',
          user_name: 'shahriar@gmail.com',
        },
      },
    },
  });

  assert.equal(profiles[0].name, 'Shahriar');
  assert.equal(profiles[0].email, 'shahriar@gmail.com');
});

test('builds compact profile label from real name and email', () => {
  assert.equal(
    buildBrowserProfileLabel({
      name: 'Ян',
      email: 'yan@gmail.com',
    }),
    'Ян — yan@gmail.com',
  );

  assert.equal(
    buildBrowserProfileLabel({
      name: 'Shahriar',
      email: '',
    }),
    'Shahriar',
  );
});

test('shows profile selector only when several profiles exist', () => {
  assert.equal(shouldShowProfileSelector([]), false);
  assert.equal(
    shouldShowProfileSelector([{ id: 'Default' }]),
    false,
  );
  assert.equal(
    shouldShowProfileSelector([
      { id: 'Profile 1' },
      { id: 'Profile 6' },
    ]),
    true,
  );
});

test('builds exact gallery-dl cookie profile specification', () => {
  assert.equal(
    buildCookieSpec({
      browser: 'chrome',
      profileId: 'Profile 6',
    }),
    'chrome:Profile 6',
  );

  assert.equal(
    buildCookieSpec({
      browser: 'edge',
      profileId: 'Profile 2',
    }),
    'edge:Profile 2',
  );

  assert.equal(
    buildCookieSpec({
      browser: 'yandex',
      profileId: 'Profile 1',
      profileRoot: '/Users/test/Yandex/YandexBrowser',
    }),
    'chrome:/Users/test/Yandex/YandexBrowser/Profile 1',
  );
});

import {
  findInstagramUsername,
  parseInstagramCookieExport,
} from '../../js/instagram.js';

test('reads Instagram session user id from exported browser cookies', () => {
  const cookies = [
    '# Netscape HTTP Cookie File',
    '#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t2000000000\tds_user_id\t123456',
    '#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t2000000000\tsessionid\tsecret',
  ].join('\n');

  assert.deepEqual(parseInstagramCookieExport(cookies), {
    authenticated: true,
    userId: '123456',
  });
});

test('reports missing Instagram authorization', () => {
  const cookies = [
    '# Netscape HTTP Cookie File',
    '.instagram.com\tTRUE\t/\tFALSE\t2000000000\tcsrftoken\ttoken',
  ].join('\n');

  assert.deepEqual(parseInstagramCookieExport(cookies), {
    authenticated: false,
    userId: '',
  });
});

test('rejects an expired Instagram session cookie', () => {
  const cookies = [
    '# Netscape HTTP Cookie File',
    '.instagram.com\tTRUE\t/\tFALSE\t0\tds_user_id\t123456',
    '#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t1000\tsessionid\texpired',
  ].join('\n');

  assert.deepEqual(
    parseInstagramCookieExport(cookies, 2000),
    {
      authenticated: false,
      userId: '',
    },
  );
});

test('finds username belonging to the authorized Instagram user id', () => {
  const response = [
    2,
    {
      user: {
        pk: '123456',
        username: 'rellese',
      },
      unrelated: {
        pk: '999999',
        username: 'another_account',
      },
    },
  ];

  assert.equal(
    findInstagramUsername(response, '123456'),
    'rellese',
  );
});

test('does not use username belonging to another user id', () => {
  const response = {
    user: {
      pk: '999999',
      username: 'another_account',
    },
  };

  assert.equal(
    findInstagramUsername(response, '123456'),
    '',
  );
});