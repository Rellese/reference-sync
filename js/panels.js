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

import { state, setSetting } from './state.js';
import { SEARCH_MODES } from './instagram.js';
import {
  normalizeSelection,
  selectAll,
  clearSelection,
  imagesOnly,
  videosOnly,
  componentDisplay,
} from './carousel-selection.js';
import {
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

const TIP_SPEED =
  'Влияет на скорость поиска и скачивания файлов. При количестве ' +
  '**>1000 файлов рекомендуется выбирать безопасный режим** иначе есть шанс ' +
  'срабатывания защиты от спама. Режим «Молния» снимает все задержки и ' +
  'подходит только для небольших партий.';

const TIP_ACCOUNT =
  'Имя пользователя Instagram без символа @. Используется вход, уже ' +
  'выполненный в выбранном браузере — **пароль не запрашивается и не хранится**.';

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

/* Подсказки для остальных мест, где стоит Инфо */
const TIP_SOURCE =
  'Откуда брать список сохранённого. **Через браузер — быстрее и без файлов**, ' +
  'архив Meta нужен, когда доступа к аккаунту больше нет.';

const TIP_SEARCH_MODE =
  '«Только новые» проверяет ленту до первого знакомого поста и останавливается — ' +
  '**подходит для регулярного обновления**. Полный проход нужен для первого ' +
  'запуска или сверки всей библиотеки.';

const TIP_FILTERS =
  'Фильтры применяются **к уже найденному списку**, поэтому их можно ' +
  'менять после поиска без повторного обращения к Instagram.';

const TIP_ENGINE =
  'Модуль загрузки — внешняя программа, которая скачивает файлы. ' +
  '**Плагин устанавливает его сам в свою папку** — терминал не нужен, ' +
  'системные настройки не меняются.';

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
  close.title = 'Закрыть';
  const min = el('div', 'rs-titlebar__dot rs-titlebar__dot--min');
  min.title = 'Свернуть';
  const max = el('div', 'rs-titlebar__dot rs-titlebar__dot--max');
  max.title = 'Полный экран';

  close.addEventListener('click', () => { if (onClose) onClose(); });
  root.append(close, min, max);
  return root;
}

/* ============================================================
   1 блок — шапка
   ============================================================ */
export function buildHeader({ version = 'Beta v.1.2', onLanguage }) {
  const root = el('div', 'rs-header');

  const left = el('div', 'rs-header__left');
  left.append(
    el('div', 'rs-header__title', 'ReferenceSync'),
    el('div', 'rs-header__subtitle',
      'Сохраняйте референсы из социальных сетей в Eagle'),
  );

  const right = el('div', 'rs-header__right');
  right.appendChild(el('div', 'rs-header__version', version));

  const lang = el('div', 'rs-lang');
  LANGUAGES.forEach((code) => {
    const item = el('button', 'rs-lang__item', code);
    if (code === 'РУ') item.classList.add('is-active');
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
      title: platform.ready ? platform.title
        : `${platform.title} — ${platform.notReadyReason}`,
      active: platform.id === state.settings.platform,
      locked: !platform.ready,
      onClick: () => {
        buttons.forEach((entry, id) => entry.setActive(id === platform.id));
        value.textContent = platform.title;
        if (onSelect) onSelect(platform.id);
      },
    });
    buttons.set(platform.id, button);
    list.appendChild(button.node);
  });

  const meta = el('div', 'rs-social__meta');
  const value = el('div', 'rs-social__value',
    platforms().find((p) => p.id === state.settings.platform)?.title || 'Instagram');
  meta.append(el('div', 'rs-social__caption', 'Выбранная соц. сеть'), value);

  root.append(list, meta);
  return root;
}

/* ============================================================
   3 блок — настройки поиска (шаг 1 и шаг 2)
   ============================================================ */
