/* ============================================================
   ReferenceSync — реестр источников

   Перенос контракта из Python:
     app/source_adapter.py  → описание источника (SourceAdapter)
     app/source_registry.py → регистрация и поиск по коду

   Зачем: чтобы подключить новую соцсеть, НЕ нужно править
   общий код. Достаточно добавить один файл в js/sources/ и
   одну строку в js/sources/index.js. Всё остальное — таблица,
   имена, импорт в Eagle, прогресс-бар — работает через этот
   единый контракт.

   ------------------------------------------------------------
   Контракт источника (все поля описания):

     code              строка [a-z][a-z0-9_-]{1,31}, уникальна
     title             имя для интерфейса («Instagram»)
     icon              имя файла в assets/icons/<icon>.svg
     ready             true → источник работает, false → заготовка
     containerTypes    иерархия контейнеров, первый всегда 'ROOT'
                       Instagram: ROOT → ACCOUNT → COLLECTION
                       Pinterest: ROOT → BOARD  → SECTION
     containerLabels   как называть контейнеры в интерфейсе
     sourceModes       откуда брать список: 'browser' | 'archive'
     needsAccount      нужен ли ник пользователя
     needsBrowser      нужны ли cookies браузера
     defaultTags       теги, которые уйдут в Eagle
     nameMarker        метка порядка в имени (instpoporder и т.п.)
     jobPrefix         префикс папки временных файлов
     urlPattern        RegExp: распознать ссылку этого источника
     galleryTarget     что передавать gallery-dl вместо URL,
                       если у источника особый формат цели

   Методы источника (реализуются в модуле источника):

     discover(options)  → { posts, stoppedEarly }
     download(options)  → { stagingRoot, results }
     probe()            → { ok, reason } — быстрая проверка
                          готовности (необязательный)
   ============================================================ */

/* Код от 1 до 32 символов: у X код односимвольный («x»), поэтому
   хвост допускает нулевую длину. */
const CODE_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const MARKER_RE = /^[a-z][a-z0-9_-]{1,63}$/;

export class SourceError extends Error {
  constructor(message, code = 'SOURCE_ERROR') {
    super(message);
    this.code = code;
  }
}

/* Хранилище: code → описание. Порядок регистрации сохраняется,
   потому что от него зависит порядок кнопок соцсетей. */
const registry = new Map();

/* ------------------------------------------------------------
   Проверка описания. Строгая — как в Python-версии, чтобы
   ошибка в новом модуле обнаружилась сразу, а не при работе.
   ------------------------------------------------------------ */
function validate(descriptor) {
  const code = String(descriptor.code || '').trim().toLowerCase();
  if (!CODE_RE.test(code)) {
    throw new SourceError(`Некорректный код источника: ${descriptor.code}`);
  }

  const title = String(descriptor.title || '').trim();
  if (!title) throw new SourceError(`Источник ${code}: пустое имя`);

  const types = (descriptor.containerTypes || ['ROOT'])
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean);
  if (!types.length || types[0] !== 'ROOT') {
    throw new SourceError(
      `Источник ${code}: containerTypes должен начинаться с ROOT`);
  }
  if (new Set(types).size !== types.length) {
    throw new SourceError(`Источник ${code}: дубликаты в containerTypes`);
  }

  const marker = String(descriptor.nameMarker || `${code}order`)
    .trim().toLowerCase();
  if (!MARKER_RE.test(marker)) {
    throw new SourceError(`Источник ${code}: некорректная метка ${marker}`);
  }

  const modes = (descriptor.sourceModes || ['browser'])
    .map((value) => String(value || '').trim())
    .filter((value) => value === 'browser' || value === 'archive');
  if (!modes.length) {
    throw new SourceError(`Источник ${code}: нет ни одного режима источника`);
  }

  /* Рабочий источник обязан уметь искать и скачивать */
  const ready = Boolean(descriptor.ready);
  if (ready) {
    if (typeof descriptor.discover !== 'function') {
      throw new SourceError(`Источник ${code}: нет discover()`);
    }
    if (typeof descriptor.download !== 'function') {
      throw new SourceError(`Источник ${code}: нет download()`);
    }
  }

  return {
    code,
    title,
    icon: String(descriptor.icon || code),
    ready,
    containerTypes: types,
    containerLabels: {
      /* Разумные значения по умолчанию: подписи в модалке выбора */
      root: 'Всё сохранённое',
      level1: 'Аккаунт',
      level2: 'Коллекция',
      ...(descriptor.containerLabels || {}),
    },
    sourceModes: modes,
    needsAccount: descriptor.needsAccount !== false,
    needsBrowser: descriptor.needsBrowser !== false,
    defaultTags: Array.from(new Set(
      (descriptor.defaultTags || [title]).map((v) => String(v).trim())
        .filter(Boolean),
    )),
    nameMarker: marker,
    jobPrefix: String(descriptor.jobPrefix || code).trim(),
    urlPattern: descriptor.urlPattern || null,
    galleryTarget: descriptor.galleryTarget || null,
    /* Причина, по которой источник ещё не готов — покажем в подсказке */
    notReadyReason: descriptor.notReadyReason
      || 'Источник появится в следующих версиях плагина',

    /* Методы */
    discover: descriptor.discover || null,
    download: descriptor.download || null,
    listContainers: descriptor.listContainers || null,
    probe: descriptor.probe || null,
  };
}

/* ------------------------------------------------------------
   Регистрация. Повторная регистрация того же кода заменяет
   прежнее описание — так удобно подменять источник в тестах.
   ------------------------------------------------------------ */
export function registerSource(descriptor) {
  const entry = validate(descriptor);
  registry.set(entry.code, entry);
  return entry;
}

export function getSource(code) {
  const key = String(code || '').trim().toLowerCase();
  const entry = registry.get(key);
  if (!entry) {
    const known = [...registry.keys()].join(', ');
    throw new SourceError(
      `Неизвестный источник «${code}». Доступны: ${known}`,
      'UNKNOWN_SOURCE');
  }
  return entry;
}

export function hasSource(code) {
  return registry.has(String(code || '').trim().toLowerCase());
}

/* Все источники в порядке регистрации */
export function listSources() {
  return [...registry.values()];
}

/* Только рабочие */
export function readySources() {
  return listSources().filter((entry) => entry.ready);
}

/* Определить источник по ссылке — нужно для будущего
   «вставьте ссылку» и для разбора архивов */
export function detectSourceByUrl(url) {
  const text = String(url || '');
  return listSources().find((entry) => entry.urlPattern
    && entry.urlPattern.test(text)) || null;
}

/* Для тестов */
export function resetRegistry() {
  registry.clear();
}
