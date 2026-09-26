import { translate, joinText, L, setText, setUiText, setLocalizedProperty, bindTextRender, normalizeLanguage, getLanguage } from './i18n.js';
import { createArchivePicker } from './archive-panel.js';
import { attachThumbnail } from './thumbnail.js';
/* ============================================================
   ReferenceSync — сборка панелей интерфейса
   Соответствие блокам Figma:
     buildTitlebar  → «Кнопка верхнего меню»
     buildHeader    → «1 блок»
     buildSocial    → «2 блок»
     buildSettings  → «3 блок 1-2 шаг»
     buildStatus    → «4 блок»
     buildResults   → «5 блок»
     buildNaming    → «6 блок»
     buildFooter    → Simple button + Search button
   ============================================================ */

import {
  el, clear,
  createSwitch, createCheckbox, createRadioGroup, createInfo,
  createField, createSelect, createSpinner, createGlassButton,
  createSocialButton, createButton, createGhostButton, createEditButton,
  createLabelWithInfo,
} from './ui.js';

import {
  state,
  setSetting,
  formatAuthorFilterValue,
  normalizeAuthorFilterValue,
} from './state.js';
import { SEARCH_MODES } from './instagram.js';
import { discoverInstalledBrowsers } from './browser-installations.js';
import { parseStopLink, stopLinkPlaceholder } from './stop-link.js';
import {
  normalizeSelection,
  selectAll,
  clearSelection,
  imagesOnly,
  videosOnly,
  componentDisplay,
} from './carousel-selection.js';
import {
  checkboxRange,
  applyShiftSelection,
  createCheckboxGestureState,
} from './checkbox-selection.js';
import { createProgressBar } from './progress.js';
import { installSources, listSources } from './sources/index.js';

/* ============================================================
   Тексты подсказок

   Формат: важная часть оборачивается в **звёздочки** и
   выводится оранжевым — так же, как в макете Figma
   (см. Instruction/Подсказка про папки). В каждой
   подсказке выделяется только одна ключевая мысль.
   ============================================================ */
const TIP_FOLDERS =
  'При включении этого режима ReferenceSync сначала даст список доступных ' +
  'досок, коллекций и разделов. **Выберите нужные коллекции и нажмите ' +
  '"Продолжить"**. После этого выбранный режим поиска будет применён только ' +
  'к содержимому отмеченных коллекций. Если режим выключен, поиск ' +
  'выполняется по общему списку всех сохранённых публикаций.';

const TIP_STOP_LINK =
  'При следующем поиске идём от новых публикаций к старым. ' +
  '**Указанная публикация и всё после неё не попадут в результат**. ' +
  'В режиме папок каждая папка останавливается независимо. ' +
  'Лимит N и граница прошлой синхронизации продолжают действовать.';

const TIP_SPEED =
  '**Задержки запросов к соцсети:** безопасная — 2–4 с, сбалансированная — 1–2 с, молния — 0 с. ' +
  'Прямые ссылки на файлы загружаются последовательно. При большом объёме выбирайте безопасную скорость.';

const TIP_ACCOUNT =
  '**Имя владельца сохранённых публикаций**, без @. Оно должно совпадать с аккаунтом выбранной соцсети в профиле браузера.';

const TIP_BROWSER =
  'ReferenceSync читает cookies выбранного браузера. **В нём должен быть ' +
  'выполнен вход в Instagram**. Браузер лучше закрыть перед поиском.';

const TIP_BROWSER_PROFILE =
  'Проверка Instagram будет выполнена перед поиском. ' +
  'Название профиля и почта берутся из настроек браузера. ' +
  'ReferenceSync использует cookies именно этого профиля. ' +
  'Если в браузере открыто несколько аккаунтов, выберите имя или почту, ' +
  'которые указаны в нужном окне Chrome.';

const TIP_NUMBERING =
  'К имени файла добавляется сквозной номер. Он задаёт порядок публикаций ' +
  'в Eagle, поэтому **нумерация продолжается между запусками**.';

const TIP_DESCRIPTION =
  'Описание из публикации переносится в **поле «Аннотация» Eagle**. ' +
  'Дополнительный текст добавляется ко всем выбранным публикациям.';

const TIP_FILTERS =
  'Фильтры применяются **к уже найденному списку**, поэтому их можно ' +
  'менять после поиска без повторного обращения к Instagram.';

const TIP_ENGINE =
  "Модуль загрузки скачивает файлы. По кнопке «Скачать» или «Обновить» плагин установит gallery-dl, yt-dlp и FFmpeg из PyPI в свою папку. Это сторонние программы; терминал не нужен.";

/* Соцсети: instagram и pinterest — рабочие, остальные заготовки */
/* Список соцсетей больше не задаётся здесь: он собирается из
   реестра источников (js/sources/index.js). Добавление новой
   соцсети не требует правок в этом файле. */
installSources();

function platforms() {
  return listSources().map((source) => ({
    id: source.code,
    title: source.title,
    icon: source.icon,
    ready: source.ready,
    notReadyReason: source.notReadyReason,
  }));
}

const LANGUAGES = ['EN', 'FR', 'РУ', '中文', 'ES'];

/* Загруженные SVG иконки: name → разметка */
let iconCache = {};

export async function loadIcons() {
  const names = platforms().map((item) => item.icon);
  await Promise.all(names.map(async (name) => {
    try {
      const response = await fetch(`assets/icons/${name}.svg`);
      iconCache[name] = await response.text();
    } catch (_) {
      iconCache[name] = '';
    }
  }));
}

/* ============================================================
   Кнопка верхнего меню
   ============================================================ */
export function buildTitlebar({ onClose }) {
  const root = el('div', 'rs-titlebar');
  const close = el('div', 'rs-titlebar__dot rs-titlebar__dot--close');
  setLocalizedProperty(close, 'title', L('Закрыть'));
  const min = el('div', 'rs-titlebar__dot rs-titlebar__dot--min');
  setLocalizedProperty(min, 'title', L('Свернуть'));
  const max = el('div', 'rs-titlebar__dot rs-titlebar__dot--max');
  setLocalizedProperty(max, 'title', L('Полный экран'));

  close.addEventListener('click', () => { if (onClose) onClose(); });
  root.append(close, min, max);
  return root;
}

/* ============================================================
   1 блок — шапка
   ============================================================ */
export function buildHeader({ version = 'v1.0.1', onLanguage }) {
  const root = el('div', 'rs-header');

  const left = el('div', 'rs-header__left');
  left.append(
    el('div', 'rs-header__title', 'ReferenceSync'),
    el('div', 'rs-header__subtitle',
      L('Сохраняйте референсы из социальных сетей в Eagle')),
  );

  const right = el('div', 'rs-header__right');
  right.appendChild(el('div', 'rs-header__version', version));

  const lang = el('div', 'rs-lang');
  LANGUAGES.forEach((code) => {
    const item = el('button', 'rs-lang__item', code);
    if (normalizeLanguage(code) === getLanguage()) item.classList.add('is-active');
    item.addEventListener('click', () => {
      lang.querySelectorAll('.rs-lang__item')
        .forEach((node) => node.classList.remove('is-active'));
      item.classList.add('is-active');
      if (onLanguage) onLanguage(code);
    });
    lang.appendChild(item);
  });
  right.appendChild(lang);

  root.append(left, right);
  return root;
}

/* ============================================================
   2 блок — переключатели соцсетей
   ============================================================ */
export function buildSocial({ onSelect }) {
  const root = el('div', 'rs-social');
  const list = el('div', 'rs-social__list');

  const buttons = new Map();
  platforms().forEach((platform) => {
    const button = createSocialButton({
      icon: iconCache[platform.icon],
      title: platform.title,
      active: platform.id === state.settings.platform,
      locked: !platform.ready,
      onClick: () => {
        buttons.forEach((entry, id) => entry.setActive(id === platform.id));
        setText(value, platform.title);
        if (onSelect) onSelect(platform.id);
      },
    });
    buttons.set(platform.id, button);
    list.appendChild(button.node);
  });

  const meta = el('div', 'rs-social__meta');
  const value = el('div', 'rs-social__value',
    platforms().find((p) => p.id === state.settings.platform)?.title || 'Instagram');
  meta.append(el('div', 'rs-social__caption', L('Выбранная соц. сеть')), value);

  root.append(list, meta);
  return root;
}

function formatAuthorFieldInput(field, event) {
  if (
    String(event.inputType || '')
      .startsWith('delete')
  ) {
    return;
  }

  const input = field.input;
  const rawValue = input.value;
  const selectionStart =
    input.selectionStart ?? rawValue.length;

  const formattedValue =
    formatAuthorFilterValue(rawValue);

  if (formattedValue === rawValue) {
    return;
  }

  const formattedSelectionStart =
    formatAuthorFilterValue(
      rawValue.slice(0, selectionStart),
    ).length;

  field.set(formattedValue);

  input.setSelectionRange(
    formattedSelectionStart,
    formattedSelectionStart,
  );
}

