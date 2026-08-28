/* ============================================================
   ReferenceSync — управление длительной задачей

   Даёт три вещи, которых требуют макеты прогресс-бара:

   1. Пауза / продолжение / полная остановка
      (Instruction/Scale Download paused: «прогресс бар остановится
      и в цифре и визуально там где он закончил, как только
      пользователь тыкнет плэй всё продолжится. Если тыкнет стоп
      окончательно — сменится на 4 прогресс бар»).

   2. Ожидание восстановления связи с растущей паузой
      (Instruction/Scale Connection lost: «сначала 5 сек, потом они
      растут и максимум это 30 сек… на случай если пользователь
      пользуется впн и ему надо переподключиться, чтобы плагин
      не ломал очередь»).

   3. Распознавание сетевых сбоев, чтобы отличать «нет связи»
      от «Instagram отказал».
   ============================================================ */

/* Лестница пауз восстановления связи, секунды (5 → 30) */
export const RETRY_STEPS = [5, 10, 15, 20, 25, 30];

/* Особая причина остановки — её ловит вызывающий код */
export const STOPPED = 'JOB_STOPPED';

export const INSTAGRAM_RATE_LIMITED =
  'INSTAGRAM_RATE_LIMITED';

export function makeStopError() {
  const error = new Error('Процесс остановлен пользователем');
  error.code = STOPPED;
  return error;
}

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw makeStopError();
  }
}

const INSTAGRAM_RATE_LIMIT_MARKERS = [
  '429',
  'too many requests',
  'rate limit',
  'ratelimit',
  'feedback_required',
  'challenge_required',
  'checkpoint_required',
  'please wait a few minutes',
  'temporarily blocked',
  'action blocked',
];

export function looksInstagramRateLimited(value) {
  const text = String(value || '').toLowerCase();

  return INSTAGRAM_RATE_LIMIT_MARKERS.some(
    (marker) => text.includes(marker),
  );
}

export function makeInstagramRateLimitError(value) {
  const sourceMessage = String(
    value?.message || value || '',
  ).trim();

  const error = new Error(
    sourceMessage ||
    'Instagram временно ограничил автоматические запросы.',
  );

  error.code = INSTAGRAM_RATE_LIMITED;
  return error;
}

export function createJobControl({ onStateChange } = {}) {
  let paused = false;
  let stopped = false;
  let offline = false;
  /* Ожидающие продолжения */
  let resumeWaiters = [];
  /* Таймер отсчёта до попытки переподключения */
  let countdownTimer = 0;
  let retryIndex = 0;

  function notify() {
    if (onStateChange) {
      onStateChange({ paused, stopped, offline });
    }
  }

  function releaseWaiters() {
    const list = resumeWaiters;
    resumeWaiters = [];
    list.forEach((resolve) => resolve());
  }

  /* Точка проверки: вызывается в цикле задачи между шагами.
     Если стоп — бросает STOPPED. Если пауза — ждёт кнопку «плэй». */
  async function checkpoint() {
    if (stopped) throw makeStopError();
    if (!paused) return;
    await new Promise((resolve) => { resumeWaiters.push(resolve); });
    if (stopped) throw makeStopError();
  }

  /* Ожидание восстановления связи.
     onTick(secondsLeft) вызывается каждую секунду — из него
     рисуется «Countdown to connection» в состоянии 5. */
  async function waitForConnection({ onTick } = {}) {
    offline = true;
    const seconds = RETRY_STEPS[Math.min(retryIndex, RETRY_STEPS.length - 1)];
    retryIndex += 1;
    notify();

    let left = seconds;
    if (onTick) onTick(left);

    await new Promise((resolve) => {
      countdownTimer = setInterval(() => {
        if (stopped) {
          clearInterval(countdownTimer);
          countdownTimer = 0;
          resolve();
          return;
        }
        left -= 1;
        if (onTick) onTick(Math.max(0, left));
        if (left <= 0) {
          clearInterval(countdownTimer);
          countdownTimer = 0;
          resolve();
        }
      }, 1000);
    });

    offline = false;
    notify();
    if (stopped) throw makeStopError();
    return seconds;
  }

  return {
    /* ---- команды из кнопок плеера ---- */
    pause() {
      if (stopped || paused) return;
      paused = true;
      notify();
    },
    resume() {
      if (stopped || !paused) return;
      paused = false;
      notify();
      releaseWaiters();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      paused = false;
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = 0;
      }
      notify();
      releaseWaiters();
    },

    /* ---- для кода задачи ---- */
    checkpoint,
    waitForConnection,
    /* Связь восстановилась — лестница пауз начинается заново */
    resetRetries() { retryIndex = 0; },

    get isPaused() { return paused; },
    get isStopped() { return stopped; },
    get isOffline() { return offline; },
    get retryStep() {
      return RETRY_STEPS[Math.min(retryIndex, RETRY_STEPS.length - 1)];
    },
  };
}
/* ------------------------------------------------------------
   Последовательная обработка публикаций.

   Ошибка одной публикации сохраняется отдельно и не останавливает
   следующие элементы. Полная остановка применяется только по
   запросу пользователя.
   ------------------------------------------------------------ */
export async function runPublicationQueue(
  items,
  worker,
  { signal } = {},
) {
  const completed = [];
  const failed = [];
  let stopped = false;
  let stopReason = null;

  for (const [index, item] of items.entries()) {
    try {
      throwIfAborted(signal);
      } catch (_) {
      stopped = true;
      stopReason = STOPPED;
      break; 
    }

    try {
      const value = await worker(item, index);
      completed.push({ item, value });
    } catch (error) {
      if (signal?.aborted || error?.code === STOPPED) {
        stopped = true;
        stopReason = STOPPED;
        break;
      }

      const failedEntry = {
        item,
        error: String(
          error?.message || error || 'Unknown error',
        ),
        cause: error,
      };

      failed.push(failedEntry);
      
      if (error?.code === INSTAGRAM_RATE_LIMITED) {
        stopped = true;
        stopReason = INSTAGRAM_RATE_LIMITED;
        break;
      }
    }
  }

  return {
    completed,
    failed,
    stopped,
    stopReason,
  };
}


/* ------------------------------------------------------------
   Признаки обрыва связи в выводе gallery-dl.
   Отличаем «сети нет» от «Instagram сказал нет» — во втором
   случае ждать бессмысленно, нужна другая подсказка.
   ------------------------------------------------------------ */
const OFFLINE_MARKERS = [
  'nodename nor servname',
  'temporary failure in name resolution',
  'name or service not known',
  'failed to resolve',
  'connection aborted',
  'connection reset',
  'connection refused',
  'connection timed out',
  'read timed out',
  'timed out',
  'network is unreachable',
  'no route to host',
  'ssl error',
  'proxyerror',
  'max retries exceeded',
  'remote end closed connection',
  'connectionerror',
  'econnreset',
  'enotfound',
  'etimedout',
  'eai_again',
];

export function looksOffline(text) {
  const lower = String(text || '').toLowerCase();
  /* Явный отказ сервиса — это не обрыв связи */
  if (lower.includes('login required') || lower.includes('checkpoint') ||
      lower.includes('challenge') || lower.includes('rate limit') ||
      lower.includes('429')) {
    return false;
  }
  return OFFLINE_MARKERS.some((marker) => lower.includes(marker));
}
