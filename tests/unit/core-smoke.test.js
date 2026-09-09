import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createJobControl,
  looksOffline,
  STOPPED,
} from '../../js/job-control.js';

import {
  getSource,
  getSourceForPosts,
  listSources,
  registerSource,
  resetRegistry,
  SourceError,
} from '../../js/sources/registry.js';

test('network errors are separated from Instagram refusals', () => {
  assert.equal(
    looksOffline('Temporary failure in name resolution'),
    true,
  );

  assert.equal(
    looksOffline('HTTP 429 rate limit'),
    false,
  );

  assert.equal(
    looksOffline('Login required'),
    false,
  );
});

test('stopped job rejects the next checkpoint', async () => {
  const control = createJobControl();

  control.stop();

  await assert.rejects(
    control.checkpoint(),
    (error) => error?.code === STOPPED,
  );
});

test('source registry accepts a valid isolated descriptor', () => {
  resetRegistry();

  registerSource({
    code: 'fixture',
    title: 'Fixture',
    ready: false,
    containerTypes: ['ROOT'],
    sourceModes: ['browser'],
    nameMarker: 'fixtureorder',
  });

  assert.equal(getSource('fixture').title, 'Fixture');
  assert.equal(listSources().length, 1);

  resetRegistry();
});

test('source registry rejects an invalid descriptor', () => {
  resetRegistry();

  assert.throws(
    () => registerSource({
      code: 'Invalid Code',
      title: 'Invalid',
      ready: false,
    }),
    SourceError,
  );

  resetRegistry();
});

test('import source follows the selected posts', () => {
  resetRegistry();

  registerSource({
    code: 'fixture-a',
    title: 'Fixture A',
    ready: false,
  });

  registerSource({
    code: 'fixture-b',
    title: 'Fixture B',
    ready: false,
  });

  const source = getSourceForPosts(
    [{ source: 'fixture-a' }],
    'fixture-b',
  );

  assert.equal(source.code, 'fixture-a');

  resetRegistry();
});

test('import source falls back for legacy posts', () => {
  resetRegistry();

  registerSource({
    code: 'fixture',
    title: 'Fixture',
    ready: false,
  });

  const source = getSourceForPosts(
    [{ postId: 'legacy-post' }],
    'fixture',
  );

  assert.equal(source.code, 'fixture');

  resetRegistry();
});

test('mixed import sources are rejected', () => {
  resetRegistry();

  registerSource({
    code: 'fixture-a',
    title: 'Fixture A',
    ready: false,
  });

  registerSource({
    code: 'fixture-b',
    title: 'Fixture B',
    ready: false,
  });

  assert.throws(
    () => getSourceForPosts(
      [
        { source: 'fixture-a' },
        { source: 'fixture-b' },
      ],
      'fixture-a',
    ),
    (error) => {
      assert.equal(error.code, 'MIXED_SOURCES');
      return true;
    },
  );

  resetRegistry();
});