/* ============================================================
   3 блок — настройки поиска (шаг 1 и шаг 2)
   ============================================================ */
export function buildSettings({ onChange, onFolderSearch, onArchive, onArchiveResolve }) {
  const root = el('div', 'rs-panel');
  const body = el('div', 'rs-panel__body rs-scroll');

  const s = state.settings;

  /* ---------- Шаг 1: выбор источника ---------- */
  const step1 = el('div', 'rs-step');
  step1.appendChild(
    el(
      'div',
      'rs-step__title',
      L('Шаг 1 — выбор анализа'),
    ),
  );

  const sourceGroup = createRadioGroup([
    { value: 'browser', label: L('Через авторизованный браузер') },
    { value: 'meta', label: L('Из архива') },
  ], {
    value: s.source,
    onChange: (value) => {
      setSetting('source', value);
      browserBlock.style.display = value === 'browser' ? '' : 'none';
      metaHint.style.display = value === 'meta' ? '' : 'none';
      if (onChange) onChange('source', value);
    },
  });

  const sourceList = el('div', 'rs-step__group');
  sourceList.append(
    sourceGroup.rowOf('browser'),
    sourceGroup.rowOf('meta'),
  );
  step1.appendChild(sourceList);

  const archivePicker = createArchivePicker(onArchive, onArchiveResolve);
  const metaHint = archivePicker.node;
  metaHint.style.display = s.source === 'meta' ? '' : 'none';
  step1.appendChild(metaHint);

  /* ---------- Настройки браузера ---------- */
  const browserBlock = el('div', 'rs-step');
  browserBlock.style.display = s.source === 'browser' ? '' : 'none';

  /* Instagram-аккаунт */
  const accountRow = el('div', 'rs-step__row');
  const accountLabel = createLabelWithInfo(L('Instagram-аккаунт'), L(TIP_ACCOUNT)).node;
  const accountField = createField({
    value: s.username,
    placeholder: L('имя пользователя'),
    at: true,
    onCommit: (value) => {
      const clean = value.trim().replace(/^@/, '');
      accountField.set(clean);
      setSetting('username', clean);
      if (onChange) onChange('username', clean);
    },
  });
  accountRow.append(accountLabel, accountField.node);

  /* Браузер */
  const browserRow = el('div', 'rs-step__row');
  const browserLabel = createLabelWithInfo(
    L('Браузер с выполненным входом'), L(TIP_BROWSER)).node;
  const browserSelect = createSelect({
    options: discoverInstalledBrowsers().map(option => ({ ...option, label: L(option.label) })),
    value: s.browser,
    onChange: (value) => {
      setSetting('browser', value);
      setSetting('browserProfile', '');
      if (onChange) onChange('browser', value);
    },
  });
  browserRow.append(browserLabel, browserSelect.node);
    /* Профиль браузера показывается только при нескольких
     найденных аккаунтах. Технические Profile 1 / Profile 6
     используются только как внутренние значения. */
  const profileRow = el('div', 'rs-step__row');
  profileRow.style.display = 'none';

  const profileLabel = createLabelWithInfo(
    L('Профиль браузера'),
    L(TIP_BROWSER_PROFILE),
  );

  const profileSelect = createSelect({
    options: [],
    value: s.browserProfile,
    onChange: (value) => {
      setSetting('browserProfile', value);
      if (onChange) onChange('browserProfile', value);
    },
  });

  profileRow.append(profileLabel.node, profileSelect.node);
  const browserHint = el('div', 'rs-hint',
    L('ReferenceSync использует существующий вход в браузере. ' +
    'Пароль Instagram не запрашивается.'));

  /* Скорость загрузки */
  const speedRow = el('div', 'rs-step__row');
  const speedLabel = createLabelWithInfo(L('Скорость загрузки'), L(TIP_SPEED)).node;
  const speedSelect = createSelect({
    options: [
      { value: 'safe', label: L('Безопасная — медленнее, меньше риск блокировки') },
      { value: 'balanced', label: L('Сбалансированная — немного быстрее') },
      /* Третий режим: без задержек между запросами */
      { value: 'lightning', label: L('Молния — без ограничений') },
    ],
    value: s.speed,
    onChange: (value) => {
      setSetting('speed', value);
      if (onChange) onChange('speed', value);
    },
  });
  speedRow.append(speedLabel, speedSelect.node);

  browserBlock.append(
    accountRow,
    browserRow,
    profileRow,
    browserHint,
    speedRow,
  );

  /* ---------- Шаг 2: тип поиска ---------- */
  const step2 = el('div', 'rs-step');
  step2.appendChild(
    el(
      'div',
      'rs-step__title',
      L('Шаг 2 — тип поиска'),
    ),
  );

  const recentSpinner = createSpinner({
    value: s.recentLimit,
    min: 1,
    onChange: (value) => {
      setSetting('recentLimit', value);
      if (onChange) onChange('recentLimit', value);
    },
  });

  const modeGroup = createRadioGroup([
    { value: SEARCH_MODES.SMART, label: L('Найти только новые') },
    { value: SEARCH_MODES.FULL, label: L('Проверить все сохранённые') },
    { value: SEARCH_MODES.RECENT, label: L('Проверить только последние') },
  ], {
    value: s.searchMode,
    onChange: (value) => {
      setSetting('searchMode', value);
      recentSpinner.setDisabled(value !== SEARCH_MODES.RECENT);
      if (onChange) onChange('searchMode', value);
    },
  });

  const modes = el('div', 'rs-step__group');

  const modeSmart = el('div', 'rs-mode');
  modeSmart.append(
    modeGroup.rowOf(SEARCH_MODES.SMART),
    el('div', 'rs-hint',
      L('Основной режим. Программа идёт от новых публикаций к старым ' +
      'и ищет границу предыдущей синхронизации.')),
  );

  const modeFull = el('div', 'rs-mode');
  modeFull.append(
    modeGroup.rowOf(SEARCH_MODES.FULL),
    el('div', 'rs-hint',
      L('Полный анализ всего раздела Saved без ограничения по количеству. ' +
      'Подходит для первого переноса.')),
  );

  const modeRecent = el('div', 'rs-mode');
  const recentHead = el('div', 'rs-mode__head');
  const recentSpinnerBox = el('div', 'rs-mode__spinner');
  recentSpinnerBox.appendChild(recentSpinner.node);
  recentHead.append(modeGroup.rowOf(SEARCH_MODES.RECENT), recentSpinnerBox);
  modeRecent.append(
    recentHead,
    el('div', 'rs-hint',
      L('Дополнительный режим для быстрой проверки или тестирования.')),
  );
  recentSpinner.setDisabled(s.searchMode !== SEARCH_MODES.RECENT);

  modes.append(modeSmart, modeFull, modeRecent);
  step2.appendChild(modes);

  /* Тумблер «Искать в выбранных папках» */
  const folderSwitch = createSwitch({
    checked: s.folderSearch,
    label: L('Искать в выбранных папках'),
    onChange: (value) => {
      setSetting('folderSearch', value);

      if (!value) {
        state.collections = [];
      }

      if (onChange) {
        onChange(
          'folderSearch',
          value,
        );
      }
    },
  });
  const folderRow = el('div', 'rs-switch-row');
  folderRow.append(
    folderSwitch.node,
    folderSwitch.labelNode,
    el('span', 'rs-switch-row__gap'),
    createInfo(L(TIP_FOLDERS)).node,
  );
  step2.appendChild(folderRow);

  const stopLinkBlock = el('div', 'rs-stop-link');
  const stopLinkFieldRow = el('div', 'rs-stop-link__field-row');
  const stopLinkMessage = el('div', 'rs-stop-link__message');
  stopLinkMessage.id = 'stop-link-message';
  stopLinkMessage.setAttribute('aria-live', 'polite');

  let stopLinkValidationRequested = false;

  function validateStopLink() {
    const parsed = parseStopLink(state.settings.stopLinkUrl, state.settings.platform);
    const invalid = stopLinkValidationRequested && state.settings.stopLinkEnabled && !parsed.ok;
    stopLinkBlock.classList.toggle('has-error', invalid);
    setUiText(stopLinkMessage, invalid ? parsed.message : '');
    stopLinkField.input.setAttribute('aria-invalid', String(invalid));
  }

  const stopLinkField = createField({
    value: s.stopLinkUrl,
    placeholderPrefix: stopLinkPlaceholder(s.platform),
    placeholderSuffix: L('ID публикации'),
    onInput(value) {
      setSetting('stopLinkUrl', value, { record: false });
      validateStopLink();
    },
    onCommit(value) {
      setSetting('stopLinkUrl', value.trim());
      stopLinkField.set(value.trim());
      validateStopLink();
    },
  });
  stopLinkField.input.id = 'stop-link-input';
  setLocalizedProperty(stopLinkField.input, 'ariaLabel', L('Ссылка для остановки поиска'));
  stopLinkField.input.setAttribute('aria-describedby', stopLinkMessage.id);
  const stopLinkSwitch = createSwitch({
    checked: s.stopLinkEnabled,
    label: L('Остановиться по ссылке'),
    onChange(value) {
      stopLinkValidationRequested = false;
      setSetting('stopLinkEnabled', value);
      stopLinkBlock.classList.toggle('is-enabled', value);
      validateStopLink();
      onChange?.('stopLinkEnabled', value);
    },
  });
  const stopLinkSwitchRow = el('div', 'rs-switch-row');
  stopLinkSwitchRow.append(
    stopLinkSwitch.node, stopLinkSwitch.labelNode,
    el('span', 'rs-switch-row__gap'), createInfo(L(TIP_STOP_LINK)).node,
  );
  stopLinkFieldRow.append(stopLinkField.node, stopLinkMessage);
  stopLinkBlock.append(stopLinkSwitchRow, stopLinkFieldRow);
  stopLinkBlock.classList.toggle('is-enabled', s.stopLinkEnabled);
  validateStopLink();
  step2.appendChild(stopLinkBlock);

  /* ---------- Дополнительные фильтры ---------- */
  const step3 = el('div', 'rs-step');

  const filtersBody = el('div', 'rs-step__group');
  filtersBody.style.display = s.extraFilters ? '' : 'none';

  const filterSwitch = createSwitch({
    checked: s.extraFilters,
    label: L('Дополнительные фильтры'),
    onChange: (value) => {
      setSetting('extraFilters', value);
      filtersBody.style.display = value ? '' : 'none';
      if (onChange) onChange('extraFilters', value);
    },
  });
  const filterRow = el('div', 'rs-switch-row');
  filterRow.append(
    filterSwitch.node,
    filterSwitch.labelNode,
    el('span', 'rs-switch-row__gap'),
    createInfo(L(TIP_FILTERS)).node,
  );
  step3.appendChild(filterRow);

  /* Фильтрация файлов */
  step3.appendChild(filtersBody);
  filtersBody.appendChild(el('div', 'rs-step__title', L('Фильтрация файлов')));

  const typeRow = el('div', 'rs-filter-row');
  const typeCheckboxes = new Map();
  [
    ['filterPhoto', 'Фотографии'],
    ['filterVideo', 'Видео'],
    ['filterCarousel', 'Карусели'],
  ].forEach(([key, label]) => {
    const box = createCheckbox({
      checked: s[key],
      label: L(label),
      onChange: (value) => {
        setSetting(key, value);
        if (onChange) onChange(key, value);
      },
    });
    typeCheckboxes.set(key, box);
    typeRow.appendChild(box.row);
  });
  filtersBody.appendChild(typeRow);

  /* Фильтрация авторов */
  filtersBody.appendChild(el('div', 'rs-step__title', L('Фильтрация авторов')));

  const includeRow = el('div', 'rs-step__row');

  const includeField = createField({
    value: normalizeAuthorFilterValue(
      s.authorInclude,
    ),
    placeholder: L('через запятую'),
    at: true,
    onCommit: (value) => {
      const normalized =
        normalizeAuthorFilterValue(value);

        includeField.set(normalized);
      setSetting(
        'authorInclude',
        normalized,
      );

      if (onChange) {
        onChange(
          'authorInclude',
          normalized,
        );
      }
    },
  });

  includeField.input.addEventListener(
    'input',
    (event) => {
      formatAuthorFieldInput(
        includeField,
        event,
      );
    },
  );

  includeRow.append(
    el(
      'div',
      'rs-field-label',
      L('Только эти авторы:'),
    ),
    includeField.node,
  );

  const excludeRow = el('div', 'rs-step__row');

  const excludeField = createField({
    value: normalizeAuthorFilterValue(
      s.authorExclude,
    ),
    placeholder: L('через запятую'),
    at: true,
    onCommit: (value) => {
      const normalized =
        normalizeAuthorFilterValue(value);

      excludeField.set(normalized);
      setSetting(
        'authorExclude',
        normalized,
      );

      if (onChange) {
        onChange(
          'authorExclude',
          normalized,
        );
      }
    },
  });

  excludeField.input.addEventListener(
    'input',
    (event) => {
      formatAuthorFieldInput(
        excludeField,
        event,
      );
    },
  );

  excludeRow.append(
    el(
      'div',
      'rs-field-label',
      L('Исключить авторов:'),
    ),
    excludeField.node,
  );
  filtersBody.append(includeRow, excludeRow);

  body.append(
    step1,
    browserBlock,
    el('div', 'rs-divider'),
    step2,
    el('div', 'rs-divider'),
    step3,
  );
  root.appendChild(body);

  return {
    node: root,
    showStopLinkError() {
      stopLinkValidationRequested = true;
      validateStopLink();
      stopLinkField.input.focus();
      stopLinkFieldRow.scrollIntoView({ block: 'nearest' });
    },
    setArchiveStatus: archivePicker.setStatus,
    sync(nextSettings = state.settings) {
      const next =
        nextSettings || state.settings;

      sourceGroup.set(next.source);
      setUiText(sourceGroup.rowOf('meta').querySelector('.rs-radio-row__label'), 'Из архива');

      browserBlock.style.display =
        next.source === 'browser'
          ? ''
          : 'none';

      metaHint.style.display =
        next.source === 'meta'
          ? ''
          : 'none';

      accountField.set(next.username);
      accountField.node.classList.toggle('has-at', next.platform !== 'behance');
      setLocalizedProperty(accountField.input, 'placeholder', L(next.platform === 'behance' ? 'Ссылка на кейс или коллекцию' : 'имя пользователя'));
      browserSelect.set(next.browser);
      profileSelect.set(next.browserProfile);
      speedSelect.set(next.speed);

      recentSpinner.set(next.recentLimit);
      modeGroup.set(next.searchMode);

      recentSpinner.setDisabled(
        next.searchMode !== SEARCH_MODES.RECENT,
      );

      folderSwitch.set(
        next.folderSearch,
        true,
      );

      stopLinkSwitch.set(next.stopLinkEnabled, true);
      stopLinkField.set(next.stopLinkUrl);
      stopLinkField.setPlaceholderPrefix(stopLinkPlaceholder(next.platform));
      stopLinkBlock.classList.toggle('is-enabled', next.stopLinkEnabled);
      validateStopLink();

      filterSwitch.set(
        next.extraFilters,
        true,
      );

      filtersBody.style.display =
        next.extraFilters
          ? ''
          : 'none';

      typeCheckboxes.forEach(
        (checkbox, key) => {
          checkbox.set(
            Boolean(next[key]),
            true,
          );
        },
      );

      includeField.set(
        normalizeAuthorFilterValue(
          next.authorInclude,
        ),
      );

      excludeField.set(
        normalizeAuthorFilterValue(
          next.authorExclude,
        ),
      );
    },

    setBrowsers(options, value) {
      browserSelect.setOptions(options.map(option => ({ ...option, label: L(option.label) })), value);
      browserSelect.setDisabled(options.length === 0);
    },
    setProfileHint(text, platform) {
      profileLabel.info?.setText(text);
      bindTextRender(browserHint, 'profile-hint', L(text), (node, value) => { node.textContent = value.replace(/\*\*/g, ''); });
      const label = accountLabel.querySelector('.rs-field-label__text');
      if (label) setText(label, L(state.settings.platform === 'behance' ? 'Ссылка Behance' : platform + '-аккаунт'));
      if (state.settings.platform === 'behance') setText(browserHint, L('Вставьте ссылку на кейс или коллекцию. Скачиваются отдельные изображения и видео; целый кейс будет доступен позже.'));
    },
    setUsername(value) {
      accountField.set(value);
    },

    setBrowserProfiles(profiles, selectedId) {
      const list = Array.isArray(profiles) ? profiles : [];

      profileSelect.setOptions(
        list.map((profile) => ({
          value: profile.id,
          label: profile.label,
        })),
        selectedId,
      );

      /* При одном профиле выбор не нужен: ReferenceSync
         использует его автоматически. */
      profileRow.style.display = list.length > 1 ? '' : 'none';
    },

    setInstagramProfileHint(username, browserName = 'Chrome') {
      const nickname = String(username || '')
        .trim()
        .replace(/^@/, '');

      const firstLine = nickname
        ? `В выбранном профиле ${browserName} в Instagram авторизован ` +
          `**@${nickname}**.`
        : `В выбранном профиле ${browserName} вход в Instagram не выполнен.`;

      profileLabel.info?.setText(
        firstLine + ' Название профиля и почта берутся из настроек браузера. ' +
        'ReferenceSync использует cookies именно этого профиля. ' +
        'Если в браузере открыто несколько аккаунтов, выберите имя или почту, ' +
        'которые указаны в нужном окне Chrome.',
      );
    },
  };
}

