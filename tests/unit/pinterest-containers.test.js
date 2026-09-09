import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizePinterestBoard,
  normalizePinterestSection,
  pinterestCookieExportArgs,
  unwrapPinterestBoard,
} from '../../js/sources/pinterest-containers.js';

test('Pinterest normalizes a board container', () => {
  const board =
    normalizePinterestBoard(
      {
        id: 'board-123',
        name: 'References',
        url: '/designer/references/',
        pin_count: 42,
        section_count: 2,
      },
      'designer',
      1,
    );

  assert.deepEqual(result, {
    id: 'board-123',
    name: 'References',
    type: 'BOARD',
    parentId: '',
    slug: 'references',
    url:
      'https://www.pinterest.com/designer/references/',
    pinCount: 42,
    mediaCount: 42,
    sectionCount: 2,
    position: 1,
  });
});

test('Pinterest normalizes a nested section', () => {
  const section =
    normalizePinterestSection(
      {
        id: 'section-456',
        title: 'Architecture',
        slug: 'architecture',
        pin_count: 15,
      },
      {
        id: 'board-123',
        name: 'References',
        slug: 'references',
        url:
          'https://www.pinterest.com/designer/references/',
      },
      1,
    );

  assert.deepEqual(section, {
    id: 'section-456',
    name: 'Architecture',
    type: 'SECTION',
    parentId: 'board-123',
    parentName: 'References',
    boardUrl:
      'https://www.pinterest.com/designer/references/',
    boardSlug: 'references',
    slug: 'architecture',
    url:
      'https://www.pinterest.com/designer/references/id:section-456/',
    pinCount: 15,
    position: 1,
  });
});

test('sections with the same name keep different IDs', () => {
  const first =
    normalizePinterestSection(
      {
        id: 'section-a',
        title: 'Ideas',
      },
      {
        id: 'board-a',
        name: 'Board A',
        url:
          'https://www.pinterest.com/designer/board-a/',
      },
      1,
    );

  const second =
    normalizePinterestSection(
      {
        id: 'section-b',
        title: 'Ideas',
      },
      {
        id: 'board-b',
        name: 'Board B',
        url:
          'https://www.pinterest.com/designer/board-b/',
      },
      1,
    );

  assert.notEqual(first.id, second.id);
  assert.notEqual(first.parentId, second.parentId);
  assert.equal(first.name, second.name);
});

test('Pinterest exports cookies from selected browser profile', () => {
  const args =
    pinterestCookieExportArgs({
      username: '@designer',
      browserCookieSpec:
        'chrome:Profile 2',
      cookieFile:
        '/tmp/pinterest-cookies.txt',
    });

  assert.deepEqual(args, [
    '--cookies-from-browser',
    'chrome:Profile 2',
    '--cookies-export',
    '/tmp/pinterest-cookies.txt',
    '--simulate',
    '--range',
    '1',
    'https://www.pinterest.com/designer/pins/',
  ]);
});

test('Pinterest unwraps a board response', () => {
  const wrapped = {
    board: {
      id: 'real-board-id',
      name: 'References',
      url: '/designer/references/',
      section_count: 2,
    },
  };

  assert.equal(
    unwrapPinterestBoard(wrapped).id,
    'real-board-id',
  );

  const board =
    normalizePinterestBoard(
      wrapped,
      'designer',
      1,
    );

  assert.equal(
    board.id,
    'real-board-id',
  );

  assert.equal(
    board.name,
    'References',
  );

  assert.notEqual(
    board.name,
    '[object Object]',
  );
});

test('Pinterest ignores object values as text', () => {
  const board =
    normalizePinterestBoard(
      {
        id: 'board-123',
        name: {
          translated: 'Wrong shape',
        },
        title: 'Correct title',
        url: '/designer/references/',
      },
      'designer',
      1,
    );

  assert.equal(
    board.name,
    'Correct title',
  );

  assert.equal(
    board.id,
    'board-123',
  );
});
