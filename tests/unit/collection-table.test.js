import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FALLBACK_COLLECTION_ID,
  FALLBACK_COLLECTION_NAME,
  normalizeCollectionKey,
  groupPostsByCollection,
  collectionSelectionState,
  collectionSelectionChanges,
  ensureDefaultOccurrences,
  occurrenceSelected,
  selectOccurrence,
} from '../../js/collection-table.js';

test(
  'normalizeCollectionKey возвращает ID коллекции',
  () => {
    assert.equal(
      normalizeCollectionKey({
        collectionId: 'collection-1',
      }),
      'collection-1',
    );
  },
);

test(
  'normalizeCollectionKey поддерживает старые публикации',
  () => {
    assert.equal(
      normalizeCollectionKey({
        postId: 'post-1',
      }),
      FALLBACK_COLLECTION_ID,
    );
  },
);

test(
  'плоский режим не группирует публикации',
  () => {
    const posts = [
      { postId: '1' },
      { postId: '2' },
    ];

    const groups =
      groupPostsByCollection(
        posts,
        [],
        false,
      );

    assert.equal(groups.length, 1);
    assert.equal(groups[0].flat, true);
    assert.deepEqual(
      groups[0].posts,
      posts,
    );
  },
);

test(
  'группы следуют порядку выбранных коллекций',
  () => {
    const posts = [
      {
        postId: 'post-b',
        collectionId: 'b',
        collectionName: 'Вторая',
      },
      {
        postId: 'post-a',
        collectionId: 'a',
        collectionName: 'Первая',
      },
    ];

    const groups =
      groupPostsByCollection(
        posts,
        [
          { id: 'a', name: 'Первая' },
          { id: 'b', name: 'Вторая' },
        ],
        true,
      );

    assert.deepEqual(
      groups.map((group) => group.id),
      ['a', 'b'],
    );

    assert.deepEqual(
      groups.map((group) =>
        group.posts[0].postId),
      ['post-a', 'post-b'],
    );
  },
);

test(
  'порядок публикаций внутри коллекции сохраняется',
  () => {
    const posts = [
      {
        postId: '3',
        collectionId: 'a',
      },
      {
        postId: '1',
        collectionId: 'a',
      },
      {
        postId: '2',
        collectionId: 'a',
      },
    ];

    const [group] =
      groupPostsByCollection(
        posts,
        [{ id: 'a', name: 'Папка' }],
        true,
      );

    assert.deepEqual(
      group.posts.map((post) =>
        post.postId),
      ['3', '1', '2'],
    );
  },
);

test(
  'публикации без коллекции получают fallback-группу',
  () => {
    const [group] =
      groupPostsByCollection(
        [{ postId: 'post-1' }],
        [],
        true,
      );

    assert.equal(
      group.id,
      FALLBACK_COLLECTION_ID,
    );

    assert.equal(
      group.name,
      FALLBACK_COLLECTION_NAME,
    );
  },
);