/* ============================================================
   4 блок — статус
   ============================================================ */
export function buildStatus({ onCommand } = {}) {
  const root = el('div', 'rs-status');
  const text = el(
    'div',
    'rs-status__text',
    L('Готов к работе'),
  );
  const hint = el(
    'div',
    'rs-status__hint',
    L('Заполните шаг 1 и нажмите «Начать поиск»'),
  );

  const row = el('div', 'rs-status__row');
  row.append(text, hint);
  root.appendChild(row);

  const progress = createProgressBar({
    onCommand,
  });

  progress.node.hidden = true;
  root.appendChild(progress.node);

  return {
    node: root,

    set(message, hintMessage, busy = false) {
      setUiText(text, message);
      setLocalizedProperty(text, 'title', L(message));

      if (
        hintMessage !== undefined &&
        hintMessage !== null
      ) {
        setUiText(hint, hintMessage);
        setLocalizedProperty(hint, 'title', L(hintMessage));
      }

      root.classList.toggle(
        'is-busy',
        Boolean(busy),
      );
    },

    progress,

    showProgress(visible) {
      const showingProgress =
        Boolean(visible);

      row.hidden =
        showingProgress;

      progress.node.hidden =
        !showingProgress;

      root.classList.toggle(
        'is-progress',
        showingProgress,
      );

      if (!showingProgress) {
        progress.setMode('idle');
      }
    },
  };
}

