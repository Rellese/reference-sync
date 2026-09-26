// A CDN 404/403 is not proof that the source publication was deleted.
export function downloadIssue(text) {
  const raw = String(text || '');
  const unavailable = /NotFoundError[^\n]*(?:pin|post)|(?:pin|post)[^\n]*(?:not found|does not exist|was deleted)/i.test(raw);
  const detail = raw.split(/\r?\n/).filter(line => /error|failed|not found|403|404|429/i.test(line)).slice(-3).join(' ').slice(-1200) || raw.slice(-1200);
  return { unavailable, detail, label: unavailable ? 'Недоступно у источника' : 'Ошибка загрузки — можно повторить' };
}

export function summarizeImportOutcome(posts, known, records, created) {
  const ids = new Set(posts.map(post => post.postId));
  let complete = 0, partial = 0;
  for (const id of ids) {
    if (known.has(id)) complete++;
    else if (records.get(id)?.components?.size) partial++;
  }
  return { total: ids.size, complete, partial, notImported: ids.size - complete - partial,
    remaining: ids.size - complete, files: created.length, touched: new Set(created.map(entry => entry.item.postId)).size };
}