export function buildSettings({ onChange, onFolderSearch }) {
  const root = el('div', 'rs-panel');
  const body = el('div', 'rs-panel__body rs-scroll');

  const s = state.settings;

  /* ---------- Шаг 1: выбор источника ---------- */
  const step1 = el('div', 'rs-step');
  step1.appendChild(createLabelWithInfo(
    'Шаг 1 — выбор анализа', TIP_SOURCE,
    { className: 'rs-step__title' }).node);

  const sourceGroup = createRadioGroup([
    { value: 'browser', label: 'Через авторизованный браузер' },
    { value: 'meta', label: 'Из архива Meta' },
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

  const metaHint = el('div', 'rs-hint',
    'Интерфейс готов. Разбор архива Meta подключим следующим этапом.');
  metaHint.style.display = s.source === 'meta' ? '' : 'none';
  step1.appendChild(metaHint);

  /* ---------- Настройки браузера ---------- */
  const browserBlock = el('div', 'rs-step');
  browserBlock.style.display = s.source === 'browser' ? '' : 'none';

  /* Instagram-аккаунт */
  const accountRow = el('div', 'rs-step__row');
  const accountLabel = createLabelWithInfo('Instagram-аккаунт', TIP_ACCOUNT).node;
  const accountField = createField({
    value: s.username,
    placeholder: 'имя пользователя',
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
    'Браузер с выполненным входом', TIP_BROWSER).node;
  const browserSelect = createSelect({
    options: [
      { value: 'chrome', label: 'Google Chrome' },
      { value: 'yandex', label: 'Яндекс.Браузер' },
      { value: 'safari', label: 'Safari' },
      { value: 'firefox', label: 'Firefox' },
      { value: 'edge', label: 'Microsoft Edge' },
    ],
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
    'Профиль браузера',
    TIP_BROWSER_PROFILE,
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
    'ReferenceSync использует существующий вход в браузере. ' +
    'Пароль Instagram не запрашивается.');

  /* Скорость загрузки */
  const speedRow = el('div', 'rs-step__row');
  const speedLabel = createLabelWithInfo('Скорость загрузки', TIP_SPEED).node;
  const speedSelect = createSelect({
    options: [
      { value: 'safe', label: 'Безопасная — медленнее, меньше риск блокировки' },
      { value: 'balanced', label: 'Сбалансированная — немного быстрее' },
      /* Третий режим: без задержек между запросами */
      { value: 'lightning', label: 'Молния — без ограничений' },
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
  step2.appendChild(createLabelWithInfo(
    'Шаг 2 — тип поиска', TIP_SEARCH_MODE,
    { className: 'rs-step__title' }).node);

  const recentSpinner = createSpinner({
    value: s.recentLimit,
    min: 1,
    onChange: (value) => {
      setSetting('recentLimit', value);
      if (onChange) onChange('recentLimit', value);
    },
  });

  const modeGroup = createRadioGroup([
    { value: SEARCH_MODES.SMART, label: 'Найти только новые' },
    { value: SEARCH_MODES.FULL, label: 'Проверить все сохранённые' },
    { value: SEARCH_MODES.RECENT, label: 'Проверить только последние' },
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
      'Основной режим. Программа идёт от новых публикаций к старым ' +
      'и ищет границу предыдущей синхронизации.'),
  );

  const modeFull = el('div', 'rs-mode');
  modeFull.append(
    modeGroup.rowOf(SEARCH_MODES.FULL),
    el('div', 'rs-hint',
      'Полный анализ всего раздела Saved без ограничения по количеству. ' +
      'Подходит для первого переноса.'),
  );

  const modeRecent = el('div', 'rs-mode');
  const recentHead = el('div', 'rs-mode__head');
  const recentSpinnerBox = el('div', 'rs-mode__spinner');
  recentSpinnerBox.appendChild(recentSpinner.node);
  recentHead.append(modeGroup.rowOf(SEARCH_MODES.RECENT), recentSpinnerBox);
  modeRecent.append(
    recentHead,
    el('div', 'rs-hint',
      'Дополнительный режим для быстрой проверки или тестирования.'),
  );
  recentSpinner.setDisabled(s.searchMode !== SEARCH_MODES.RECENT);

  modes.append(modeSmart, modeFull, modeRecent);
  step2.appendChild(modes);

  /* Тумблер «Искать в выбранных папках» */
  const folderSwitch = createSwitch({
    checked: s.folderSearch,
    label: 'Искать в выбранных папках',
    onChange: (value) => {
      setSetting('folderSearch', value);
      if (value && onFolderSearch) onFolderSearch();
      if (onChange) onChange('folderSearch', value);
    },
  });
  const folderRow = el('div', 'rs-switch-row');
  folderRow.append(
    folderSwitch.node,
    folderSwitch.labelNode,
    el('span', 'rs-switch-row__gap'),
    createInfo(TIP_FOLDERS).node,
  );
  step2.appendChild(folderRow);

  /* ---------- Дополнительные фильтры ---------- */
  const step3 = el('div', 'rs-step');

  const filtersBody = el('div', 'rs-step__group');
  filtersBody.style.display = s.extraFilters ? '' : 'none';

  const filterSwitch = createSwitch({
    checked: s.extraFilters,
    label: 'Дополнительные фильтры',
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
    createInfo(TIP_FILTERS).node,
  );
  step3.appendChild(filterRow);

  /* Фильтрация файлов */
  step3.appendChild(filtersBody);
  filtersBody.appendChild(el('div', 'rs-step__title', 'Фильтрация файлов'));

  const typeRow = el('div', 'rs-filter-row');
  [
    ['filterPhoto', 'Фотографии'],
    ['filterVideo', 'Видео'],
    ['filterCarousel', 'Карусели'],
  ].forEach(([key, label]) => {
    const box = createCheckbox({
      checked: s[key],
      label,
      onChange: (value) => {
        setSetting(key, value);
        if (onChange) onChange(key, value);
      },
    });
    typeRow.appendChild(box.row);
  });
  filtersBody.appendChild(typeRow);

  /* Фильтрация авторов */
  filtersBody.appendChild(el('div', 'rs-step__title', 'Фильтрация авторов'));

  const includeRow = el('div', 'rs-step__row');
  includeRow.append(
    el('div', 'rs-field-label', 'Только эти авторы:'),
    createField({
      value: s.authorInclude,
      placeholder: 'через запятую',
      at: true,
      onCommit: (value) => {
        setSetting('authorInclude', value);
        if (onChange) onChange('authorInclude', value);
      },
    }).node,
  );

  const excludeRow = el('div', 'rs-step__row');
  excludeRow.append(
    el('div', 'rs-field-label', 'Исключить авторов:'),
    createField({
      value: s.authorExclude,
      placeholder: 'через запятую',
      at: true,
      onCommit: (value) => {
        setSetting('authorExclude', value);
        if (onChange) onChange('authorExclude', value);
      },
    }).node,
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
export function buildStatus({ onInstall, onCommand } = {}) {
  const root = el('div', 'rs-status');
  const text = el('div', 'rs-status__text', 'Готов к работе');
  const hint = el('div', 'rs-status__hint', 'Заполните шаг 1 и нажмите «Начать поиск»');

  /* Основной ряд блока 4 — ровно 43px по макету */
  const row = el('div', 'rs-status__row');
  row.append(text, hint);
  root.appendChild(row);

  /* ---------- Прогресс-бар ----------
     Все 7 состояний из Full_design/Scale *. Показывается только
     во время работы: в покое блок 4 остаётся компактным. */
  const progress = createProgressBar({ onCommand });
  progress.node.hidden = true;
  root.appendChild(progress.node);

  /* ---------- Строка движка загрузки ----------
     Движок (gallery-dl) плагин ставит себе сам, в свою
     приватную папку. Пользователь не открывает терминал:
     здесь показывается состояние и одна кнопка. */
  const engine = el('div', 'rs-engine');
  const engineDot = el('span', 'rs-engine__dot');
  const engineText = el('div', 'rs-engine__text', 'Движок загрузки: проверяем…');
  const engineHead = el('div', 'rs-engine__head');
  engineHead.append(engineDot, engineText);

  const engineButton = createGhostButton({
    label: 'Подготовить движок',
    onClick: () => { if (onInstall) onInstall(); },
  });
  engineButton.node.classList.add('rs-engine__action');
  engineButton.node.hidden = true;

  const bar = el('div', 'rs-engine__bar');
  const barFill = el('div', 'rs-engine__fill');
  bar.appendChild(barFill);
  bar.hidden = true;

  const detail = el('div', 'rs-engine__detail');
  detail.hidden = true;

  engine.append(engineHead, engineButton.node, bar, detail);
  root.appendChild(engine);

  const STATES = ['checking', 'ready', 'missing', 'working', 'error'];

  return {
    node: root,
    set(message, hintMessage, busy = false) {
      text.textContent = message;
      if (hintMessage !== undefined && hintMessage !== null) {
        hint.textContent = hintMessage;
      }
      root.classList.toggle('is-busy', Boolean(busy));
    },

    /* Прогресс-бар: показ/скрытие + прямой доступ к API */
    progress,
    showProgress(visible) {
      progress.node.hidden = !visible;
      if (!visible) progress.setMode('idle');
    },

    engine: {
      /* kind: checking | ready | missing | working | error */
      setState(kind, message, {
        detail: detailText = '',
        button = null,
        progress = null,
      } = {}) {
        STATES.forEach((name) => {
          engine.classList.toggle(`is-${name}`, name === kind);
        });
        engineText.textContent = message;

        detail.hidden = !detailText;
        detail.textContent = detailText || '';

        engineButton.node.hidden = !button;
        if (button) {
          engineButton.setLabel(button);
          engineButton.setDisabled(kind === 'working');
        }

        bar.hidden = progress === null;
        if (progress !== null) {
          barFill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
        }
      },
      setProgress(percent) {
        bar.hidden = false;
        barFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
      },
    },
  };
}

/* ============================================================
   5 блок — таблица результатов
   ============================================================ */
export function buildResults({ onClear, onToggleAll, onThumbnails, onRowToggle,
  onEdit, onResetAll }) {
  const root = el('div', 'rs-results');

  /* Шапка */
  const head = el('div', 'rs-results__head');

  const titleRow = el('div', 'rs-results__title-row');
  const title = el('div', 'rs-results__title', 'Найденные публикации');
  const clearButton = createGhostButton({
    label: 'Очистить список',
    onClick: () => { if (onClear) onClear(); },
  });
  const resetAllButton = createGhostButton({
    label: 'Сбросить правки',
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
    label: 'Миниатюры',
    onChange: (value) => {
      setSetting('thumbnails', value);
      if (onThumbnails) onThumbnails(value);
    },
  });
  const thumbRow = el('div', 'rs-switch-row');
  thumbRow.append(thumbSwitch.node, thumbSwitch.labelNode);

  const selectAll = createCheckbox({
    checked: false,
    label: 'Выбрать всё',
    onChange: (value) => { if (onToggleAll) onToggleAll(value); },
  });

  tools.append(thumbRow, selectAll.row);
  head.append(titleRow, tools);

  /* Таблица */
  const table = el('div', 'rs-table');

  const header = el('div', 'rs-table__header');
  const headerGrid = el('div', 'rs-table__grid');
  ['', 'Автор', 'Тип', 'Структура', 'Название в Eagle', 'Описание в Eagle']
    .forEach((label) => headerGrid.appendChild(el('div', 'rs-table__col', label)));
  header.appendChild(headerGrid);

  const body = el('div', 'rs-table__body rs-scroll');
  table.append(header, body);

  root.append(head, table);

  return {
    node: root,
    body,
    title,
    selectAll,
    clearButton,
    resetAllButton,
    setTitle(count, total) {
      title.textContent = total
        ? `Найденные публикации — ${count} из ${total}`
        : 'Найденные публикации';
    },
  };
}

/* ============================================================
   6 блок — нумерация и описание
   ============================================================ */
export function buildNaming({ onChange }) {
  const root = el('div', 'rs-naming');
  const body = el('div', 'rs-naming__body rs-scroll');
  const s = state.settings;

  body.appendChild(el('div', 'rs-naming__title', 'Нумерация и описание'));

  /* ---------- Тумблер нумерации ---------- */
  const numberingSwitch = createSwitch({
    checked: s.numberingEnabled,
    label: 'Использовать нумерацию',
    onChange: (value) => {
      setSetting('numberingEnabled', value);
      numberingGrid.style.display = value ? '' : 'none';
      if (onChange) onChange();
    },
  });
  const numberingRow = el('div', 'rs-switch-row');
  numberingRow.append(
    numberingSwitch.node,
    numberingSwitch.labelNode,
    el('span', 'rs-switch-row__gap'),
    createInfo(TIP_NUMBERING).node,
  );
  body.appendChild(numberingRow);

  /* ---------- Настройки нумерации ---------- */
  const numberingGrid = el('div', 'rs-naming__grid');
  numberingGrid.style.display = s.numberingEnabled ? '' : 'none';

  const cell = (label, control) => {
    const box = el('div', 'rs-naming__cell');
    box.append(el('div', 'rs-naming__label', label), control);
    return box;
  };

  const destinationSelect = createSelect({
    options: [
      { value: 'name', label: 'Название' },
      { value: 'description', label: 'Описание' },
      { value: 'both', label: 'Название и описание' },
    ],
    value: s.numberingDestination,
    onChange: (value) => {
      setSetting('numberingDestination', value);
      if (onChange) onChange();
    },
  });

  const markerField = createField({
    value: s.numberingMarker,
    placeholder: 'instpoporder-',
    onCommit: (value) => {
      setSetting('numberingMarker', value);
      if (onChange) onChange();
    },
  });

  const startSpinner = createSpinner({
    value: s.numberingStart,
    min: 1,
    width: 110,
    onChange: (value) => {
      setSetting('numberingStart', value);
      if (onChange) onChange();
    },
  });

  const counterOne = createSelect({
    options: [
      { value: 'global', label: 'Общий номер публикации' },
      { value: 'batch', label: 'Номер в текущей загрузке' },
      { value: 'author', label: 'Номер публикации автора' },
      { value: 'type', label: 'Номер публикации этого типа' },
    ],
    value: s.counterOne,
    onChange: (value) => setSetting('counterOne', value),
  });

  const counterTwo = createSelect({
    options: [
      { value: 'carousel', label: 'Номер элемента карусели' },
      { value: 'none', label: 'Не использовать' },
      { value: 'author', label: 'Номер публикации автора' },
      { value: 'type', label: 'Номер публикации этого типа' },
    ],
    value: s.counterTwo,
    onChange: (value) => setSetting('counterTwo', value),
  });

  numberingGrid.append(
    cell('Добавлять в:', destinationSelect.node),
    cell('Текст перед номером:', markerField.node),
    cell('Начальная цифра нумерации:', startSpinner.node),
    cell('Первое число:', counterOne.node),
    cell('Второе число:', counterTwo.node),
  );
  body.appendChild(numberingGrid);

  body.appendChild(el('div', 'rs-divider'));

  /* ---------- Тумблер описания ---------- */
  const descriptionSwitch = createSwitch({
    checked: s.descriptionEnabled,
    label: 'Добавить описание',
    onChange: (value) => {
      setSetting('descriptionEnabled', value);
      descriptionGrid.style.display = value ? '' : 'none';
      if (onChange) onChange();
    },
  });
  const descriptionRow = el('div', 'rs-switch-row');
  descriptionRow.append(
    descriptionSwitch.node,
    descriptionSwitch.labelNode,
    el('span', 'rs-switch-row__gap'),
    createInfo(TIP_DESCRIPTION).node,
  );
  body.appendChild(descriptionRow);

  const descriptionGrid = el('div', 'rs-naming__grid');
  descriptionGrid.style.display = s.descriptionEnabled ? '' : 'none';

  const descriptionDestination = createSelect({
    options: [
      { value: 'description', label: 'Описание' },
      { value: 'name', label: 'Название' },
      { value: 'both', label: 'Название и описание' },
    ],
    value: s.descriptionDestination,
    onChange: (value) => {
      setSetting('descriptionDestination', value);
      if (onChange) onChange();
    },
  });

  const placementGroup = createRadioGroup([
    { value: 'start', label: 'Начало списка' },
    { value: 'end', label: 'Конец списка' },
  ], {
    value: s.descriptionPlacement,
    onChange: (value) => {
      setSetting('descriptionPlacement', value);
      if (onChange) onChange();
    },
  });
  const placementBox = el('div', 'rs-filter-row');
  placementBox.append(
    placementGroup.rowOf('start'),
    placementGroup.rowOf('end'),
  );

  const extraField = createField({
    value: s.extraDescription,
    placeholder: 'Необязательный текст для выбранных публикаций',
    onCommit: (value) => {
      setSetting('extraDescription', value);
      if (onChange) onChange();
    },
  });

  descriptionGrid.append(
    cell('Добавлять в:', descriptionDestination.node),
    cell('Куда добавлять?', placementBox),
    cell('Дополнительное описание:', extraField.node),
  );
  body.appendChild(descriptionGrid);

  root.appendChild(body);

  return {
     node: root,

    setNumberingStart(value) {
      startSpinner.set(value);
    },
  };
}

/* ============================================================
   Нижняя полоса: журнал + кнопка действия
   ============================================================ */
export function buildFooter({ onLog, onAction }) {
  const root = el('div', 'rs-footer');

  const left = el('div', 'rs-footer__left');
  const logButton = createButton({
    label: 'Показать технический журнал',
    onClick: () => { if (onLog) onLog(); },
  });
  left.appendChild(logButton.node);

  const right = el('div', 'rs-footer__right');
  const action = createGlassButton({
    label: 'Начать поиск',
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
        `[${time}] ${message}`);
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
  const title = el('div', 'rs-modal__title', 'Выберите коллекции');
  const list = el('div', 'rs-modal__list rs-scroll');
  const foot = el('div', 'rs-modal__foot');

  const cancel = createGhostButton({
    label: 'Отмена',
    onClick: () => { if (onCancel) onCancel(); },
  });
  const confirm = createGhostButton({
    label: 'Продолжить',
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
    label: 'Закрыть',
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
      title.textContent = nextTitle;
      message.textContent = text;
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
    'Выберите нужные файлы',
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

  let carouselAutoScrollFrame = null;
  let carouselPointerX = 0;
  let carouselPointerY = 0;

  const CAROUSEL_SCROLL_EDGE = 48;
  const CAROUSEL_SCROLL_MAX_SPEED = 18;

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

    summary.textContent =
    `Выбрано файлов: ${selected} из ${availableTotal}`;
  }

  function updateSelection(nextSelection) {
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
  }

  const selectAllButton = createGhostButton({
    label: 'ВЫБРАТЬ ВСЁ',
    onClick: () => {
      if (!currentPost) return;
      updateSelection(
        selectablePositions(selectAll(currentPost)),
      );
    },
  });

  const clearButton = createGhostButton({
    label: 'СНЯТЬ ВСЁ',
    onClick: () => {
      updateSelection(clearSelection());
    },
  });

  const imagesButton = createGhostButton({
    label: 'ЛИШЬ ИЗОБРАЖЕНИЯ',
    onClick: () => {
      if (!currentPost) return;
      updateSelection(
        selectablePositions(imagesOnly(currentPost)),
      );
    },
  });

  const videosButton = createGhostButton({
    label: 'ЛИШЬ ВИДЕО',
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
    'Миниатюры',
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
    label: 'Отмена',
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
            * M1-T08H:
            * во время drag-selection компонент
            * срабатывает по всей площади строки.
            */
            if (
              !selectionGesture.isDragging()
            ) {
              return;
            }

            updateCarouselDragPointer(event);

            visitCarouselComponentDuringDrag(
              componentIndex,
            );
          },
        );

        const isImported =
          currentImported.has(componentIndex);

        row.classList.toggle(
          'is-imported',
          isImported,
        );

        if (isImported) {
         row.setAttribute('aria-disabled', 'true');
          row.title = 'Этот файл уже импортирован в Eagle';
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

            if (event.shiftKey) {
              shiftComponentSelection(
                componentIndex,
                checked,
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

          const image = document.createElement('img');
          image.loading = 'lazy';
          image.src = component.previewUrl;
          image.alt = '';

          image.addEventListener('error', () => {
            thumbnail.classList.add('is-empty');
            image.remove();
          });

          thumbnail.appendChild(image);
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
          display.label,
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
              'Уже в Eagle',
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