const TABLE_COLUMN_STORAGE_KEY =
  'reference-sync.table-columns.v2';

const TABLE_COLUMN_VARIABLES = [
  '--rs-table-lead-width',
  '--rs-table-author-width',
  '--rs-table-structure-width',
  '--rs-table-name-width',
  '--rs-table-description-width',
];

const TABLE_COLUMN_MIN_WIDTHS = [
  60,
  90,
  90,
  160,
  180,
];

/*
 * Заводские размеры колонок.
 * Порядок совпадает с TABLE_COLUMN_VARIABLES.
 */
const TABLE_COLUMN_DEFAULT_WIDTHS = [
  90,
  150,
  150,
  270,
  325,
];

function clampTableColumn(
  value,
  minimum,
  maximum,
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value,
    ),
  );
}

/*
 * Каскадное изменение ширины колонок.
 *
 * Если разделитель двигается влево:
 *   1. сжимается ближайшая колонка слева;
 *   2. затем предыдущая;
 *   3. затем следующая предыдущая;
 *   4. освободившаяся ширина передаётся колонке справа.
 *
 * Если разделитель двигается вправо:
 *   логика выполняется зеркально.
 */
function resizeTableColumnsCascade(
  widths,
  dividerIndex,
  delta,
) {
  const nextWidths = [...widths];

  if (!Number.isFinite(delta) || delta === 0) {
    return nextWidths;
  }

  /*
   * Перемещение разделителя влево.
   * Сжимаем колонки слева от разделителя:
   * сначала ближайшую, затем более дальние.
   */
  if (delta < 0) {
    let remaining = -delta;
    let releasedWidth = 0;

    for (
      let index = dividerIndex;
      index >= 0 && remaining > 0;
      index -= 1
    ) {
      const minimum =
        TABLE_COLUMN_MIN_WIDTHS[index];

      const available =
        Math.max(
          0,
          nextWidths[index] - minimum,
        );

      const amount =
        Math.min(
          available,
          remaining,
        );

      nextWidths[index] -= amount;
      remaining -= amount;
      releasedWidth += amount;
    }

    /*
     * Всё, что освободилось слева,
     * получает ближайшая колонка справа.
     */
    nextWidths[dividerIndex + 1] +=
      releasedWidth;

    return nextWidths;
  }

  /*
   * Перемещение разделителя вправо.
   * Сжимаем колонки справа от разделителя:
   * сначала ближайшую, затем более дальние.
   */
  let remaining = delta;
  let releasedWidth = 0;

  for (
    let index = dividerIndex + 1;
    index < nextWidths.length &&
      remaining > 0;
    index += 1
  ) {
    const minimum =
      TABLE_COLUMN_MIN_WIDTHS[index];

    const available =
      Math.max(
        0,
        nextWidths[index] - minimum,
      );

    const amount =
      Math.min(
        available,
        remaining,
      );

    nextWidths[index] -= amount;
    remaining -= amount;
    releasedWidth += amount;
  }

  /*
   * Всё, что освободилось справа,
   * получает ближайшая колонка слева.
   */
  nextWidths[dividerIndex] +=
    releasedWidth;

  return nextWidths;
}

function readSavedTableColumns() {
  try {
    const value =
      localStorage.getItem(
        TABLE_COLUMN_STORAGE_KEY,
      );

    if (!value) {
      return null;
    }

    const parsed =
      JSON.parse(value);

    if (
      !Array.isArray(parsed) ||
      parsed.length !==
        TABLE_COLUMN_VARIABLES.length
    ) {
      return null;
    }

    if (
      parsed.some(
        (width, index) =>
          !Number.isFinite(width) ||
          width < TABLE_COLUMN_MIN_WIDTHS[index] ||
          width > TABLE_COLUMN_DEFAULT_WIDTHS.reduce((sum, value) => sum + value, 0),
      )
    ) {
      return null;
    }

    return parsed;
  } catch (_) {
    return null;
  }
}

function saveTableColumns(widths) {
  try {
    localStorage.setItem(
      TABLE_COLUMN_STORAGE_KEY,
      JSON.stringify(widths),
    );
  } catch (_) {
    /*
     * Изменение ширины продолжает работать,
     * даже если localStorage недоступен.
     */
  }
}

function applyTableColumnWidths(
  root,
  widths,
) {
  widths.forEach(
    (width, index) => {
      root.style.setProperty(
        TABLE_COLUMN_VARIABLES[index],
        `${Number(width.toFixed(2))}px`,
      );
    },
  );
}

