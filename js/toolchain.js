/* ============================================================
   ReferenceSync — toolchain: поиск и автоматическая установка
   движка добычи данных (gallery-dl).

   Проблема, которую решает модуль:
     Eagle запускает плагин НЕ из login-shell, поэтому process.env.PATH
     содержит лишь системный минимум (/usr/bin:/bin:...). Установленный
     через `pip install --user` gallery-dl лежит в ~/.local/bin или
     ~/Library/Python/3.x/bin и в этот PATH не попадает — отсюда
     сообщение «gallery-dl не найден», хотя пакет установлен.

   Стратегия (по порядку, без участия пользователя):
     1. Кэш: ранее найденный путь из ~/.reference-sync/toolchain.json
     2. Приватная установка плагина: ~/.reference-sync/runtime/
     3. Прямой перебор известных каталогов установки (30+ путей)
     4. Опрос login-shell (`zsh -ilc 'command -v gallery-dl'`) —
        так виден PATH, который пользователь видит в терминале
     5. python -m gallery_dl — модуль может быть установлен без
        консольного скрипта в PATH
     6. Установка одной кнопкой: pip install --target в приватную
        папку плагина. Системный Python не трогается, sudo не нужно.

   Ничего не требует от пользователя, кроме нажатия кнопки.
   ============================================================ */

import { nodeApi, runCommand, ensureDir, workRoot, readJson, writeJson } from './node-bridge.js';

const CACHE_FILE = 'toolchain.json';

/* Минимальная версия: ниже неё Instagram-экстрактор уже не работает */
const MIN_VERSION = [1, 26, 0];

/* ------------------------------------------------------------
   Состояние движка, доступное интерфейсу
   ------------------------------------------------------------ */
export const toolchain = {
  ready: false,
  /* 'binary' — исполняемый файл, 'module' — python -m gallery_dl */
  kind: null,
  command: null,
  args: [],
  version: null,
  python: null,
  /* Куда плагин ставит собственную копию */
  runtimeDir: null,
  lastError: null,
};

function isWindows() {
  return nodeApi.available && process.platform === 'win32';
}

function cachePath() {
  if (!nodeApi.available) return null;
  return nodeApi.path.join(workRoot(), CACHE_FILE);
}

function runtimeRoot() {
  if (!nodeApi.available) return null;
  return ensureDir(nodeApi.path.join(workRoot(), 'runtime'));
}

/* ------------------------------------------------------------
   Разбор версии из вывода `gallery-dl --version`
   ------------------------------------------------------------ */
