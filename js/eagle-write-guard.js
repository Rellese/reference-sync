// Eagle's native addFromPath cannot be cancelled. Never retry an unresolved write.
const KEY = 'reference-sync.pending-eagle-write.v1';
let active = null;
const message = 'Eagle ещё не подтвердил добавление файла. Очередь остановлена; повторный импорт заблокирован до подтверждения, чтобы не создать дубль.';
export function pendingEagleWrite() {
  if (active) return active;
  const raw = globalThis.localStorage?.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
}
export async function guardedEagleWrite(execute, { item, signal, timeoutMs = 120000, onConfirmed, onLateCreated, onLog } = {}) {
  if (pendingEagleWrite()) throw new Error(message);
  if (signal?.aborted) throw new Error('Импорт остановлен пользователем');
  const pending = { item, startedAt: Date.now() };
  // Store before dispatch. A window reload must not make an uncertain write retryable.
  globalThis.localStorage?.setItem(KEY, JSON.stringify(pending));
  active = pending;
  let detached = false, timer, abort;
  const clear = () => {
    globalThis.localStorage?.removeItem(KEY);
    active = null;
  };
  const operation = Promise.resolve().then(execute).then(async id => {
    pending.id = id;
    globalThis.localStorage?.setItem(KEY, JSON.stringify(pending));
    if (detached) {
      await onLateCreated?.({ id, item });
      onLog?.(`Eagle подтвердил задержанный импорт: ${item.postId}, компонент ${item.component}`);
    }
    else await onConfirmed?.({ id, item });
    clear();
    return id;
  }, error => { clear(); throw error; });
  const boundary = new Promise((resolve, reject) => {
    abort = () => { detached = true; reject(new Error(message)); };
    timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
  try { return await Promise.race([operation, boundary]); }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    // Keep the pending record until the real operation settles, even after timeout.
  }
}

// A completed native write may survive in the journal if the window closed
// between acknowledgement and saving the registry. Its returned ID is proof.
export function recoverAcknowledgedEagleWrite(confirm) {
  if (active) return false;
  const pending = pendingEagleWrite();
  if (!pending?.id) return false;
  confirm({ id: pending.id, item: pending.item });
  globalThis.localStorage?.removeItem(KEY);
  return true;
}

// Old versions sent yt-dlp's intermediate tracks to Eagle. After a reload
// these exact paths can never be retried by the final-file filter. Retire only
// their ledger entry; never alter the library or clear an uncertain final file.
export function retireIntermediateEagleWrite() {
  if (active) return false;
  const pending = pendingEagleWrite();
  const name = String(pending?.item?.path || '').split(/[\\/]/).pop();
  if (!/^\d+\.f[^/]+\.(?:mp4|webm|mkv|m4v)$/i.test(name)) return false;
  globalThis.localStorage?.removeItem(KEY);
  return true;
}