function installTableColumnResizing({
  root,
  table,
  headerGrid,
  headerCells,
  resizeLine,
}) {
  const savedWidths =
    readSavedTableColumns();

  /*
   * Это логические размеры колонок.
   *
   * Для Description здесь хранится именно базовая ширина,
   * а не фактическая ширина вместе со свободным пространством 1fr.
   */
  let columnWidths =
    savedWidths
      ? [...savedWidths]
      : [...TABLE_COLUMN_DEFAULT_WIDTHS];

  applyTableColumnWidths(
    root,
    columnWidths,
  );

  let activeResize = null;

  function resizeLinePosition(
    resizer,
  ) {
    const tableRect =
      table.getBoundingClientRect();

    const index =
      Number(
        resizer.dataset.resizeIndex,
      );

    const headerCell =
      headerCells[index];

    if (!headerCell) {
      return 0;
    }

    return (
      headerCell
        .getBoundingClientRect()
        .right -
      tableRect.left
    );
  }

  function showResizeLine(
    resizer,
  ) {
    resizeLine.style.left =
      `${resizeLinePosition(resizer)}px`;

    table.classList.add(
      'is-column-resize-hovered',
    );
  }

  function hideResizeLine() {
    if (activeResize) {
      return;
    }

    table.classList.remove(
      'is-column-resize-hovered',
    );

    resizeLine.style.removeProperty(
      'left',
    );
  }

  function resetTableColumnWidths(
    resizer,
  ) {
    activeResize = null;

    document.documentElement.classList.remove(
      'is-resizing-table-column',
    );

    table.classList.remove(
      'is-column-resizing',
    );

    columnWidths = [
      ...TABLE_COLUMN_DEFAULT_WIDTHS,
    ];

    applyTableColumnWidths(
      root,
      columnWidths,
    );

    try {
      localStorage.removeItem(
        TABLE_COLUMN_STORAGE_KEY,
      );
    } catch (_) {
      /*
       * Сброс продолжает работать,
       * даже если localStorage недоступен.
       */
    }

    requestAnimationFrame(
      () => {
        if (resizer?.matches(':hover')) showResizeLine(resizer);
        else hideResizeLine();
      },
    );
  }

  function finishResize(event) {
    if (!activeResize) {
      return;
    }

    const {
      resizer,
      pointerId,
      moved,
      nextWidths,
    } = activeResize;

    if (
      resizer.hasPointerCapture?.(
        pointerId,
      )
    ) {
      resizer.releasePointerCapture(
        pointerId,
      );
    }

    /*
     * Сохраняем вычисленные логические размеры,
     * а не getBoundingClientRect() заголовков.
     */
    if (
      moved &&
      Array.isArray(nextWidths)
    ) {
      columnWidths = [
        ...nextWidths,
      ];

      applyTableColumnWidths(
        root,
        columnWidths,
      );

      saveTableColumns(
        columnWidths,
      );
    }

    activeResize = null;

    document.documentElement.classList.remove(
      'is-resizing-table-column',
    );

    table.classList.remove(
      'is-column-resizing',
    );

    if (!resizer.matches(':hover')) {
      hideResizeLine();
    }

    event?.preventDefault?.();
  }

  headerGrid
    .querySelectorAll(
      '.rs-table__column-resizer',
    )
    .forEach((resizer) => {
      resizer.addEventListener(
        'pointerenter',
        () => {
          showResizeLine(resizer);
        },
      );

      resizer.addEventListener(
        'pointerleave',
        () => {
          hideResizeLine();
        },
      );

      /*
       * Двойной клик по вертикальному разделителю
       * возвращает заводские размеры всех колонок.
       */
      resizer.addEventListener(
        'dblclick',
        (event) => {
          event.preventDefault();
          event.stopPropagation();

          resetTableColumnWidths(
            resizer,
          );
        },
      );

      resizer.addEventListener(
        'pointerdown',
        (event) => {
          if (event.button !== 0) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          const index =
            Number(
              resizer.dataset.resizeIndex,
            );

          /*
           * Важно:
           * не используем размеры DOM-элементов заголовка.
           *
           * Особенно это критично для Description,
           * потому что её фактический размер содержит 1fr.
           */
          const widths = [
            ...columnWidths,
          ];

          activeResize = {
            index,

            startX:
              event.clientX,

            widths,

            nextWidths:
              [...widths],

            moved: false,

            resizer,

            pointerId:
              event.pointerId,
          };

          resizer.setPointerCapture(
            event.pointerId,
          );

          document.documentElement.classList.add(
            'is-resizing-table-column',
          );

          table.classList.add(
            'is-column-resizing',
          );

          showResizeLine(resizer);
        },
      );

      resizer.addEventListener(
        'pointermove',
        (event) => {
          if (
            !activeResize ||
            event.pointerId !==
              activeResize.pointerId
          ) {
            return;
          }

          const {
            index,
            startX,
            widths,
          } = activeResize;

          const delta =
            event.clientX -
            startX;

          /*
           * Pointermove может сработать при обычном клике.
           * До прохождения порога геометрию не меняем.
           */
          if (
            !activeResize.moved &&
            Math.abs(delta) < 2
          ) {
            return;
          }

          activeResize.moved = true;

          const nextWidths =
            resizeTableColumnsCascade(
              widths,
              index,
              delta,
            );

          activeResize.nextWidths =
            nextWidths;

          /*
           * Текущее логическое состояние обновляем сразу.
           * Благодаря этому новый drag всегда начинается
           * с корректных значений.
           */
          columnWidths = [
            ...nextWidths,
          ];

          applyTableColumnWidths(
            root,
            columnWidths,
          );

          requestAnimationFrame(
            () => {
              if (activeResize) {
                showResizeLine(
                  activeResize.resizer,
                );
              }
            },
          );
        },
      );

      resizer.addEventListener(
        'pointerup',
        finishResize,
      );

      resizer.addEventListener(
        'pointercancel',
        finishResize,
      );

      resizer.addEventListener(
        'lostpointercapture',
        finishResize,
      );
    });
}

/* ============================================================
   5 блок — таблица результатов
   ============================================================ */
export function buildResults({ onClear, onToggleAll, onThumbnails, onRowToggle,
  onEdit, onResetAll, onInstall,}) {
  const root = el('div', 'rs-results');

  /* Шапка */
  const head = el('div', 'rs-results__head');

  const titleRow = el('div', 'rs-results__title-row');
  const title = el('div', 'rs-results__title', L('Найденные публикации'));
  const clearButton = createGhostButton({
    label: L('Очистить список'),
    onClick: () => { if (onClear) onClear(); },
  });
  const resetAllButton = createGhostButton({
    label: L('Сбросить правки'),
    onClick: () => { if (onResetAll) onResetAll(); },
  });
  resetAllButton.node.style.display = 'none';

  const titleActions = el('div', 'rs-social__list');
  titleActions.append(resetAllButton.node, clearButton.node);
  titleRow.append(title, titleActions);

  /* Настройки: миниатюры + выбрать всё */
  const tools = el('div', 'rs-results__tools');

  const thumbSwitch = createSwitch({
    checked: state.settings.thumbnails,
    label: L('Миниатюры'),
    onChange: (value) => {
      setSetting('thumbnails', value);
      if (onThumbnails) onThumbnails(value);
    },
  });
  const thumbRow = el('div', 'rs-switch-row');
  thumbRow.append(thumbSwitch.node, thumbSwitch.labelNode);

  const selectAll = createCheckbox({
    checked: false,
    label: L('Выбрать всё'),
    onChange: (value) => { if (onToggleAll) onToggleAll(value); },
  });

  tools.append(thumbRow, selectAll.row);
  head.append(titleRow, tools);

  /* Таблица */
  const table = el('div', 'rs-table');

  const header =
    el(
      'div',
      'rs-table__header',
    );

  const headerGrid =
    el(
      'div',
      'rs-table__grid rs-table__header-grid',
    );

  const columnDefinitions = [
    {
      id: 'lead',
      label: L('Выбранные'),
    },
    {
      id: 'author',
      label: L('Автор'),
    },
    {
      id: 'structure',
      label: L('Структура'),
    },
    {
      id: 'name',
      label: L('Название в Eagle'),
    },
    {
      id: 'description',
      label: L('Описание в Eagle'),
    },
  ];

  const headerCells = [];

  columnDefinitions.forEach(
    (column, index) => {
      const cell =
        el(
          'div',
          'rs-table__col',
          column.label,
        );

      cell.dataset.column =
        column.id;

      headerCells.push(cell);
      headerGrid.appendChild(cell);

      if (
        index <
        columnDefinitions.length - 1
      ) {
        const resizer =
          el(
            'button',
            'rs-table__column-resizer',
          );

        resizer.type = 'button';

        resizer.dataset.resizeIndex =
          String(index);

        bindTextRender(resizer, 'column-label', L(column.label || 'выбора'), (node, label) => {
          node.ariaLabel = translate(`Изменить ширину колонки ${label}`);
        });

        cell.appendChild(resizer);
      }
    },
  );

  header.appendChild(headerGrid);

  const body = el('div', 'rs-table__body rs-scroll');
  const resizeLine =
    el(
      'div',
      'rs-table__resize-line',
    );

  resizeLine.setAttribute(
    'aria-hidden',
    'true',
  );
  table.append(
    header,
    body,
    resizeLine,
  );

  installTableColumnResizing({
    root,
    table,
    headerGrid,
    headerCells,
    resizeLine,
  });

  const engineEmpty = el(
    'div',
    'rs-results__engine',
  );

  const engineTitle = el(
    'div',
    'rs-results__engine-title',
    L('Проверяем движок загрузки…'),
  );

  const engineDescriptionRow = el(
    'div',
    'rs-results__engine-description-row',
  );

  const engineDescription = el(
    'div',
    'rs-results__engine-description',
    L('Подождите, идёт проверка Gallery-DL.'),
  );

  engineDescriptionRow.append(
    engineDescription,
    createInfo(L(TIP_ENGINE)).node,
  );

  const engineButton = createGhostButton({
    label: L('Скачать'),
    onClick: () => {
      if (onInstall) onInstall();
    },
  });

  engineButton.node.classList.add(
    'rs-results__engine-action',
  );
  engineButton.node.hidden = true;

  const engineBar = el(
    'div',
    'rs-engine__bar rs-results__engine-bar',
  );

  const engineBarFill = el(
    'div',
    'rs-engine__fill',
  );

  engineBar.appendChild(engineBarFill);
  engineBar.hidden = true;

  const engineDetail = el(
    'div',
    'rs-results__engine-detail',
  );

  engineDetail.hidden = true;

  engineEmpty.append(
    engineTitle,
    engineDescriptionRow,
    engineButton.node,
    engineBar,
    engineDetail,
  );

  const engineStates = [
    'checking',
    'ready',
    'missing',
    'working',
    'error',
  ];

  function setEngineState(kind, message, {
    detail = '',
    button = null,
    progress = null,
  } = {}) {
    const ready = kind === 'ready';

    engineEmpty.hidden = ready;
    head.hidden = !ready;
    table.hidden = !ready;

    engineStates.forEach((name) => {
      engineEmpty.classList.toggle(
        `is-${name}`,
        name === kind,
      );
    });

    setUiText(engineTitle, message);

    setUiText(engineDescription, L(detail ||
      (kind === 'checking'
        ? 'Подождите, идёт проверка Gallery-DL.'
        : '')));

    engineButton.node.hidden = !button;

    if (button) {
      engineButton.setLabel(button);
      engineButton.setDisabled(kind === 'working');
    }

    engineDetail.hidden = true;
    setText(engineDetail, '');

    engineBar.hidden = progress === null;

    if (progress !== null) {
      engineBarFill.style.width =
        `${Math.max(0, Math.min(100, progress))}%`;
    }
  }

  setEngineState(
    'checking',
    'Проверяем движок загрузки…',
  );

  root.append(head, engineEmpty, table);

  return {
    showArchive() { engineEmpty.hidden = true; head.hidden = false; table.hidden = false; },
    node: root,
    body,
    title,
    selectAll,
    clearButton,
    resetAllButton,
    engine: {
      setState: setEngineState,

      setProgress(percent) {
        engineBar.hidden = false;
        engineBarFill.style.width =
          `${Math.max(0, Math.min(100, percent))}%`;
      },
    },
    setTitle(count, total) {
      setText(title, L(total
        ? `Найденные публикации — ${count} из ${total}`
        : 'Найденные публикации'));
    },
  };
}

