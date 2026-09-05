import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FALLBACK_COLLECTION_ID,
  FALLBACK_COLLECTION_NAME,
  normalizeCollectionKey,
  groupPostsByCollection,
  collectionSelectionState,
  collectionSelectionChanges,
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
  'один postId не клонируется',
  () => {
    const groups =
      groupPostsByCollection(
        [
          {
            postId: 'same',
            collectionId: 'a',
          },
          {
            postId: 'same',
            collectionId: 'b',
          },
        ],
        [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        true,
      );

    const rendered =
      groups.flatMap(
        (group) => group.posts,
      );

    assert.equal(rendered.length, 1);
    assert.equal(
      rendered[0].postId,
      'same',
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
