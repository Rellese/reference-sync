/* ============================================================
   ReferenceSync — распознавание Stop Link

   Stop Link задаёт границу поиска:
     • публикация по этой ссылке не включается в результат;
     • публикации после неё не проверяются;
     • исходный URL пользователя не изменяется.

   Placeholder интерфейса — только подсказка. Он никогда не
   добавляется к введённому значению автоматически.
   ============================================================ */

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeId(value) {
  return clean(value).replace(/^\/+|\/+$/g, '');
}

function isHostOrSubdomain(hostname, domain) {
  const host = clean(hostname).toLowerCase();
  const base = clean(domain).toLowerCase();

  return host === base || host.endsWith(`.${base}`);
}

const SOURCE_RULES = [
  {
    code: 'instagram',
    placeholderPrefix: 'https://www.instagram.com/p/',
    matchesHost: (hostname) =>
      isHostOrSubdomain(hostname, 'instagram.com'),
    extractId: (pathname) => {
      const match = pathname.match(
        /^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)(?:\/|$)/i,
      );

      return match ? match[1] : '';
    },
  },
  {
    code: 'pinterest',
    placeholderPrefix: 'https://www.pinterest.com/pin/',
    matchesHost: (hostname) =>
      isHostOrSubdomain(hostname, 'pinterest.com'),
    extractId: (pathname) => {
      const match = pathname.match(
        /^\/pin\/(\d+)(?:\/|$)/i,
      );

      return match ? match[1] : '';
    },
  },
  {
    code: 'dribbble',
    placeholderPrefix: 'https://dribbble.com/shots/',
    matchesHost: (hostname) =>
      isHostOrSubdomain(hostname, 'dribbble.com'),
    extractId: (pathname) => {
      const match = pathname.match(
        /^\/shots\/(\d+)(?:[-/]|$)/i,
      );

      return match ? match[1] : '';
    },
  },
  {
    code: 'behance',
    placeholderPrefix: 'https://www.behance.net/gallery/',
    matchesHost: (hostname) =>
      isHostOrSubdomain(hostname, 'behance.net'),
    extractId: (pathname) => {
      const match = pathname.match(
        /^\/gallery\/(\d+)(?:\/|$)/i,
      );

      return match ? match[1] : '';
    },
  },
  {
    code: 'vimeo',
    placeholderPrefix: 'https://vimeo.com/',
    matchesHost: (hostname) =>
      isHostOrSubdomain(hostname, 'vimeo.com'),
    extractId: (pathname) => {
      const parts = pathname
        .split('/')
        .map(normalizeId)
        .filter(Boolean);

      return [...parts]
        .reverse()
        .find((part) => /^\d+$/.test(part)) || '';
    },
  },
  {
    code: 'x',
    placeholderPrefix: 'https://x.com/user/status/',
    matchesHost: (hostname) =>
      isHostOrSubdomain(hostname, 'x.com') ||
      isHostOrSubdomain(hostname, 'twitter.com'),
    extractId: (pathname) => {
      const match = pathname.match(
        /^\/[^/]+\/status\/(\d+)(?:\/|$)/i,
      );

      return match ? match[1] : '';
    },
  },
];

function findRuleByCode(sourceCode) {
  const code = clean(sourceCode).toLowerCase();

  return SOURCE_RULES.find(
    (rule) => rule.code === code,
  ) || null;
}

function findRuleByHost(hostname) {
  return SOURCE_RULES.find(
    (rule) => rule.matchesHost(hostname),
  ) || null;
}

export function stopLinkPlaceholder(sourceCode) {
  return findRuleByCode(sourceCode)?.placeholderPrefix || 'https://';
}

export function parseStopLink(
  value,
  expectedSourceCode = '',
) {
  const originalUrl = clean(value);

  if (!originalUrl) {
    return {
      ok: false,
      code: 'empty',
      message: 'Вставьте ссылку на публикацию.',
    };
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(originalUrl);
  } catch (_) {
    return {
      ok: false,
      code: 'invalid_url',
      message: 'Вставьте полную ссылку, начинающуюся с http:// или https://.',
    };
  }

  if (
    parsedUrl.protocol !== 'https:' &&
    parsedUrl.protocol !== 'http:'
  ) {
    return {
      ok: false,
      code: 'invalid_protocol',
      message: 'Ссылка должна начинаться с http:// или https://.',
    };
  }

  const rule = findRuleByHost(parsedUrl.hostname);

  if (!rule) {
    return {
      ok: false,
      code: 'unsupported_source',
      message: 'Не удалось определить социальную сеть по этой ссылке.',
    };
  }

  const expectedCode = clean(
    expectedSourceCode,
  ).toLowerCase();

  if (expectedCode && rule.code !== expectedCode) {
    return {
      ok: false,
      code: 'source_mismatch',
      sourceCode: rule.code,
      expectedSourceCode: expectedCode,
      message: 'Ссылка относится к другой социальной сети.',
    };
  }

  const publicationId = normalizeId(
    rule.extractId(parsedUrl.pathname),
  );

  if (!publicationId) {
    return {
      ok: false,
      code: 'invalid_publication_url',
      sourceCode: rule.code,
      message: 'Вставьте ссылку непосредственно на публикацию.',
    };
  }

  return {
    ok: true,
    sourceCode: rule.code,
    publicationId,
    url: originalUrl,
  };
}

export function sameStopPublication(
  left,
  right,
) {
  if (!left?.ok || !right?.ok) return false;

  return (
    left.sourceCode === right.sourceCode &&
    normalizeId(left.publicationId) ===
      normalizeId(right.publicationId)
  );
}
