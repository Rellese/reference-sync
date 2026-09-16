import { el, clear, createSwitch, createSelect, createField, createSpinner, createRadioGroup, createInfo } from './ui.js';
import { state, setSetting, numberingCounters } from './state.js';

const destinations = [
  { value: 'name', label: 'Название' }, { value: 'description', label: 'Описание' },
  { value: 'both', label: 'Название и описание' },
];
const modes = [
  { value: 'global', label: 'Общий номер публикации' },
  { value: 'carousel', label: 'Номер элемента карусели' },
  { value: 'batch', label: 'Номер в текущей загрузке' },
  { value: 'author', label: 'Номер публикации автора' },
  { value: 'type', label: 'Номер публикации этого типа' },
  { value: 'none', label: 'Не использовать' },
];
const countersOf = s => numberingCounters(s).map((counter, index) => ({
  destination: s.numberingDestination, marker: index === 0 ? s.numberingMarker : '',
  direction: 'end', ...counter, independent: true,
}));
const descriptionsOf = s => Array.isArray(s.descriptions) ? s.descriptions : [{
  id: 'description-1', text: s.extraDescription, destination: s.descriptionDestination, placement: s.descriptionPlacement,
}];

export function buildNaming({ onChange } = {}) {
  const root = el('div', 'rs-naming');
  const body = el('div', 'rs-naming__body rs-scroll');
  root.appendChild(body);
  let selects = [];
  const cell = (label, node) => {
    const box = el('div', 'rs-naming__cell');
    box.append(el('div', 'rs-naming__label', label), node);
    return box;
  };
  function select(options, value, onChange) {
    const control = createSelect({ options, value, onChange });
    selects.push(control);
    return control.node;
  }
  function update(key, index, patch) {
    const items = key === 'counters' ? countersOf(state.settings) : descriptionsOf(state.settings);
    setSetting(key, items.map((item, i) => i === index ? { ...item, ...patch } : item));
    onChange?.();
  }
  function mutate(key, index) {
    const items = key === 'counters' ? countersOf(state.settings) : descriptionsOf(state.settings);
    if (index !== null) items.splice(index, 1);
    else items.push(key === 'counters'
      ? { id: `counter-${crypto.randomUUID()}`, independent: true, mode: 'batch', start: 1, direction: 'end', destination: 'name', marker: '' }
      : { id: `description-${crypto.randomUUID()}`, text: '', destination: 'description', placement: 'end' });
    setSetting(key, items);
    render(state.settings);
    onChange?.();
  }
  function render(s) {
    selects.forEach(control => control.dispose()); selects = [];
    clear(body);
    body.appendChild(el('div', 'rs-naming__title', 'Нумерация и описание'));
    for (const kind of ['counters', 'descriptions']) {
      const isCounter = kind === 'counters';
      const enabledKey = isCounter ? 'numberingEnabled' : 'descriptionEnabled';
      const section = el('div', 'rs-naming__section');
      const grid = el('div', 'rs-naming__cards');
      const toggle = createSwitch({ checked: s[enabledKey], label: isCounter ? 'Использовать нумерацию' : 'Добавить описание',
        onChange: value => { setSetting(enabledKey, value); grid.hidden = !value; onChange?.(); } });
      const head = toggle.row;
      head.append(el('span', 'rs-switch-row__gap'), createInfo(isCounter
        ? '**Каждый счётчик независим.** «С начала» считает от верхней публикации, «С конца» — от нижней. Результат виден в таблице до импорта.'
        : '**Несколько текстов** можно добавить в имя, описание или оба поля, до или после исходного текста.').node);
      section.append(head, grid);
      grid.hidden = !s[enabledKey];
      const items = isCounter ? countersOf(s) : descriptionsOf(s);
      items.forEach((item, index) => {
        const card = el('div', 'rs-naming__card');
        const title = el('div', 'rs-naming__card-title', `${isCounter ? 'Счётчик' : 'Описание'} ${index + 1}`);
        const remove = el('button', 'rs-naming__remove', '×');
        remove.title = isCounter ? 'Удалить счётчик' : 'Удалить описание';
        remove.setAttribute('aria-label', remove.title);
        remove.addEventListener('click', () => mutate(kind, index));
        title.appendChild(remove); card.appendChild(title);
        const change = patch => update(kind, index, patch);
        card.appendChild(cell('Добавлять в:', select(destinations, item.destination, value => change({ destination: value }))));
        const direction = createRadioGroup(isCounter
          ? [{ value: 'start', label: 'С начала' }, { value: 'end', label: 'С конца' }]
          : [{ value: 'start', label: 'В начало' }, { value: 'end', label: 'В конец' }],
        { value: isCounter ? item.direction : item.placement,
          onChange: value => change({ [isCounter ? 'direction' : 'placement']: value }) });
        const radios = el('div', 'rs-filter-row');
        radios.append(direction.rowOf('start'), direction.rowOf('end'));
        card.appendChild(cell(isCounter ? 'Нумерация:' : 'Расположение текста:', radios));
        if (isCounter) {
          card.appendChild(cell('Тип нумерации:', select(modes, item.mode, value => change({ mode: value }))));
          card.appendChild(cell('Начальная цифра нумерации:', createSpinner({ value: item.start, min: 1, width: 110, onChange: value => change({ start: value }) }).node));
          card.appendChild(cell('Текст перед номером:', createField({ value: item.marker, onCommit: value => change({ marker: value }) }).node));
        } else {
          const text = el('textarea', 'rs-naming__text');
          text.value = item.text || '';
          text.placeholder = 'Необязательный текст для выбранных публикаций';
          text.addEventListener('change', () => change({ text: text.value }));
          card.appendChild(cell('Текст:', text));
        }
        grid.appendChild(card);
      });
      const add = el('button', 'rs-naming__add', isCounter ? '+ Добавить счётчик' : '+ Добавить описание');
      add.addEventListener('click', () => mutate(kind, null));
      grid.appendChild(add);
      body.appendChild(section);
    }
  }
  render(state.settings);
  return { node: root, sync: (settings = state.settings) => render(settings) };
}
