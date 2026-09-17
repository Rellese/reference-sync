import test from 'node:test';
import assert from 'node:assert/strict';
import { L, joinText, translate, normalizeLanguage, setLanguage, getLanguage } from '../../js/i18n.js';
import { messages } from '../../js/locales/messages.js';

test('every catalog entry has all four translations and preserves parameter slots', () => {
  const keys = new Set();
  for (const row of messages) {
    assert.equal(row.length, 5, row[0]);
    assert.equal(keys.has(row[0]), false, `Duplicate: ${row[0]}`); keys.add(row[0]);
    const slots = text => [...new Set(text.match(/\{\d+\}/g) || [])].sort();
    for (const value of row.slice(1)) {
      assert.ok(typeof value === 'string' && value.trim(), row[0]);
      assert.deepEqual(slots(value), slots(row[0]), row[0]);
    }
  }
});
test('dynamic messages preserve user-supplied values verbatim', () => {
  assert.equal(translate('Найдено: 123', 'en'), 'Found: 123');
  assert.equal(translate('Коллекция: Описание', 'en'), 'Collection: Описание');
  assert.equal(translate(joinText('Описание', '. ', L('Готов к работе')), 'en'), 'Описание. Ready');
  assert.equal(translate('Найденные публикации — 3 из 10', 'fr'), 'Publications trouvées — 3 sur 10');
});
test('language normalization supports current and previously saved language codes', () => {
  for (const [value, expected] of [['EN', 'en'], ['РУ', 'ru'], ['中文', 'zh'], ['invalid', 'ru']]) {
    assert.equal(normalizeLanguage(value), expected);
  }
  setLanguage('ES'); assert.equal(getLanguage(), 'es');
  assert.equal(translate('Готов к работе'), 'Listo');
  setLanguage('ru'); assert.equal(translate('Готов к работе'), 'Готов к работе');
});
