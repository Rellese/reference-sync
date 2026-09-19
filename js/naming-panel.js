import { L, setLocalizedProperty } from './i18n.js';
import { el, clear, createSwitch, createSelect, createField, createSpinner, createRadioGroup, createInfo } from './ui.js';
import { state, setSetting, numberingCounters } from './state.js';

const destinations = [
  { value: 'name', label: L('Название') }, { value: 'description', label: L('Описание') },
  { value: 'both', label: L('Название и описание') },
];
const modes = [
  { value: 'global', label: L('Общий номер публикации') },
  { value: 'carousel', label: L('Номер элемента карусели') },
  { value: 'batch', label: L('Номер в текущей загрузке') },
  { value: 'author', label: L('Номер публикации автора') },
  { value: 'type', label: L('Номер публикации этого типа') },
  { value: 'none', label: L('Не использовать') },
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
    box.append(el('div', 'rs-naming__label', L(label)), node);
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
    body.appendChild(el('div', 'rs-naming__title', L('3. Нумерация и описание')));
    const columns = el('div', 'rs-naming__columns');
    body.appendChild(columns);
    for (const kind of ['counters', 'descriptions']) {
      const isCounter = kind === 'counters';
      const enabledKey = isCounter ? 'numberingEnabled' : 'descriptionEnabled';
      const section = el('div', 'rs-naming__section');
      const grid = el('div', 'rs-naming__cards');
      const toggle = createSwitch({ checked: s[enabledKey], label: L(isCounter ? 'Использовать нумерацию' : 'Добавить описание'),
        onChange: value => { setSetting(enabledKey, value); grid.hidden = !value; onChange?.(); } });
      const head = toggle.row;
      head.append(createInfo(L(isCounter
        ? '**Каждый счётчик независим.** «С начала» считает от верхней публикации, «С конца» — от нижней. Результат виден в таблице до импорта.'
        : '**Несколько текстов** можно добавить в имя, описание или оба поля, до или после исходного текста.')).node);
      section.append(head, grid);
      grid.hidden = !s[enabledKey];
      const items = isCounter ? countersOf(s) : descriptionsOf(s);
      items.forEach((item, index) => {
        const card = el('div', 'rs-naming__card');
        const ordinal = ['Первое', 'Второе', 'Третье'][index];
        const title = el('div', 'rs-naming__card-title', L(ordinal ? `${ordinal} ${isCounter ? 'число' : 'описание'}` : `${isCounter ? 'Число' : 'Описание'} ${index + 1}`));
        const remove = el('button', 'rs-naming__remove', '×');
        setLocalizedProperty(remove, 'title', L(isCounter ? 'Удалить счётчик' : 'Удалить описание'));
        setLocalizedProperty(remove, 'ariaLabel', L(isCounter ? 'Удалить счётчик' : 'Удалить описание'));
        remove.addEventListener('click', () => mutate(kind, index));
        title.appendChild(remove); card.appendChild(title);
        const change = patch => update(kind, index, patch);
        const optionsRow = el('div', 'rs-naming__options');
        optionsRow.appendChild(cell('Добавлять в:', select(destinations, item.destination, value => change({ destination: value }))));
        const direction = createRadioGroup(isCounter
          ? [{ value: 'start', label: L('С начала') }, { value: 'end', label: L('С конца') }]
          : [{ value: 'start', label: L('Начало списка') }, { value: 'end', label: L('Конец списка') }],
        { value: isCounter ? item.direction : item.placement,
          onChange: value => change({ [isCounter ? 'direction' : 'placement']: value }) });
        const radios = el('div', 'rs-filter-row');
        radios.append(direction.rowOf('start'), direction.rowOf('end'));
        optionsRow.appendChild(cell(isCounter ? 'Нумерация' : 'Куда добавлять?', radios));
        card.appendChild(optionsRow);
        if (isCounter) {
          card.appendChild(cell('Тип нумерации:', select(modes, item.mode, value => change({ mode: value }))));
          const spinner = createSpinner({ value: item.start, min: 1, onChange: value => change({ start: value }) });
          spinner.node.style.width = '100%';
          card.appendChild(cell('Начальная цифра нумерации:', spinner.node));
          card.appendChild(cell('Текст перед номером:', createField({ value: item.marker, onCommit: value => change({ marker: value }) }).node));
        } else {
          const text = createField({ value: item.text || '', placeholder: L('Необязательный текст для выбранных публикаций'), onCommit: value => change({ text: value }) });
          text.input.classList.add('rs-naming__text');
          card.appendChild(cell('Дополнительное описание:', text.node));
        }
        grid.appendChild(card);
      });
      const add = el('button', 'rs-naming__add', L(isCounter ? '+ Добавить ещё счётчик' : '+ Добавить ещё описание'));
      add.addEventListener('click', () => mutate(kind, null));
      grid.appendChild(add);
      columns.appendChild(section);
    }
  }
  render(state.settings);
  return { node: root, sync: (settings = state.settings) => render(settings) };
}
