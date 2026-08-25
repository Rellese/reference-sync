function normalizeCount(value) {
  const count = Number(value) || 0;
  return Math.max(0, Math.trunc(count));
}

function pluralize(count, forms) {
  const absolute = Math.abs(count) % 100;
  const lastDigit = absolute % 10;

  if (absolute >= 11 && absolute <= 19) {
    return forms[2];
  }

  if (lastDigit === 1) return forms[0];
  if (lastDigit >= 2 && lastDigit <= 4) return forms[1];

  return forms[2];
}

export function buildImportSummary({
  postCount,
  elementCount,
}) {
  const posts = normalizeCount(postCount);
  const elements = normalizeCount(elementCount);

  const postText =
    `${posts} ${pluralize(posts, [
      'публикация',
      'публикации',
      'публикаций',
    ])}`;

  const elementText =
    `${elements} ${pluralize(elements, [
      'элемент',
      'элемента',
      'элементов',
    ])}`;

  return {
    status: `Импортировано в Eagle: ${elementText}`,
    detail: `${postText} / ${elementText}`,
    trail: `Добавлено: ${postText} / ${elementText}`,
    interest: `${posts} ПУБ. / ${elements} ЭЛ.`,
  };
}

export function allPostsImported(posts, knownPostIds) {
  const list = Array.isArray(posts) ? posts : [];
  const known = knownPostIds || new Set();

  return (
    list.length > 0 &&
    list.every((post) => known.has(post.postId))
  );
}
