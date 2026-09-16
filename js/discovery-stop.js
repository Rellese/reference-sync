/* Stop Link применяется к потоку одной цели ДО группировки и объединения
 * папочных вхождений. Завершается только процесс этой цели, не вся операция.
 * Уже полученные компоненты предыдущей карусели остаются в потоке целиком. */
import { postMatchesStopLink } from './stop-link.js';
import { throwIfAborted } from './job-control.js';

export async function runDiscoveryWithStop(run, args, {
  stopLink,
  recordToPost,
  signal,
  onStdout,
  ...options
} = {}) {
  throwIfAborted(signal);
  if (!stopLink?.ok) return run(args, { ...options, signal, onStdout });

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let carry = '';
  let reached = false;

  function accept(value) {
    if (reached) return;
    if (Array.isArray(value) && typeof value[0] !== 'number') {
      // Компактный dump-массив: каждое сообщение сохраняем отдельно.
      for (const item of value) accept(item);
      return;
    }

    const tuple = Array.isArray(value);
    const isPublication = !tuple || value[0] === 2 || value[0] === 3;
    const record = tuple
      ? value.find((item) => item && typeof item === 'object' && !Array.isArray(item))
      : value;

    if (isPublication && record &&
        postMatchesStopLink(recordToPost(record), stopLink)) {
      reached = true;
      controller.abort();
      return;
    }

    onStdout?.(`${JSON.stringify(value)}\n`);
  }

  function processLine(line) {
    if (!line.trim() || reached) return;
    let value;
    try {
      value = JSON.parse(line);
    } catch (_) {
      // Служебные строки обрабатывает существующий parser источника.
      onStdout?.(`${line}\n`);
      return;
    }
    accept(value);
  }

  try {
    const result = await run(args, {
      ...options,
      signal: controller.signal,
      // Python при pipe может буферизовать stdout: нужна немедленная
      // доставка JSONL, иначе SIGTERM придёт уже после окончания обхода.
      env: { ...options.env, PYTHONUNBUFFERED: '1' },
      onStdout(chunk) {
        if (reached) return;
        carry += String(chunk);
        const lines = carry.split(/\r?\n/);
        carry = lines.pop() || '';
        for (const line of lines) {
          processLine(line);
          if (reached) { carry = ''; break; }
        }
      },
    });
    throwIfAborted(signal); // Ручной Stop всегда имеет приоритет.
    processLine(carry);
    return { ...result, stopLinkReached: reached };
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
