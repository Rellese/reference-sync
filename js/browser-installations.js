import { nodeApi } from './node-bridge.js';

export const BROWSERS = [
  { value: 'chrome', label: 'Google Chrome', app: 'Google Chrome.app', exe: 'Google/Chrome/Application/chrome.exe' },
  { value: 'yandex', label: 'Яндекс.Браузер', app: 'Yandex.app', exe: 'Yandex/YandexBrowser/Application/browser.exe' },
  { value: 'edge', label: 'Microsoft Edge', app: 'Microsoft Edge.app', exe: 'Microsoft/Edge/Application/msedge.exe' },
  { value: 'firefox', label: 'Firefox', app: 'Firefox.app', exe: 'Mozilla Firefox/firefox.exe' },
  { value: 'safari', label: 'Safari', app: 'Safari.app' },
];

export function installedBrowserOptions({ platform, home, env = {}, exists, join } = {}) {
  return BROWSERS.filter(browser => {
    if (platform === 'darwin') {
      return ['/Applications', join(home, 'Applications'), '/System/Applications']
        .some(root => exists(join(root, browser.app)));
    }
    if (platform === 'win32' && browser.exe) {
      return [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.ProgramFiles, env['ProgramFiles(x86)']]
        .filter(Boolean).some(root => exists(join(root, ...browser.exe.split('/'))));
    }
    return false;
  }).map(({ value, label }) => ({ value, label }));
}

export function discoverInstalledBrowsers() {
  if (!nodeApi.available) return BROWSERS.map(({ value, label }) => ({ value, label }));
  return installedBrowserOptions({
    platform: process.platform, home: nodeApi.os.homedir(), env: process.env,
    exists: file => { try { return nodeApi.fs.existsSync(file); } catch { return false; } },
    join: nodeApi.path.join,
  });
}

export function parseFirefoxProfiles(ini, root, { join, isAbsolute }) {
  const sections = [];
  let current;
  for (const line of String(ini || '').split(/\r?\n/)) {
    if (/^\[Profile\d+\]$/.test(line.trim())) { current = {}; sections.push(current); }
    else if (/^\[/.test(line.trim())) current = null;
    else if (current && line.includes('=')) {
      const pos = line.indexOf('='); current[line.slice(0, pos).trim()] = line.slice(pos + 1).trim();
    }
  }
  return sections.filter(p => p.Path && !p.Path.split(/[\\/]/).includes('..')).map(p => ({
    id: p.IsRelative === '0' && isAbsolute(p.Path) ? p.Path : join(root, p.Path),
    name: p.Name || p.Path, label: p.Name || p.Path, browser: 'firefox', default: p.Default === '1',
  })).sort((a, b) => Number(b.default) - Number(a.default));
}