function parseVersion(text) {
  const match = String(text).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function versionAtLeast(version, minimum) {
  if (!version) return false;
  for (let index = 0; index < 3; index += 1) {
    const current = version[index] || 0;
    const required = minimum[index] || 0;
    if (current > required) return true;
    if (current < required) return false;
  }
  return true;
}

export function versionString(version) {
  return Array.isArray(version) ? version.join('.') : String(version || '');
}

/* ------------------------------------------------------------
   Проверка конкретного кандидата: запускаем --version
   ------------------------------------------------------------ */
async function probe(command, args = []) {
  try {
    const result = await runCommand(command, [...args, '--version'], {
      timeout: 20000,
      /* Гарантируем UTF-8 вывод у Python в Windows */
      env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    if (result.code !== 0) return null;
    const version = parseVersion(`${result.stdout} ${result.stderr}`);
    if (!version) return null;
    return version;
  } catch (_) {
    return null;
  }
}

/* ------------------------------------------------------------
   Список каталогов, куда pip/brew/pipx кладут gallery-dl.
   Перенос и расширение whichExecutable() из node-bridge.
   ------------------------------------------------------------ */
function candidateBinaries() {
  if (!nodeApi.available) return [];
  const { path, os, fs } = nodeApi;
  const home = os.homedir();
  const names = isWindows()
    ? ['gallery-dl.exe', 'gallery-dl.cmd', 'gallery-dl']
    : ['gallery-dl'];

  /* Каталог runtime/bin здесь НЕ перечисляется: pip --target кладёт
     туда скрипт-обёртку с shebang системного Python, но без
     PYTHONPATH он падает с ImportError. Приватная установка
     проверяется отдельно — режимом `python -m gallery_dl`. */
  const dirs = [];

  if (isWindows()) {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    dirs.push(path.join(appData, 'Python', 'Scripts'));
    dirs.push(path.join(localAppData, 'Programs', 'Python', 'Scripts'));
    /* Все версии Python в AppData: Python39, Python310, Python312… */
    ['39', '310', '311', '312', '313', '314'].forEach((tag) => {
      dirs.push(path.join(appData, 'Python', `Python${tag}`, 'Scripts'));
      dirs.push(path.join(localAppData, 'Programs', 'Python', `Python${tag}`, 'Scripts'));
    });
    dirs.push(path.join(home, '.local', 'bin'));
  } else {
    dirs.push(
      path.join(home, '.local', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      path.join(home, 'bin'),
      /* pipx */
      path.join(home, '.local', 'pipx', 'venvs', 'gallery-dl', 'bin'),
      /* Framework-Python на macOS */
      '/Library/Frameworks/Python.framework/Versions/Current/bin',
    );
    /* Пользовательские схемы macOS: ~/Library/Python/3.x/bin */
    ['3.9', '3.10', '3.11', '3.12', '3.13', '3.14'].forEach((tag) => {
      dirs.push(path.join(home, 'Library', 'Python', tag, 'bin'));
      dirs.push(`/Library/Frameworks/Python.framework/Versions/${tag}/bin`);
      dirs.push(`/opt/homebrew/opt/python@${tag}/bin`);
    });
  }

  const result = [];
  dirs.forEach((dir) => {
    names.forEach((name) => {
      const file = path.join(dir, name);
      try {
        if (fs.existsSync(file)) result.push(file);
      } catch (_) { /* нет доступа к каталогу */ }
    });
  });
  return result;
}

/* ------------------------------------------------------------
   Опрос login-shell: даёт тот же PATH, что видит пользователь
   в терминале. Именно здесь чаще всего и находится gallery-dl,
   установленный командой pip install --user.
   ------------------------------------------------------------ */
async function askLoginShell(binary = 'gallery-dl') {
  if (!nodeApi.available || isWindows()) return null;

  const shell = process.env.SHELL || '/bin/zsh';
  /* -i делает shell интерактивным: читаются .zshrc / .bashrc,
     где пользователи дописывают PATH. -l читает .zprofile. */
  const script = `command -v ${binary} 2>/dev/null || true`;

  for (const flags of ['-ilc', '-lc', '-ic']) {
    try {
      const result = await runCommand(shell, [flags, script], { timeout: 15000 });
      const line = result.stdout.split(/\r?\n/).map((s) => s.trim())
        .filter(Boolean).pop();
      if (line && nodeApi.fs.existsSync(line)) return line;
    } catch (_) { /* следующий набор флагов */ }
  }
  return null;
}

/* ------------------------------------------------------------
   Поиск интерпретатора Python (нужен для установки и для
   запуска `python -m gallery_dl`)
   ------------------------------------------------------------ */
export async function findPython() {
  if (!nodeApi.available) return null;
  const { path, os, fs } = nodeApi;
  const home = os.homedir();

  const names = isWindows()
    ? ['python.exe', 'python3.exe', 'py.exe']
    : ['python3', 'python'];

  /* 1. PATH процесса */
  for (const name of names) {
    const probeCmd = isWindows() ? 'where' : 'which';
    try {
      const result = await runCommand(probeCmd, [name], { timeout: 8000 });
      const first = result.stdout.split(/\r?\n/).map((s) => s.trim())
        .filter(Boolean)[0];
      if (first && await pythonWorks(first)) return first;
    } catch (_) { /* дальше */ }
  }

  /* 2. Login-shell */
  for (const name of names) {
    const found = await askLoginShell(name);
    if (found && await pythonWorks(found)) return found;
  }

  /* 3. Прямые пути */
  const dirs = isWindows()
    ? [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python'),
      'C:\\Python312', 'C:\\Python311', 'C:\\Python310',
    ]
    : [
      '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin',
      '/Library/Frameworks/Python.framework/Versions/Current/bin',
    ];

  for (const dir of dirs) {
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        if (fs.existsSync(file) && await pythonWorks(file)) return file;
      } catch (_) { /* дальше */ }
    }
  }

  /* 4. Версионные подкаталоги macOS/Linux */
  if (!isWindows()) {
    for (const tag of ['3.13', '3.12', '3.11', '3.10', '3.9']) {
      for (const file of [
        `/opt/homebrew/bin/python${tag}`,
        `/usr/local/bin/python${tag}`,
        `/usr/bin/python${tag}`,
        `/Library/Frameworks/Python.framework/Versions/${tag}/bin/python3`,
      ]) {
        try {
          if (fs.existsSync(file) && await pythonWorks(file)) return file;
        } catch (_) { /* дальше */ }
      }
    }
  }

  return null;
}

async function pythonWorks(file) {
  try {
    const result = await runCommand(file, ['-c', 'import sys;print(sys.version_info[:2])'], {
      timeout: 12000,
    });
    if (result.code !== 0) return false;
    /* gallery-dl требует Python 3.8+ */
    const match = result.stdout.match(/\((\d+),\s*(\d+)\)/);
    if (!match) return false;
    return Number(match[1]) === 3 && Number(match[2]) >= 8;
  } catch (_) {
    return false;
  }
}

/* ------------------------------------------------------------
   Главная функция: найти рабочий gallery-dl
   ------------------------------------------------------------ */
export async function detectToolchain({ onLog } = {}) {
  const log = (message) => { if (onLog) onLog(message); };

  toolchain.ready = false;
  toolchain.lastError = null;

  if (!nodeApi.available) {
    toolchain.lastError = 'node-unavailable';
    return toolchain;
  }

  const runtime = runtimeRoot();
  toolchain.runtimeDir = runtime;

  /* --- 1. Кэш прошлого успешного запуска.
     Для варианта «модуль» проверка обязательно идёт с PYTHONPATH,
     иначе своя же установка выглядит нерабочей. --- */
  const cached = readJson(cachePath(), null);
  if (cached?.command) {
    const version = cached.pythonPath
      ? await probeModule(cached.command, cached.pythonPath)
      : await probe(cached.command, cached.args || []);

    if (version && versionAtLeast(version, MIN_VERSION)) {
      applyFound(
        cached.kind || 'binary',
        cached.command,
        cached.args || [],
        version,
        cached.pythonPath || null,
      );
      log(`Движок готов (запомнен ранее): gallery-dl ${versionString(version)}`);
      return toolchain;
    }
    log('Записанный ранее путь к gallery-dl больше не работает — ищем заново');
  }

  /* --- 2. Приватная установка плагина (наш собственный runtime).
     Проверяется первой: это единственный вариант, который плагин
     полностью контролирует и может обновить сам. --- */
  const pythonEarly = await findPython();
  if (pythonEarly && runtimeHasPackage(runtime)) {
    toolchain.python = pythonEarly;
    const own = await probeModule(pythonEarly, runtime);
    if (own && versionAtLeast(own, MIN_VERSION)) {
      applyFound('module', pythonEarly, ['-m', 'gallery_dl'], own, runtime);
      log(`Движок плагина готов: gallery-dl ${versionString(own)}`);
      return toolchain;
    }
  }

  /* --- 3. Известные каталоги установки --- */
  for (const file of candidateBinaries()) {
    const version = await probe(file);
    if (version && versionAtLeast(version, MIN_VERSION)) {
      applyFound('binary', file, [], version);
      log(`Движок найден: ${file} ${versionString(version)}`);
      return toolchain;
    }
  }

  /* --- 4. PATH процесса --- */
  const probeCmd = isWindows() ? 'where' : 'which';
  for (const name of isWindows() ? ['gallery-dl.exe', 'gallery-dl'] : ['gallery-dl']) {
    try {
      const result = await runCommand(probeCmd, [name], { timeout: 8000 });
      const first = result.stdout.split(/\r?\n/).map((s) => s.trim())
        .filter(Boolean)[0];
      if (!first) continue;
      const version = await probe(first);
      if (version && versionAtLeast(version, MIN_VERSION)) {
        applyFound('binary', first, [], version);
        log(`Движок найден в PATH: ${first} ${versionString(version)}`);
        return toolchain;
      }
    } catch (_) { /* дальше */ }
  }

  /* --- 5. Login-shell: PATH пользователя --- */
  const fromShell = await askLoginShell('gallery-dl');
  if (fromShell) {
    const version = await probe(fromShell);
    if (version && versionAtLeast(version, MIN_VERSION)) {
      applyFound('binary', fromShell, [], version);
      log(`Движок найден через оболочку входа: ${fromShell} ${versionString(version)}`);
      return toolchain;
    }
  }

  /* --- 6. Глобально установленный модуль python -m gallery_dl --- */
  const python = pythonEarly || await findPython();
  toolchain.python = python;
  if (python) {
    log(`Найден Python: ${python}`);

    const globalVersion = await probe(python, ['-m', 'gallery_dl']);
    if (globalVersion && versionAtLeast(globalVersion, MIN_VERSION)) {
      applyFound('module', python, ['-m', 'gallery_dl'], globalVersion);
      log(`Движок найден как модуль Python ${versionString(globalVersion)}`);
      return toolchain;
    }
  } else {
    log('Python в системе не найден');
  }

  toolchain.lastError = python ? 'not-installed' : 'no-python';
  return toolchain;
}

/* Установлен ли пакет в приватной папке плагина.
   Без этой проверки `python -m gallery_dl` может отработать
   за счёт глобальной установки, и плагин ошибочно решит,
   что готова именно его собственная копия. */
function runtimeHasPackage(runtimeDir) {
  if (!runtimeDir || !nodeApi.available) return false;
  const { fs, path } = nodeApi;
  return fs.existsSync(path.join(runtimeDir, 'gallery_dl', '__init__.py'))
    || fs.existsSync(path.join(runtimeDir, 'gallery_dl'));
}

async function probeModule(python, runtimeDir) {
  if (!runtimeDir) return null;
  try {
    const result = await runCommand(python, ['-m', 'gallery_dl', '--version'], {
      timeout: 20000,
      env: {
        PYTHONPATH: runtimeDir,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });
    if (result.code !== 0) return null;
    return parseVersion(`${result.stdout} ${result.stderr}`);
  } catch (_) {
    return null;
  }
}

function applyFound(kind, command, args, version, pythonPath = null) {
  toolchain.ready = true;
  toolchain.kind = kind;
  toolchain.command = command;
  toolchain.args = args;
  toolchain.version = version;
  toolchain.pythonPath = pythonPath;
  toolchain.lastError = null;

  writeJson(cachePath(), {
    kind, command, args, version, pythonPath,
    savedAt: new Date().toISOString(),
  });
}

/* ------------------------------------------------------------
   Переменные окружения для запуска движка
   ------------------------------------------------------------ */
export function toolchainEnv() {
  const env = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
  if (toolchain.pythonPath) env.PYTHONPATH = toolchain.pythonPath;
  return env;
}

/* ------------------------------------------------------------
   Установка движка в приватную папку плагина.
   Ни sudo, ни изменения системного Python: pip --target
   раскладывает пакет в ~/.reference-sync/runtime, откуда
   запуск идёт через PYTHONPATH.
   ------------------------------------------------------------ */
export async function installToolchain({ onLog, onProgress, signal } = {}) {
  const log = (message, kind) => { if (onLog) onLog(message, kind); };
  const step = (stage, percent) => { if (onProgress) onProgress({ stage, percent }); };

  if (!nodeApi.available) {
    throw new Error('Установка доступна только внутри Eagle');
  }

  step('python', 5);
  let python = toolchain.python || await findPython();

  if (!python) {
    throw new Error('NO_PYTHON');
  }
  toolchain.python = python;
  log(`Используется Python: ${python}`);

  const runtime = runtimeRoot();
  step('pip', 15);

  /* pip может отсутствовать (в некоторых сборках Python).
     ensurepip восстанавливает его без сети. */
  const pipCheck = await runCommand(python, ['-m', 'pip', '--version'], {
    timeout: 30000, signal,
  }).catch(() => ({ code: 1 }));

  if (pipCheck.code !== 0) {
    log('pip не найден, восстанавливаем через ensurepip…', 'warn');
    await runCommand(python, ['-m', 'ensurepip', '--upgrade'], {
      timeout: 180000, signal,
      onStdout: (chunk) => log(chunk.trim()),
    }).catch(() => null);
  }

  step('download', 30);
  log('Загрузка gallery-dl из репозитория PyPI…');

  /* --target ставит пакет в отдельную папку.
     --upgrade перезаписывает старую версию.
     --no-warn-script-location убирает лишние предупреждения. */
  const args = [
    '-m', 'pip', 'install',
    '--upgrade',
    '--no-input',
    '--disable-pip-version-check',
    '--no-warn-script-location',
    '--target', runtime,
    'gallery-dl',
  ];

  let output = '';
  const result = await runCommand(python, args, {
    timeout: 600000,
    signal,
    env: { PIP_DISABLE_PIP_VERSION_CHECK: '1', PYTHONIOENCODING: 'utf-8' },
    onStdout: (chunk) => {
      output += chunk;
      chunk.split(/\r?\n/).forEach((line) => {
        const text = line.trim();
        if (!text) return;
        log(text);
        if (/downloading/i.test(text)) step('download', 55);
        if (/installing collected/i.test(text)) step('install', 80);
      });
    },
    onStderr: (chunk) => {
      output += chunk;
      const text = chunk.trim();
      if (text) log(text, 'warn');
    },
  });

  if (result.code !== 0) {
    if (/network|timed out|ssl|resolve|proxy/i.test(output)) {
      throw new Error('NETWORK');
    }
    throw new Error(`PIP_FAILED:${result.code}`);
  }

  step('verify', 90);

  /* Проверяем, что установленное действительно запускается */
  const version = await probeModule(python, runtime);
  if (!version) {
    throw new Error('VERIFY_FAILED');
  }
  if (!versionAtLeast(version, MIN_VERSION)) {
    throw new Error(`TOO_OLD:${versionString(version)}`);
  }

  applyFound('module', python, ['-m', 'gallery_dl'], version, runtime);
  step('done', 100);
  log(`gallery-dl ${versionString(version)} установлен в папку плагина`, 'ok');

  return toolchain;
}

/* ------------------------------------------------------------
   Обновление уже установленного движка
   ------------------------------------------------------------ */
export async function updateToolchain(options = {}) {
  return installToolchain(options);
}

/* ------------------------------------------------------------
   Запуск движка с текущими настройками
   ------------------------------------------------------------ */
export function galleryArgs(extra = []) {
  return [...toolchain.args, ...extra];
}

export function requireToolchain() {
  if (!toolchain.ready) {
    const error = new Error('TOOLCHAIN_MISSING');
    error.code = 'TOOLCHAIN_MISSING';
    throw error;
  }
  return toolchain;
}

/* Единая точка запуска движка: сам подставляет команду,
   аргументы модуля и переменные окружения (PYTHONPATH).
   Все места плагина обращаются к gallery-dl только так. */
export function runGallery(extra = [], options = {}) {
  requireToolchain();
  return runCommand(toolchain.command, galleryArgs(extra), {
    ...options,
    env: { ...toolchainEnv(), ...(options.env || {}) },
  });
}

/* ------------------------------------------------------------
   Тексты ошибок для интерфейса.
   Технические коды (NO_PYTHON, NETWORK, PIP_FAILED:2 …)
   превращаются в понятные пользователю подсказки.
   ------------------------------------------------------------ */
export function describeToolchainError(error) {
  const raw = typeof error === 'string' ? error : (error?.message || '');
  const code = raw.split(':')[0];
  const detail = raw.slice(code.length + 1);

  switch (code) {
    case 'TOOLCHAIN_MISSING':
      return {
        title: 'Движок загрузки не подготовлен',
        text: 'Нажмите «Подготовить движок» — плагин скачает всё '
          + 'необходимое сам. Терминал не потребуется.',
        action: 'install',
      };
    case 'NO_PYTHON':
      return {
        title: 'Не найден Python',
        text: isWindows()
          ? 'Установите Python с python.org (при установке отметьте '
            + '«Add python.exe to PATH») и нажмите «Подготовить движок» снова.'
          : 'Установите Python 3 (на macOS — команда «xcode-select --install» '
            + 'или пакет с python.org) и повторите подготовку.',
        action: 'retry',
      };
    case 'NETWORK':
      return {
        title: 'Нет доступа к интернету',
        text: 'Не удалось связаться с репозиторием PyPI. Проверьте '
          + 'подключение, VPN или настройки прокси и повторите.',
        action: 'retry',
      };
    case 'PIP_FAILED':
      return {
        title: 'Установка не завершилась',
        text: `Менеджер пакетов вернул код ${detail || '1'}. Подробности — `
          + 'в журнале внизу окна.',
        action: 'retry',
      };
    case 'VERIFY_FAILED':
      return {
        title: 'Движок установлен, но не запускается',
        text: 'Файлы загружены, однако проверочный запуск не прошёл. '
          + 'Попробуйте подготовить движок ещё раз.',
        action: 'retry',
      };
    case 'TOO_OLD':
      return {
        title: 'Версия движка устарела',
        text: `Установлена версия ${detail}, а нужна не ниже `
          + `${versionString(MIN_VERSION)}. Повторите подготовку.`,
        action: 'retry',
      };
    default:
      return {
        title: 'Ошибка подготовки движка',
        text: raw || 'Неизвестная ошибка.',
        action: 'retry',
      };
  }
}