test(
  'один postId отображается во всех коллекциях',
  () => {
    const sharedPost = {
      postId: 'same',

      collectionId: 'a',
      collectionName: 'A',

      collectionOccurrences: [
        {
          collectionId: 'a',
          collectionName: 'A',
        },
        {
          collectionId: 'b',
          collectionName: 'B',
        },
      ],
    };

    const groups =
      groupPostsByCollection(
        [sharedPost],
        [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        true,
      );

    assert.deepEqual(
      groups.map((group) => group.id),
      ['a', 'b'],
    );

    assert.equal(
      groups[0].posts.length,
      1,
    );

    assert.equal(
      groups[1].posts.length,
      1,
    );

    /*
     * Обе строки ссылаются на один объект:
     * выбор публикации остаётся синхронным.
     */
    assert.equal(
      groups[0].posts[0],
      sharedPost,
    );

    assert.equal(
      groups[1].posts[0],
      sharedPost,
    );
  },
);

test(
  'collectionSelectionState: ничего не выбрано',
  () => {
    assert.deepEqual(
      collectionSelectionState(
        [
          { postId: '1' },
          { postId: '2' },
        ],
        new Set(),
      ),
      {
        total: 2,
        selectedCount: 0,
        checked: false,
        mixed: false,
        disabled: false,
      },
    );
  },
);

test(
  'collectionSelectionState: выбрана часть',
  () => {
    const result =
      collectionSelectionState(
        [
          { postId: '1' },
          { postId: '2' },
        ],
        new Set(['1']),
      );

    assert.equal(result.checked, false);
    assert.equal(result.mixed, true);
  },
);

test(
  'collectionSelectionState: выбраны все',
  () => {
    const result =
      collectionSelectionState(
        [
          { postId: '1' },
          { postId: '2' },
        ],
        new Set(['1', '2']),
      );

    assert.equal(result.checked, true);
    assert.equal(result.mixed, false);
  },
);

test(
  'collectionSelectionChanges выбирает всю коллекцию',
  () => {
    const changes =
      collectionSelectionChanges(
        [
          { postId: '1' },
          { postId: '2' },
        ],
        new Set(['1']),
      );

    assert.deepEqual(
      changes.map((change) => ({
        postId: change.postId,
        selected:
          change.after.selected,
      })),
      [{
        postId: '2',
        selected: true,
      }],
    );
  },
);

test(
  'collectionSelectionChanges снимает полностью выбранную коллекцию',
  () => {
    const changes =
      collectionSelectionChanges(
        [
          { postId: '1' },
          { postId: '2' },
        ],
        new Set(['1', '2']),
      );

    assert.deepEqual(
      changes.map((change) => ({
        postId: change.postId,
        selected:
          change.after.selected,
      })),
      [
        {
          postId: '1',
          selected: false,
        },
        {
          postId: '2',
          selected: false,
        },
      ],
    );
  },
);

test(
  'one post is rendered in every collection occurrence',
  () => {
    const sharedPost = {
      postId: 'post-shared',
      collectionId: 'folder-a',
      collectionName: 'Folder A',

      collectionOccurrences: [
        {
          occurrenceId:
            'folder-a:post-shared',

          collectionId:
            'folder-a',

          collectionName:
            'Folder A',

          isDuplicate:
            false,
        },
        {
          occurrenceId:
            'folder-b:post-shared',

          collectionId:
            'folder-b',

          collectionName:
            'Folder B',

          isDuplicate:
            true,
        },
      ],
    };

    const groups =
      groupPostsByCollection(
        [sharedPost],
        [
          {
            id: 'folder-a',
            name: 'Folder A',
          },
          {
            id: 'folder-b',
            name: 'Folder B',
          },
        ],
        true,
      );

    assert.equal(groups.length, 2);

    assert.equal(
      groups[0].posts.length,
      1,
    );

    assert.equal(
      groups[1].posts.length,
      1,
    );

    assert.equal(
      groups[0].posts[0],
      sharedPost,
    );

    assert.equal(
      groups[1].posts[0],
      sharedPost,
    );
  },
);

test(
  'folder mode excludes occurrences from unselected collections',
  () => {
    const groups =
      groupPostsByCollection(
        [{
          postId: 'post-001',

          collectionOccurrences: [
            {
              collectionId: 'selected',
              collectionName: 'Selected',
            },
            {
              collectionId: 'not-selected',
              collectionName: 'Not selected',
            },
          ],
        }],
        [{
          id: 'selected',
          name: 'Selected',
        }],
        true,
      );

    assert.deepEqual(
      groups.map((group) => group.id),
      ['selected'],
    );

    assert.deepEqual(
      groups[0].posts.map(
        (post) => post.postId,
      ),
      ['post-001'],
    );
  },
);

test(
  'duplicate occurrences inside one collection create one row',
  () => {
    const groups =
      groupPostsByCollection(
        [{
          postId: 'post-001',

          collectionOccurrences: [
            {
              collectionId: 'folder-a',
              collectionName: 'Folder A',
            },
            {
              collectionId: 'folder-a',
              collectionName: 'Folder A',
            },
          ],
        }],
        [{
          id: 'folder-a',
          name: 'Folder A',
        }],
        true,
      );

    assert.equal(groups.length, 1);
    assert.equal(groups[0].posts.length, 1);
  },
);

test(
  'collection selection changes contain unique post ids',
  () => {
    const post = {
      postId: 'post-001',
      selectedComponents: [1],
    };

    const changes =
      collectionSelectionChanges(
        [post, post],
        new Set(),
      );

    assert.equal(changes.length, 1);
    assert.equal(
      changes[0].postId,
      'post-001',
    );

    assert.equal(
      changes[0].after.selected,
      true,
    );
  },
);

test(
  'лимит сохраняет результаты каждой папки',
  () => {
    const posts = [];

    for (let index = 1; index <= 10; index += 1) {
      posts.push({
        postId: `main-${index}`,

        collectionOccurrences: [{
          occurrenceId:
            `main:main-${index}`,

          collectionId: 'main',
          collectionName: 'Main',
          isDuplicate: false,
        }],
      });
    }

    posts.push({
      postId: 'folder-a-1',

      collectionOccurrences: [{
        occurrenceId:
          'folder-a:folder-a-1',

        collectionId: 'folder-a',
        collectionName: 'Folder A',
        isDuplicate: false,
      }],
    });

    for (let index = 1; index <= 2; index += 1) {
      posts.push({
        postId: `folder-b-${index}`,

        collectionOccurrences: [{
          occurrenceId:
            `folder-b:folder-b-${index}`,

          collectionId: 'folder-b',
          collectionName: 'Folder B',
          isDuplicate: false,
        }],
      });
    }

    const groups =
      groupPostsByCollection(
        posts,
        [
          { id: 'main', name: 'Main' },
          {
            id: 'folder-a',
            name: 'Folder A',
          },
          {
            id: 'folder-b',
            name: 'Folder B',
          },
        ],
        true,
      );

    assert.deepEqual(
      groups.map(
        (group) =>
          group.posts.length,
      ),
      [10, 1, 2],
    );

    assert.equal(
      groups.reduce(
        (total, group) =>
          total + group.posts.length,
        0,
      ),
      13,
    );
  },
);

test(
  'по умолчанию выбирается первая копия после оригинала',
  () => {
    const post = {
      postId: 'shared',

      collectionOccurrences: [
        {
          occurrenceId: 'saved:shared',
          collectionId: 'saved',
          collectionName: 'Saved',
          isDuplicate: false,
        },
        {
          occurrenceId: 'a:shared',
          collectionId: 'a',
          collectionName: 'A',
          isDuplicate: true,
        },
        {
          occurrenceId: 'b:shared',
          collectionId: 'b',
          collectionName: 'B',
          isDuplicate: true,
        },
      ],
    };

    const occurrences =
      ensureDefaultOccurrences(
        [post],
        new Set(['shared']),
        new Map(),
      );

    assert.equal(
      occurrences.get('shared'),
      'a:shared',
    );
  },
);

test(
  'ручной выбор переносит checkbox между дубликатами',
  () => {
    const selected =
      new Set(['shared']);

    const occurrences =
      new Map([
        ['shared', 'a:shared'],
      ]);

    const result =
      selectOccurrence({
        row: {
          postId: 'shared',
          occurrenceId: 'b:shared',
        },

        selectedPostIds:
          selected,

        selectedOccurrences:
          occurrences,

        selected:
          true,
      });

    assert.equal(
      result.selectedPostIds.has(
        'shared',
      ),
      true,
    );

    assert.equal(
      result.selectedOccurrences.get(
        'shared',
      ),
      'b:shared',
    );

    assert.equal(
      occurrenceSelected(
        {
          postId: 'shared',
          occurrenceId: 'a:shared',
        },
        result.selectedPostIds,
        result.selectedOccurrences,
      ),
      false,
    );

    assert.equal(
      occurrenceSelected(
        {
          postId: 'shared',
          occurrenceId: 'b:shared',
        },
        result.selectedPostIds,
        result.selectedOccurrences,
      ),
      true,
    );
  },
);

test(
  'выбор папки не переносит уже выбранный дубликат',
  () => {
    const rows = [
      {
        postId: 'already-selected',
        occurrenceId:
          'folder-b:already-selected',
        collectionId: 'folder-b',
      },
      {
        postId: 'new-post',
        occurrenceId:
          'folder-b:new-post',
        collectionId: 'folder-b',
      },
    ];

    const changes =
      collectionSelectionChanges(
        rows,

        new Set([
          'already-selected',
        ]),

        new Map([
          [
            'already-selected',
            'folder-a:already-selected',
          ],
        ]),
      );

    assert.deepEqual(
      changes.map(
        (change) =>
          change.postId,
      ),
      ['new-post'],
    );

    assert.equal(
      changes[0].after.occurrenceId,
      'folder-b:new-post',
    );
  },
);
