import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseStopLink,
  sameStopPublication,
  stopLinkPlaceholder,
} from '../../js/stop-link.js';

test('распознаёт Instagram publication URL', () => {
  const result = parseStopLink(
    'https://www.instagram.com/p/ABC_123/',
    'instagram',
  );

  assert.equal(result.ok, true);
  assert.equal(result.sourceCode, 'instagram');
  assert.equal(result.publicationId, 'ABC_123');
});

test('распознаёт Instagram Reel URL', () => {
  const result = parseStopLink(
    'https://instagram.com/reel/REEL-123/?utm_source=test',
    'instagram',
  );

  assert.equal(result.ok, true);
  assert.equal(result.publicationId, 'REEL-123');
});

test('принимает региональный поддомен Pinterest', () => {
  const url = 'https://ru.pinterest.com/pin/123456789/';

  const result = parseStopLink(
    url,
    'pinterest',
  );

  assert.equal(result.ok, true);
  assert.equal(result.sourceCode, 'pinterest');
  assert.equal(result.publicationId, '123456789');

  // Исходный домен пользователя не изменяется.
  assert.equal(result.url, url);
});

test('не учитывает query и hash Pinterest URL', () => {
  const result = parseStopLink(
    'https://www.pinterest.com/pin/123456789/?utm_source=test#details',
    'pinterest',
  );

  assert.equal(result.ok, true);
  assert.equal(result.publicationId, '123456789');
});

test('распознаёт Dribbble URL со slug', () => {
  const result = parseStopLink(
    'https://dribbble.com/shots/12345678-Example-shot',
    'dribbble',
  );

  assert.equal(result.ok, true);
  assert.equal(result.publicationId, '12345678');
});

test('распознаёт Behance project URL', () => {
  const result = parseStopLink(
    'https://www.behance.net/gallery/123456789/Project-name',
    'behance',
  );

  assert.equal(result.ok, true);
  assert.equal(result.publicationId, '123456789');
});

test('распознаёт Vimeo video URL', () => {
  const result = parseStopLink(
    'https://vimeo.com/channels/staffpicks/123456789',
    'vimeo',
  );

  assert.equal(result.ok, true);
  assert.equal(result.publicationId, '123456789');
});

test('распознаёт ссылки x.com и twitter.com как одну публикацию', () => {
  const xResult = parseStopLink(
    'https://x.com/example/status/123456789',
    'x',
  );

  const twitterResult = parseStopLink(
    'https://twitter.com/example/status/123456789',
    'x',
  );

  assert.equal(xResult.ok, true);
  assert.equal(twitterResult.ok, true);
  assert.equal(
    sameStopPublication(xResult, twitterResult),
    true,
  );
});

test('отклоняет ссылку другой социальной сети', () => {
  const result = parseStopLink(
    'https://ru.pinterest.com/pin/123456789/',
    'instagram',
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'source_mismatch');
});

test('отклоняет ссылку не на публикацию', () => {
  const result = parseStopLink(
    'https://www.pinterest.com/example/',
    'pinterest',
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_publication_url');
});

test('отклоняет неполную ссылку', () => {
  const result = parseStopLink(
    'www.pinterest.com/pin/123456789/',
    'pinterest',
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_url');
});

test('возвращает placeholder выбранной соцсети', () => {
  assert.equal(
    stopLinkPlaceholder('pinterest'),
    'https://www.pinterest.com/pin/',
  );

  assert.equal(
    stopLinkPlaceholder('instagram'),
    'https://www.instagram.com/p/',
  );
});