/* ============================================================
   6 блок — нумерация и описание
   ============================================================ */
export { buildNaming } from './naming-panel.js';

/* ============================================================
   Нижняя полоса: журнал + кнопка действия
   ============================================================ */
export function buildFooter({ onLog, onAction }) {
  const root = el('div', 'rs-footer');

  const left = el('div', 'rs-footer__left');
  const logButton = createButton({
    label: L('Показать технический журнал'),
    onClick: () => { if (onLog) onLog(); },
  });
  left.appendChild(logButton.node);

  const right = el('div', 'rs-footer__right');
  const action = createGlassButton({
    label: L('Начать поиск'),
    onClick: () => { if (onAction) onAction(); },
  });
  const actionBox = el('div', 'rs-footer__action');
  actionBox.appendChild(action.node);
  right.appendChild(actionBox);

  root.append(left, right);
  return { node: root, action, logButton };
}

/* ============================================================
   Журнал
   ============================================================ */
export function buildLog() {
  const root = el('div', 'rs-log');
  const list = el('div', 'rs-log__list rs-scroll');
  root.appendChild(list);

  return {
    node: root,
    add(message, kind = '') {
      const time = new Date().toLocaleTimeString('ru-RU');
      const line = el('div',
        `rs-log__line${kind ? ` rs-log__line--${kind}` : ''}`,
        joinText(`[${time}] `, L(message)));
      list.appendChild(line);
      list.scrollTop = list.scrollHeight;
      /* Не даём журналу расти бесконечно */
      while (list.childElementCount > 500) list.removeChild(list.firstChild);
    },
    toggle() { root.classList.toggle('is-open'); return root.classList.contains('is-open'); },
    clear() { clear(list); },
  };
}

/* ============================================================
   Модальное окно выбора коллекций
   ============================================================ */
export function buildCollectionModal({ onConfirm, onCancel }) {
  const root = el('div', 'rs-modal');
  const box = el('div', 'rs-modal__box');
  const title = el('div', 'rs-modal__title', L('Выберите коллекции'));
  const list = el('div', 'rs-modal__list rs-scroll');
  const foot = el('div', 'rs-modal__foot');

  const cancel = createGhostButton({
    label: L('Отмена'),
    onClick: () => { if (onCancel) onCancel(); },
  });
  const confirm = createGhostButton({
    label: L('Продолжить'),
    onClick: () => { if (onConfirm) onConfirm(); },
  });

  foot.append(cancel.node, confirm.node);
  box.append(title, list, foot);
  root.appendChild(box);

  return { node: root, list, title, confirm };
}

/* ------------------------------------------------------------
   Модальное предупреждение

   Используется для ошибок, которые требуют действия пользователя:
   неправильный аккаунт, отсутствие входа, просроченная сессия.
   Длинный текст не попадает в строку статуса и не растягивает UI.
   ------------------------------------------------------------ */
export function buildMessageModal() {
  const root = el('div', 'rs-modal');
  const box = el('div', 'rs-modal__box');
  const title = el('div', 'rs-modal__title');
  const message = el('div', 'rs-modal__message');
  const foot = el('div', 'rs-modal__foot');

  message.style.whiteSpace = 'normal';
  message.style.overflowWrap = 'anywhere';
  message.style.wordBreak = 'normal';
  message.style.lineHeight = '1.5';

  const closeButton = createGhostButton({
    label: L('Закрыть'),
    onClick: () => {
      root.classList.remove('is-open');
    },
  });

  foot.appendChild(closeButton.node);
  box.append(title, message, foot);
  root.appendChild(box);

  root.addEventListener('click', (event) => {
    if (event.target === root) {
      root.classList.remove('is-open');
    }
  });

  return {
    node: root,

    open({
      title: nextTitle = 'Требуется действие',
      text = '',
    } = {}) {
      setUiText(title, nextTitle);
      setUiText(message, text);
      root.classList.add('is-open');
    },

    close() {
      root.classList.remove('is-open');
    },
  };
}

/* ============================================================
   Модальное окно настройки компонентов карусели

   selection использует 0-based позиции компонентов.
   Отображаемый пользователю номер остаётся 1-based.
   ============================================================ */
