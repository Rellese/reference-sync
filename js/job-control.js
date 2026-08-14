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

  function makeStopError() {
    const error = new Error('Процесс остановлен пользователем');
    error.code = STOPPED;
    return error;
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
  'ssl',
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
