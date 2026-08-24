/* ============================================================
   ReferenceSync — профили браузеров

   Читает только безопасные метаданные Chromium:
   - отображаемое имя профиля;
   - почту аккаунта браузера;
   - внутренний ID каталога.

   Cookies здесь не читаются и не сохраняются.
   ============================================================ */

import { nodeApi, readJson } from './node-bridge.js';

const BROWSER_ALIASES = {
  'google chrome': 'chrome',
  'google-chrome': 'chrome',
  'яндекс': 'yandex',
  'яндекс.браузер': 'yandex',
  'yandex browser': 'yandex',
  'microsoft edge': 'edge',
};

export function normalizeBrowserName(browser) {
  const name = String(browser || '').trim().toLowerCase();
  return BROWSER_ALIASES[name] || name;
}

function textValue(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

/* Разбирает profile.info_cache из Chromium Local State.
   В результате остаются только данные, которые можно безопасно
   показывать пользователю. */
export function parseChromiumProfileCache(localState) {
  const cache = localState?.profile?.info_cache;

  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) {
    return [];
  }

  return Object.entries(cache)
    .filter(([, entry]) =>
      entry && typeof entry === 'object' && !Array.isArray(entry))
    .map(([id, entry]) => ({
      id,
      /* name — имя, показываемое самим браузером.
         gaia_name используется только как запасной вариант. */
      name: textValue(entry.name, entry.gaia_name, id),
      email: textValue(entry.user_name),
    }));
}

export function buildBrowserProfileLabel(profile) {
  const name = textValue(profile?.name, profile?.id, 'Профиль браузера');
  const email = textValue(profile?.email);

  if (!email || email.toLowerCase() === name.toLowerCase()) {
    return name;
  }

  return `${name} — ${email}`;
}

export function shouldShowProfileSelector(profiles) {
  return Array.isArray(profiles) && profiles.length > 1;
}

function browserRoot(browser) {
  if (!nodeApi.available) return null;

  const normalized = normalizeBrowserName(browser);
  const { path, os } = nodeApi;
  const home = os.homedir();

  if (process.platform === 'darwin') {
    const applicationSupport = path.join(
      home,
      'Library',
      'Application Support',
    );

    const roots = {
      chrome: path.join(applicationSupport, 'Google', 'Chrome'),
      yandex: path.join(
        applicationSupport,
        'Yandex',
        'YandexBrowser',
      ),
      edge: path.join(applicationSupport, 'Microsoft Edge'),
    };

    return roots[normalized] || null;
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return null;

    const roots = {
      chrome: path.join(
        localAppData,
        'Google',
        'Chrome',
        'User Data',
      ),
      yandex: path.join(
        localAppData,
        'Yandex',
        'YandexBrowser',
        'User Data',
      ),
      edge: path.join(
        localAppData,
        'Microsoft',
        'Edge',
        'User Data',
      ),
    };

    return roots[normalized] || null;
  }

  const config = process.env.XDG_CONFIG_HOME ||
    path.join(home, '.config');

  const roots = {
    chrome: path.join(config, 'google-chrome'),
    yandex: path.join(config, 'yandex-browser'),
    edge: path.join(config, 'microsoft-edge'),
  };

  return roots[normalized] || null;
}

function profileExists(root, id) {
  if (!nodeApi.available || !root || !id) return false;

  const { fs, path } = nodeApi;
  const profilePath = path.join(root, id);

  try {
    if (!fs.existsSync(profilePath)) return false;

    return fs.existsSync(path.join(profilePath, 'Preferences')) ||
      fs.existsSync(path.join(profilePath, 'Cookies')) ||
      fs.existsSync(path.join(profilePath, 'Network', 'Cookies'));
  } catch (_) {
    return false;
  }
}

/* Находит реальные профили установленного Chromium-браузера.
   Firefox и Safari пока возвращают пустой список: у них другой
   формат профилей, который нельзя смешивать с Chromium. */
export function discoverBrowserProfiles(browser) {
  if (!nodeApi.available) return [];

  const normalized = normalizeBrowserName(browser);

  if (!['chrome', 'yandex', 'edge'].includes(normalized)) {
    return [];
  }

  const root = browserRoot(normalized);
  if (!root) return [];

  const localState = readJson(
    nodeApi.path.join(root, 'Local State'),
    null,
  );

  return parseChromiumProfileCache(localState)
    .filter((profile) => profileExists(root, profile.id))
    .map((profile) => ({
      ...profile,
      browser: normalized,
      label: buildBrowserProfileLabel(profile),
    }));
}

function safeProfileId(profileId) {
  const id = String(profileId || '').trim();
  if (!id) return '';

  /* ID приходит из Local State и должен быть именем одного каталога,
     а не произвольным внешним путём. */
  if (id.includes('/') || id.includes('\\') || id === '..') {
    return '';
  }

  return id;
}

/* Формирует значение --cookies-from-browser.
   Для Yandex gallery-dl получает путь к Chromium-профилю,
   поскольку отдельного Yandex-адаптера у него нет. */
export function buildCookieSpec({
  browser,
  profileId,
  profileRoot = '',
} = {}) {
  const normalized = normalizeBrowserName(browser);
  const safeId = safeProfileId(profileId);

  if (!safeId) return normalized;

  if (normalized === 'yandex') {
    const root = String(profileRoot || '').replace(/[\\/]+$/, '');
    if (!root) return 'chrome';

    const separator = root.includes('\\') ? '\\' : '/';
    return `chrome:${root}${separator}${safeId}`;
  }

  return `${normalized}:${safeId}`;
}

export function browserCookieSpecForProfile(browser, profileId) {
  const normalized = normalizeBrowserName(browser);
  const root = browserRoot(normalized);

  return buildCookieSpec({
    browser: normalized,
    profileId,
    profileRoot: root || '',
  });
}
