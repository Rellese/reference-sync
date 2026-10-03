// Shared contract for all source adapters. Unknown/network failures are not a mismatch.
export function assertMatchingAccount(session, { platform, title, username, browser = '' }) {
  const actual = String(session?.username || '').trim().replace(/^@+/, '');
  const expected = String(username || '').trim().replace(/^@+/, '');
  let kind, message;
  if (!session?.authenticated || !actual) {
    kind = session?.status === 'signed-out' ? 'SESSION_INVALID' : 'SESSION_UNVERIFIED';
    message = kind === 'SESSION_INVALID'
      ? `В выбранном профиле браузера вход в ${title} не выполнен. Войдите в нужный аккаунт и повторите поиск.`
      : `Не удалось проверить аккаунт ${title} в выбранном профиле браузера. Проверьте вход и соединение, затем повторите поиск.`;
  } else if (expected && actual.toLowerCase() !== expected.toLowerCase()) {
    kind = 'ACCOUNT_MISMATCH';
    message = `В выбранном профиле браузера ${browser} в ${title} авторизован @${actual}, а указан @${expected}. Выберите профиль с нужным аккаунтом либо исправьте логин.`;
  }
  if (kind) {
    const error = new Error(message);
    Object.assign(error, { code: `${platform.toUpperCase()}_${kind}`, sourceTitle: title });
    throw error;
  }
  return session;
}
export function sessionErrorTitle(error) {
  const match = String(error?.code || '').match(/^([A-Z]+)_(ACCOUNT_MISMATCH|SESSION_INVALID|SESSION_UNVERIFIED)$/);
  if (!match) return null;
  const title = error.sourceTitle || ({ INSTAGRAM: 'Instagram', PINTEREST: 'Pinterest', BEHANCE: 'Behance' })[match[1]] || match[1];
  return match[2] === 'ACCOUNT_MISMATCH' ? `Выбран другой ${title}-аккаунт`
    : match[2] === 'SESSION_INVALID' ? `Необходимо войти в ${title}` : `Не удалось проверить аккаунт ${title}`;
}