export function buildCarouselModal() {
  const root = el('div', 'rs-modal rs-carousel-modal');
  root.tabIndex = -1;

  const box = el(
    'div',
    'rs-modal__box rs-carousel-modal__box',
  );

  const title = el(
    'div',
    'rs-modal__title rs-carousel-modal__title',
    L('Выберите нужные файлы'),
  );

  const content = el(
    'div',
    'rs-carousel-modal__content',
  );

  const controls = el(
    'div',
    'rs-carousel-modal__controls',
  );

  const list = el(
    'div',
    'rs-carousel-modal__list rs-scroll',
  );

  const summaryRow = el(
    'div',
    'rs-carousel-modal__summary-row',
  );

  const summary = el(
    'div',
    'rs-carousel-modal__summary',
  );

  const thumbnailsControl = el(
    'div',
    'rs-carousel-modal__thumbnails',
  );

  const foot = el(
    'div',
    'rs-modal__foot rs-carousel-modal__foot',
  );

  let currentPost = null;
  let currentSelection = new Set();
  let currentImported = new Set();
  const selectionGesture =
  createCheckboxGestureState();
  const componentCheckboxes = new Map();
  const componentRangePreviewIds = new Set();

  let carouselAutoScrollFrame = null;
  let carouselPointerX = 0;
  let carouselPointerY = 0;

  const CAROUSEL_SCROLL_EDGE = 48;
  const CAROUSEL_SCROLL_MAX_SPEED = 18;

  function clearCarouselRangePreview() {
  for (
    const componentIndex
    of componentRangePreviewIds
  ) {
    componentCheckboxes
      .get(componentIndex)
      ?.node.classList.remove(
        'is-range-preview',
      );
  }

  componentRangePreviewIds.clear();
}

  function previewCarouselRange(
    targetComponentIndex,
  ) {
    const anchorComponentIndex =
      selectionGesture.getAnchor();

    if (
      !Number.isInteger(anchorComponentIndex) ||
      !Number.isInteger(targetComponentIndex) ||
      !currentPost?.components?.length
    ) {
      clearCarouselRangePreview();
      return;
    }

    const orderedComponentIndexes =
      currentPost.components.map(
        (_, position) => position,
      );

    const range = checkboxRange(
      orderedComponentIndexes,
      anchorComponentIndex,
      targetComponentIndex,
    );

    clearCarouselRangePreview();

    for (const componentIndex of range) {
      if (
        componentIndex === anchorComponentIndex
      ) {
        continue;
      }

      if (currentImported.has(componentIndex)) {
        continue;
      }

      const checkbox =
        componentCheckboxes.get(componentIndex);

      if (!checkbox) {
        continue;
      }

      checkbox.node.classList.add(
        'is-range-preview',
      );

      componentRangePreviewIds.add(
        componentIndex,
      );
    }
  }

  function stopCarouselAutoScroll() {
    if (carouselAutoScrollFrame === null) {
      return;
    }

    cancelAnimationFrame(carouselAutoScrollFrame);
    carouselAutoScrollFrame = null;
  }

  function visitCarouselComponentDuringDrag(
    componentIndex,
  ) {
    if (
      !Number.isInteger(componentIndex) ||
      currentImported.has(componentIndex) ||
      !selectionGesture.isDragging()
    ) {
      return false;
    }

    const action = selectionGesture.visitDrag(
      componentIndex,
    );

    if (!action) {
      return false;
    }

    setComponentChecked(
      action.id,
      action.checked,
    );

    componentCheckboxes
      .get(action.id)
      ?.set(action.checked, true);

    updateSummary();

    return true;
  }

  function carouselComponentAtPointer() {
    const rect = list.getBoundingClientRect();

    const sampleX = Math.min(
      rect.right - 1,
      Math.max(rect.left + 1, carouselPointerX),
    );

    const sampleY = Math.min(
      rect.bottom - 1,
      Math.max(rect.top + 1, carouselPointerY),
    );

    const target = document.elementFromPoint(
      sampleX,
      sampleY,
    );

    const row = target?.closest?.(
      '[data-carousel-component-index]',
    );

    if (!row || !list.contains(row)) {
      return null;
    }

    const componentIndex = Number.parseInt(
      row.dataset.carouselComponentIndex,
      10,
    );

    return Number.isInteger(componentIndex)
      ? componentIndex
      : null;
  }

  function runCarouselAutoScroll() {
    carouselAutoScrollFrame = null;

    if (
      !selectionGesture.isDragging() ||
      !root.classList.contains('is-open')
    ) {
      return;
    }

    const rect = list.getBoundingClientRect();

    const insideHorizontal =
      carouselPointerX >= rect.left &&
      carouselPointerX <= rect.right;

    const insideVertical =
      carouselPointerY >=
        rect.top - CAROUSEL_SCROLL_EDGE &&
      carouselPointerY <=
        rect.bottom + CAROUSEL_SCROLL_EDGE;

    if (!insideHorizontal || !insideVertical) {
      return;
    }

    let speed = 0;

    if (
      carouselPointerY <
      rect.top + CAROUSEL_SCROLL_EDGE
    ) {
      const strength = Math.min(
        1,
        (
          rect.top +
          CAROUSEL_SCROLL_EDGE -
          carouselPointerY
        ) / CAROUSEL_SCROLL_EDGE,
      );

      speed =
        -CAROUSEL_SCROLL_MAX_SPEED * strength;
    } else if (
      carouselPointerY >
      rect.bottom - CAROUSEL_SCROLL_EDGE
    ) {
      const strength = Math.min(
        1,
        (
          carouselPointerY -
          (
            rect.bottom -
            CAROUSEL_SCROLL_EDGE
          )
        ) / CAROUSEL_SCROLL_EDGE,
      );

      speed =
        CAROUSEL_SCROLL_MAX_SPEED * strength;
    }

    if (speed === 0) {
      return;
    }

    const previousScrollTop = list.scrollTop;

    list.scrollTop += speed;

    visitCarouselComponentDuringDrag(
      carouselComponentAtPointer(),
    );

    if (
      list.scrollTop !== previousScrollTop &&
      selectionGesture.isDragging()
    ) {
      carouselAutoScrollFrame =
        requestAnimationFrame(
          runCarouselAutoScroll,
        );
    }
  }

  function startCarouselAutoScroll() {
    if (
      carouselAutoScrollFrame !== null ||
      !selectionGesture.isDragging()
    ) {
      return;
    }

    carouselAutoScrollFrame =
      requestAnimationFrame(
        runCarouselAutoScroll,
      );
  }

  function endSelectionGesture() {
    stopCarouselAutoScroll();
    selectionGesture.endDrag();
  }

  function updateCarouselDragPointer(event) {
    if (!selectionGesture.isDragging()) {
      return;
    }

    if ((event.buttons & 1) !== 1) {
      endSelectionGesture();
      return;
    }

    carouselPointerX = event.clientX;
    carouselPointerY = event.clientY;

    startCarouselAutoScroll();
  }

  window.addEventListener(
    'pointermove',
    updateCarouselDragPointer,
  );

  window.addEventListener(
    'pointerup',
    endSelectionGesture,
  );

  window.addEventListener(
    'pointercancel',
    endSelectionGesture,
  );

  window.addEventListener(
    'blur',
    endSelectionGesture,
  );

  window.addEventListener(
    'keyup',
    (event) => {
      if (event.key === 'Shift') {
        clearCarouselRangePreview();
      }
    },
  );

  window.addEventListener(
    'blur',
    clearCarouselRangePreview,
  );

  let currentThumbnails = true;
  let onConfirmCallback = null;
  let onCancelCallback = null;

  function selectablePositions(positions) {
    const source = positions instanceof Set
      ? positions
      : new Set(positions || []);

    const componentTotal = Array.isArray(currentPost?.components)
      ? currentPost.components.length
      : Number(currentPost?.componentCount) || 0;

    return new Set(
      [...source]
        .map(Number)
        .filter((position) => (
          Number.isInteger(position) &&
          position >= 0 &&
          position < componentTotal &&
          !currentImported.has(position)
        )),
    );
  }

  function updateSummary() {
    const componentTotal = Array.isArray(currentPost?.components)
    ? currentPost.components.length
    : Number(currentPost?.componentCount) || 0;

    const availableTotal = Math.max(
      0,
      componentTotal - currentImported.size,
    );

    const selected = currentSelection.size;

    setText(summary, L(`Выбрано файлов: ${selected} из ${availableTotal}`));
  }

  function updateSelection(nextSelection) {
    clearCarouselRangePreview();
    selectionGesture.resetAnchor();
    
    currentSelection = selectablePositions(
      nextSelection,
    );

    renderList();
    updateSummary();
  }

  function setComponentChecked(
  componentIndex,
  checked,
) {
  if (currentImported.has(componentIndex)) {
    return;
  }

  if (checked) {
    currentSelection.add(componentIndex);
  } else {
    currentSelection.delete(componentIndex);
  }
}

function syncComponentCheckboxes() {
  componentCheckboxes.forEach(
    (checkbox, componentIndex) => {
      checkbox.set(
        currentSelection.has(componentIndex),
        true,
      );
    },
  );
}

  function shiftComponentSelection(
    componentIndex,
    checked,
  ) {
    clearCarouselRangePreview();

    const result = applyShiftSelection({
      orderedIds: currentPost.components.map(
        (_, position) => position,
      ),
      selectedIds: currentSelection,
      anchorId: selectionGesture.getAnchor(),
      targetId: componentIndex,
      checked,
      disabledIds: currentImported,
    });

    currentSelection = result.selectedIds;

    selectionGesture.setAnchor(
      result.anchorId,
    );

    syncComponentCheckboxes();
    updateSummary();

    return result;
  }

  function pressComponentRange(
    affectedIds,
    pressedState,
  ) {
    const anchorComponentIndex =
      selectionGesture.getAnchor();

    for (const componentIndex of affectedIds) {
      /*
      * Первый чекбокс является anchor.
      * Его состояние уже было изменено первым кликом,
      * поэтому Shift-pressed на него не накладываем.
      */
     if (
        componentIndex === anchorComponentIndex
      ) {
        continue;
      }

      if (currentImported.has(componentIndex)) {
        continue;
      }

      componentCheckboxes
          .get(componentIndex)
        ?.setPressedFrom(pressedState);
    }
  }

  const selectAllButton = createGhostButton({
    label: L('ВЫБРАТЬ ВСЁ'),
    onClick: () => {
      if (!currentPost) return;
      updateSelection(
        selectablePositions(selectAll(currentPost)),
      );
    },
  });

  const clearButton = createGhostButton({
    label: L('СНЯТЬ ВСЁ'),
    onClick: () => {
      updateSelection(clearSelection());
    },
  });

  const imagesButton = createGhostButton({
    label: L('ЛИШЬ ИЗОБРАЖЕНИЯ'),
    onClick: () => {
      if (!currentPost) return;
      updateSelection(
        selectablePositions(imagesOnly(currentPost)),
      );
    },
  });

  const videosButton = createGhostButton({
    label: L('ЛИШЬ ВИДЕО'),
    onClick: () => {
      if (!currentPost) return;
      updateSelection(
        selectablePositions(videosOnly(currentPost)),
      );
    },
  });

  controls.append(
    selectAllButton.node,
    clearButton.node,
    imagesButton.node,
    videosButton.node,
  );

  const thumbnailsCheckbox = createCheckbox({
    checked: true,
    onChange: (checked) => {
      currentThumbnails = checked;
      renderList();
    },
  });

  const thumbnailsLabel = el(
    'span',
    'rs-carousel-modal__thumbnails-label',
    L('Миниатюры'),
  );

  thumbnailsControl.append(
    thumbnailsCheckbox.node,
    thumbnailsLabel,
  );

  thumbnailsControl.addEventListener('click', (event) => {
    if (
      event.target === thumbnailsCheckbox.node ||
      thumbnailsCheckbox.node.contains(event.target)
    ) {
      return;
    }

    thumbnailsCheckbox.set(!thumbnailsCheckbox.value);
  });

  summaryRow.append(summary, thumbnailsControl);

  const cancel = createButton({
    label: L('Отмена'),
    onClick: () => cancelModal(),
  });

  const confirm = createGlassButton({
    label: 'OK',
    onClick: () => confirmModal(),
  });

  foot.append(cancel.node, confirm.node);
  content.append(controls, list, summaryRow);
  box.append(title, content, foot);
  root.appendChild(box);

  function renderList() {
    clearCarouselRangePreview();
    clear(list);
    componentCheckboxes.clear();

    if (!currentPost?.components?.length) {
      return;
    }

    currentPost.components.forEach(
      (component, componentIndex) => {
        const row = el(
          'div',
          'rs-carousel-modal__row',
        );

        row.dataset.carouselComponentIndex =
          String(componentIndex);

        row.addEventListener(
          'pointerenter',
          (event) => {
            /*
            * Обычный drag-selection имеет приоритет
            * над Shift-preview.
            */
            if (selectionGesture.isDragging()) {
              updateCarouselDragPointer(event);

              visitCarouselComponentDuringDrag(
                componentIndex,
              );

              return;
            }

            /*
            * M1-T08G:
            * при удержании Shift показываем диапазон,
            * который применится следующим Shift-click.
            */
            if (event.shiftKey) {
              previewCarouselRange(
                componentIndex,
              );
            }
          },
        );


        const isImported =
          currentImported.has(componentIndex);

        row.classList.toggle(
          'is-imported',
          isImported,
        );

        /*
        * Shift-клик по любой части строки должен
        * применять тот же диапазон, что Shift-клик
        * непосредственно по чекбоксу.
        *
        * Capture нужен, чтобы обработать событие раньше
        * обычного row-click, переключающего одну строку.
        */
        let suppressShiftRowClick = false;

        row.addEventListener(
          'pointerdown',
          (event) => {
            if (
              event.button !== 0 ||
              !event.shiftKey ||
              isImported
            ) {
              return;
            }

            /*
            * Сам чекбокс уже полностью обрабатывает
            * pointerdown через createCheckbox().
            */
            if (
              event.target.closest?.('.rs-check')
            ) {
              return;
            }

            const checked =
              !currentSelection.has(componentIndex);

            clearCarouselRangePreview();

            const result = shiftComponentSelection(
              componentIndex,
              checked,
            );

            pressComponentRange(
              result?.affectedIds || [componentIndex],
              checked ? 'off' : 'on',
            );

            /*
            * Логическое изменение уже сделано на pointerdown.
            * Обычный row-click после pointerup нужно подавить.
            */
           suppressShiftRowClick = true;

           window.addEventListener(
            'pointercancel',
            () => {
              suppressShiftRowClick = false;
            },
            { once: true },
          );

          window.addEventListener(
            'blur',
            () => {
              suppressShiftRowClick = false;
            },
            { once: true },
          );

            event.preventDefault();
            event.stopImmediatePropagation();
          },
          true,
        );

        row.addEventListener(
          'click',
          (event) => {
          if (!suppressShiftRowClick) {
            return;
          }

          suppressShiftRowClick = false;

          event.preventDefault();
          event.stopImmediatePropagation();
          },
          true,
        );

        if (isImported) {
         row.setAttribute('aria-disabled', 'true');
          setLocalizedProperty(row, 'title', L('Этот файл уже импортирован в Eagle'));
        }

        const hasThumbnail = Boolean(
          currentThumbnails && component.previewUrl,
        );

        row.classList.toggle(
          'has-thumbnail',
          hasThumbnail,
        );

        const checkbox = createCheckbox({
          checked:
            !isImported &&
            currentSelection.has(componentIndex),

          disabled: isImported,

          onChange: (checked, event) => {
            if (isImported) return;

            if (event?.shiftKey) {
              shiftComponentSelection(
                componentIndex,
                checked,
              );
              return;
            }

            setComponentChecked(
              componentIndex,
              checked,
            );

            selectionGesture.setAnchor(
              componentIndex,
            );

            updateSummary();
          },

          onPointerDown: (event, api) => {
            if (isImported) return false;

            const checked =
              !currentSelection.has(componentIndex);

              clearCarouselRangePreview();

            if (event.shiftKey) {
              /*
                * Запоминаем состояние последнего чекбокса
                * до логического переключения диапазона.
                */
              const result = shiftComponentSelection(
                componentIndex,
                checked,
              );

              /*
              * checked — итоговое состояние диапазона.
              * checked=true:
              * чекбокс был Off и сейчас нажимается для включения,
              * поэтому во время pointerdown показываем Off/Pressed.
              * 
              * checked=false:
              * чекбокс был On и сейчас нажимается для выключения,
              * поэтому показываем On/Pressed.
              */
              pressComponentRange(
                result?.affectedIds || [componentIndex],
                checked ? 'off' : 'on',
              );

              return true;
            }

            selectionGesture.beginDrag(
              componentIndex,
              checked,
            );

            setComponentChecked(
              componentIndex,
              checked,
            );

            updateCarouselDragPointer(event);

            api.set(checked, true);
            updateSummary();

            return true;
          },

          onPointerEnter: (event, api) => {
            if (
              isImported ||
              !selectionGesture.isDragging()
            ) {
              return;
            }

            if ((event.buttons & 1) !== 1) {
              endSelectionGesture();
              return;
            }

            updateCarouselDragPointer(event);

            const action =
              selectionGesture.visitDrag(
                componentIndex,
              );

            if (!action) return;

            setComponentChecked(
              action.id,
              action.checked,
            );

            api.set(action.checked, true);
            updateSummary();
          },
        });

        componentCheckboxes.set(
          componentIndex,
          checkbox,
        );


        if (isImported) {
          checkbox.node.classList.add('is-disabled');
          checkbox.node.setAttribute(
            'aria-disabled',
            'true'
          );
          checkbox.node.setAttribute(
            'tabindex',
            '-1'
          );
        }

        row.appendChild(checkbox.node);

        if (hasThumbnail) {
          const thumbnail = el(
            'div',
            'rs-carousel-modal__thumbnail',
          );

          attachThumbnail(thumbnail, component.previewUrl);
          row.appendChild(thumbnail);
        }

        const display = componentDisplay(
          component,
          componentIndex,
        );

        const position = el(
          'span',
          'rs-carousel-modal__position',
          `${display.number}.`,
        );

        const media = el(
          'span',
          'rs-carousel-modal__media',
          L(display.label),
        );

        const label = el(
          'div',
          'rs-carousel-modal__label',
        );

        label.append(position, media);

        if (isImported) {
          label.appendChild(
            el(
              'span',
              'rs-carousel-modal__imported',
              L('Уже в Eagle'),
            ),
          );
        }

        row.appendChild(label);

        row.addEventListener('click', (event) => {
          if (
            isImported ||
            event.target === checkbox.node ||
            checkbox.node.contains(event.target)
          ) {
            return;
          }

          checkbox.set(!checkbox.value);
        });

        list.appendChild(row);
      },
    );
  }

  function close() {
    stopCarouselAutoScroll();
    clearCarouselRangePreview();
    selectionGesture.reset();
    root.classList.remove('is-open');
  }

  function cancelModal() {
    const callback = onCancelCallback;
    close();

    if (callback) {
      callback();
    }
  }

  function confirmModal() {
    const callback = onConfirmCallback;
    const selection = new Set(currentSelection);
    close();

    if (callback) {
      callback(selection);
    }
  }

  root.addEventListener('click', (event) => {
    if (event.target === root) {
      cancelModal();
    }
  });

  root.addEventListener('keydown', (event) => {
    if (
      event.key === 'Escape' &&
      root.classList.contains('is-open')
    ) {
      event.preventDefault();
      cancelModal();
    }
  });

  return {
    node: root,

    open({
      post = null,
      selection,
      importedPositions = new Set(),
      thumbnails = true,
      onConfirm = null,
      onCancel = null,
    } = {}) {
      if (
        !post ||
        !Array.isArray(post.components) ||
        post.components.length <= 1
      ) {
        return;
      }

      currentPost = post;

      const componentTotal = Array.isArray(currentPost.components)
      ? currentPost.components.length
      : Number(currentPost.componentCount) || 0;

      const importedSource =
      importedPositions instanceof Set
      ? importedPositions
      : new Set(importedPositions || []);

      currentImported = new Set(
        [...importedSource]
        .map(Number)
        .filter((position) => (
          Number.isInteger(position) &&
          position >= 0 &&
          position < componentTotal
        )),
      );

      const initialSelection = selection === undefined
      ? selectAll(currentPost)
      : selection;

      currentSelection = selectablePositions(initialSelection);

      selectionGesture.reset();

      currentThumbnails = Boolean(thumbnails);
      thumbnailsCheckbox.set(currentThumbnails, false);

      onConfirmCallback =
      typeof onConfirm === 'function' ? onConfirm : null;

      onCancelCallback =
      typeof onCancel === 'function' ? onCancel : null;

      renderList();
      updateSummary();

      root.classList.add('is-open');
      root.focus();
    },

    close,
  };
}

