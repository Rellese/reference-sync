/* ============================================================
   ReferenceSync — прогресс-бар (блок 4)

   Реализация 1:1 по Full_design:
     Scale Downloading a file       → 1  downloading
     Scale Download complete        → 2  complete
     Scale Download paused          → 3  paused
     Scale Download stopped         → 4  stopped
     Scale Connection lost          → 5  offline
     Scale Search for Publications  → 6  search
     Scale Reviewing Publications   → 7  reviewing

   Геометрия шкалы (одинакова во всех состояниях):
     219 ячеек, width: 2px; height: 16px; border-radius: 100px; gap: 3px
     219*2 + 218*3 = 1092px — ровно ширина контейнера Info.

   Закон анимации (Instruction/Scale Downloading a file):
     • любое изменение прогресса длится РОВНО 1 секунду;
     • ячейки загораются поочерёдно: n новых ячеек → шаг 1/n секунды;
     • заливка наливается постепенно: на 0,5 с при n=10
       5-я ячейка на 10%, 4-я на 20%, … 1-я на 50%
       (то есть заливка = времяАнимации − времяСтартаЯчейки);
     • свечение (тень) у ведущей ячейки включается СРАЗУ на 100%;
     • кривая нелинейная: быстро в начале, замедление к концу;
     • у неполностью залитых ячеек под цветным слоем лежит
       rgba(255,255,255,0.1) — специально, как в Figma.
   ============================================================ */

import { el } from './ui.js';

/* Число ячеек шкалы — ровно как в макете */
export const CELL_COUNT = 219;

/* Длительность любой анимации прогресса, мс (жёсткое требование) */
const ANIM_MS = 1000;

/* --------------------------------------------------------------
   Лестница затухания хвоста в состоянии 1 (ячейки 137..153 макета).
   Индекс = расстояние от ведущей (последней зажжённой) ячейки:
     0 → 0.1 (самая дальняя вперёд), 16 → 1.0 (уже сплошной цвет).
   -------------------------------------------------------------- */
const TAIL_ALPHA = [
  0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55,
  0.65, 0.7, 0.75, 0.8, 0.9, 0.95, 1,
];
const TAIL_LEN = TAIL_ALPHA.length; // 17

/* --------------------------------------------------------------
   Бегущая полоса состояний 6 и 7 (Figma: 57..155).
   Ядро 76..136 — 61 ячейка на 100%; хвосты по 19 ячеек,
   лестница симметрична с шагом 0.05.
   -------------------------------------------------------------- */
const BAND_TAIL_ALPHA = [
  0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55,
  0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1,
];
const BAND_TAIL = BAND_TAIL_ALPHA.length; // 19
const BAND_CORE = 61;
const BAND_TOTAL = BAND_CORE + BAND_TAIL * 2; // 99
/* Полный проход полосы, мс */
const BAND_PERIOD = 1800;

/* Палитры состояний: solid — цвет полной заливки,
   base — rgb для частичной альфы, glow — тень или null */
const PALETTE = {
  downloading: { solid: '#D3432D', base: '211, 67, 45', glow: 'rgba(211, 75, 45, 0.5)' },
  complete: { solid: '#1BCC50', base: '27, 204, 80', glow: 'rgba(27, 204, 80, 0.5)' },
  paused: { solid: '#707070', base: '112, 112, 112', glow: null },
  stopped: { solid: '#707070', base: '112, 112, 112', glow: null },
  offline: { solid: '#FF333A', base: '255, 51, 58', glow: null },
  search: { solid: '#1BCC50', base: '27, 204, 80', glow: 'rgba(27, 204, 80, 0.5)' },
  reviewing: { solid: '#D3442E', base: '211, 68, 46', glow: 'rgba(211, 68, 46, 0.5)' },
  idle: { solid: '#707070', base: '112, 112, 112', glow: null },
};

/* Цвет пустой ячейки */
const EMPTY_COLOR = '#353535';

/* Нелинейная кривая: быстрый старт, замедление к концу */
function easeOut(t) {
  const c = t < 0 ? 0 : (t > 1 ? 1 : t);
  return 1 - Math.pow(1 - c, 3);
}

/* ------------------------------------------------------------
   Ячейка: нижний слой rgba(255,255,255,0.1) + верхний цветной
   ------------------------------------------------------------ */
function makeCell() {
  const node = el('span', 'rs-scale__cell');
  node.appendChild(el('span', 'rs-scale__under'));
  const fill = el('span', 'rs-scale__fill');
  node.appendChild(fill);
  return { node, fill, alpha: -1, glow: null };
}

/* ============================================================
   Фабрика прогресс-бара
   onCommand(name): 'pause' | 'play' | 'stop'
   ============================================================ */
export function createProgressBar({ onCommand } = {}) {
  const root = el('section', 'rs-progress');
  root.dataset.mode = 'idle';

  /* ---------- Info ---------- */
  const info = el('div', 'rs-progress__info');

  /* Process Info: две подписи по краям */
  const processInfo = el('div', 'rs-progress__row');
  const leadText = el('div', 'rs-progress__label', '');
  const trailText = el('div', 'rs-progress__label', '');
  processInfo.append(leadText, trailText);

  /* Management and Percentage: процент по центру + Controls */
  const manage = el('div', 'rs-progress__manage');
  const interest = el('div', 'rs-progress__interest', '0%');

  const controls = el('div', 'rs-progress__controls');
  const buttons = {
    pause: makePlayerButton('pause', () => emit('pause')),
    play: makePlayerButton('play', () => emit('play')),
    stop: makePlayerButton('stop', () => emit('stop')),
  };
  controls.append(buttons.pause.node, buttons.play.node, buttons.stop.node);
  manage.append(interest, controls);

  /* Scale: 219 ячеек */
  const scaleNode = el('div', 'rs-scale');
  const cells = [];
  for (let i = 0; i < CELL_COUNT; i += 1) {
    const cell = makeCell();
    cells.push(cell);
    scaleNode.appendChild(cell.node);
  }

  info.append(processInfo, manage, scaleNode);

  /* ---------- Publication info ---------- */
  const publication = el('div', 'rs-progress__publication');
  const foundGroup = el('div', 'rs-progress__found');
  const foundText = el('div', 'rs-progress__label', '');
  const displayedText = el('div', 'rs-progress__label', '');
  foundGroup.append(foundText, displayedText);
  const selectedText = el('div', 'rs-progress__label', '');
  publication.append(foundGroup, selectedText);

  root.append(info, publication);

  function emit(name) { if (onCommand) onCommand(name); }

  /* ---------- Состояние ---------- */
  let mode = 'idle';
  let target = 0;      // целевой прогресс 0..1
  let shown = 0;       // отрисованный прогресс 0..1
  let animFrom = 0;
  let animStart = 0;
  let animating = false;
  let rafId = 0;
  let bandRaf = 0;
  let bandStart = 0;
  let bandDir = 1;

  /* ---------- Покраска ячейки ---------- */
  function paintCell(index, alpha, glow) {
    const cell = cells[index];
    if (cell.alpha === alpha && cell.glow === glow) return;
    cell.alpha = alpha;
    cell.glow = glow;

    if (alpha <= 0) {
      cell.node.classList.remove('is-lit');
      cell.node.style.boxShadow = '';
      cell.fill.style.background = EMPTY_COLOR;
      return;
    }

    const palette = PALETTE[mode] || PALETTE.downloading;
    cell.node.classList.add('is-lit');
    cell.fill.style.background = alpha >= 1
      ? palette.solid
      : `rgba(${palette.base}, ${alpha})`;
    cell.node.style.boxShadow = (glow && palette.glow)
      ? `0px 0px 10px 1px ${palette.glow}`
      : '';
  }

  /* Альфа хвоста по расстоянию от ведущей ячейки.
     Ровно лестница Figma: ведущая (distance 0) — 0.1,
     через 16 ячеек назад — сплошной цвет. */
  function tailAlpha(distanceFromLead) {
    if (distanceFromLead < 0) return 1;
    if (distanceFromLead >= TAIL_LEN) return 1;
    return TAIL_ALPHA[distanceFromLead];
  }

  /* ---------- Статичная отрисовка ----------
     fade=true → у края хвост из TAIL_ALPHA (как в состоянии 1). */
  function paintStatic(progress, { fade = true } = {}) {
    const palette = PALETTE[mode] || PALETTE.downloading;
    const glowOn = Boolean(palette.glow);
    const filled = Math.round(clamp01(progress) * CELL_COUNT);

    for (let i = 0; i < CELL_COUNT; i += 1) {
      if (i >= filled) { paintCell(i, 0, false); continue; }
      const distance = filled - 1 - i;
      const alpha = fade ? tailAlpha(distance) : 1;
      paintCell(i, alpha, glowOn);
    }
  }

  /* ---------- Кадр анимации ----------
     Ключевая формула из инструкции:
       доляЗаливки(i) = p − стартЯчейки(i),
       стартЯчейки(i) = (i − откуда) / количествоНовыхЯчеек
     Дополнительно применяется хвост TAIL_ALPHA относительно
     текущего курсора, чтобы кадр в конце совпал со статикой. */
  function frame(now) {
    if (!animating) return;
    const t = Math.min(1, (now - animStart) / ANIM_MS);
    const p = easeOut(t);

    const fromCells = animFrom * CELL_COUNT;
    const toCells = target * CELL_COUNT;
    const delta = toCells - fromCells;
    const cursor = fromCells + delta * p;

    const palette = PALETTE[mode] || PALETTE.downloading;
    const glowOn = Boolean(palette.glow);
    const useFade = mode === 'downloading';
    const lead = Math.ceil(cursor) - 1;

    if (delta >= 0) {
      const span = delta === 0 ? 1 : delta;
      for (let i = 0; i < CELL_COUNT; i += 1) {
        if (i > lead) { paintCell(i, 0, false); continue; }
        /* моменты старта и заливка по закону из инструкции */
        const start = (i - fromCells) / span;
        let alpha = p - start;
        if (alpha <= 0) { paintCell(i, 0, false); continue; }
        if (alpha > 1) alpha = 1;
        if (useFade) alpha = Math.min(alpha, tailAlpha(lead - i));
        /* Свечение у ведущей — сразу 100% */
        paintCell(i, Math.max(0.1, alpha), glowOn);
      }
    } else {
      /* Откат назад: гасим от края */
      const filled = Math.round(cursor);
      for (let i = 0; i < CELL_COUNT; i += 1) {
        if (i >= filled) { paintCell(i, 0, false); continue; }
        paintCell(i, useFade ? tailAlpha(filled - 1 - i) : 1, glowOn);
      }
    }

    shown = cursor / CELL_COUNT;
    interest.textContent = `${Math.round(clamp01(shown) * 100)}%`;

    if (t >= 1) {
      animating = false;
      shown = target;
      paintStatic(target, { fade: useFade });
      interest.textContent = `${Math.round(clamp01(target) * 100)}%`;
      return;
    }
    rafId = requestAnimationFrame(frame);
  }

  function animateTo(next) {
    const value = clamp01(next);
    /* Разница меньше четверти ячейки — анимировать нечего */
    if (Math.abs(value - shown) < 1 / (CELL_COUNT * 4)) {
      target = value;
      shown = value;
      paintStatic(value, { fade: mode === 'downloading' });
      interest.textContent = `${Math.round(value * 100)}%`;
      return;
    }
    cancelAnimationFrame(rafId);
    animFrom = shown;
    target = value;
    animStart = performance.now();
    animating = true;
    rafId = requestAnimationFrame(frame);
  }

  /* ---------- Бегущая полоса (6 и 7) ---------- */
  function bandFrame(now) {
    if (mode !== 'search' && mode !== 'reviewing') return;
    if (!bandStart) bandStart = now;

    const phase = ((now - bandStart) % BAND_PERIOD) / BAND_PERIOD;
    const travel = CELL_COUNT + BAND_TOTAL;
    const forward = bandDir > 0 ? phase : 1 - phase;
    const head = Math.round(forward * travel - BAND_TOTAL);

    const palette = PALETTE[mode];
    for (let i = 0; i < CELL_COUNT; i += 1) {
      const rel = i - head;
      if (rel < 0 || rel >= BAND_TOTAL) { paintCell(i, 0, false); continue; }
      let alpha;
      if (rel < BAND_TAIL) alpha = BAND_TAIL_ALPHA[rel];
      else if (rel < BAND_TAIL + BAND_CORE) alpha = 1;
      else alpha = BAND_TAIL_ALPHA[BAND_TOTAL - 1 - rel];
      paintCell(i, alpha, Boolean(palette.glow));
    }
    bandRaf = requestAnimationFrame(bandFrame);
  }

  function stopBand() {
    if (bandRaf) cancelAnimationFrame(bandRaf);
    bandRaf = 0;
    bandStart = 0;
  }

  function startBand(direction) {
    stopBand();
    bandDir = direction;
    bandRaf = requestAnimationFrame(bandFrame);
  }

  function setControls({ pause = false, play = false, stop = false } = {}) {
    buttons.pause.setOn(pause);
    buttons.play.setOn(play);
    buttons.stop.setOn(stop);
  }

  /* ---------- Смена состояния ---------- */
  function setMode(kind) {
    if (mode === kind) return;
    mode = kind;
    root.dataset.mode = kind;

    /* Сначала гасим прежние анимации, только потом запускаем новую —
       иначе отмена «догоняет» уже поставленный кадр */
    cancelAnimationFrame(rafId);
    rafId = 0;
    animating = false;
    stopBand();
    cells.forEach((cell) => { cell.alpha = -1; cell.glow = null; });

    /* Видимость частей — строго по макетам */
    const withControls = kind === 'downloading' || kind === 'paused' || kind === 'offline';
    const withInterest = withControls || kind === 'complete';
    const withPublication = withControls || kind === 'stopped';

    manage.hidden = !withInterest;
    controls.hidden = !withControls;
    interest.hidden = !withInterest;
    publication.hidden = !withPublication;

    if (kind === 'downloading') setControls({ pause: true, play: false, stop: true });
    else if (kind === 'paused') setControls({ pause: false, play: true, stop: true });
    else if (kind === 'offline') setControls({ pause: false, play: false, stop: true });
    else setControls({});

    /* Перерисовка под новую палитру */
    if (kind === 'complete') {
      shown = 1;
      target = 1;
      paintStatic(1, { fade: false });
      interest.textContent = '100%';
    } else if (kind === 'search') {
      startBand(1);
    } else if (kind === 'reviewing') {
      startBand(-1);
    } else if (kind === 'idle') {
      shown = 0;
      target = 0;
      paintStatic(0);
    } else {
      paintStatic(shown, { fade: kind === 'downloading' });
    }
  }

  paintStatic(0);

  return {
    node: root,

    /* Единая точка входа: состояние + все подписи + прогресс */
    update({
      mode: kind,
      progress,
      lead, trail,
      found, displayed, selected,
      interest: interestText,
    } = {}) {
      if (kind) setMode(kind);
      if (lead !== undefined) leadText.textContent = lead || '';
      if (trail !== undefined) trailText.textContent = trail || '';
      if (found !== undefined) foundText.textContent = found || '';
      if (displayed !== undefined) displayedText.textContent = displayed || '';
      if (selected !== undefined) selectedText.textContent = selected || '';
      if (typeof progress === 'number') animateTo(progress);
      if (interestText !== undefined) interest.textContent = interestText;
      return this;
    },

    setMode,
    setProgress: animateTo,

    /* Без анимации — для восстановления после сбоя */
    jumpTo(progress) {
      cancelAnimationFrame(rafId);
      animating = false;
      shown = clamp01(progress);
      target = shown;
      paintStatic(shown, { fade: mode === 'downloading' });
      interest.textContent = `${Math.round(shown * 100)}%`;
    },

    get progress() { return target; },
    get mode() { return mode; },

    destroy() {
      cancelAnimationFrame(rafId);
      stopBand();
    },
  };
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return number < 0 ? 0 : (number > 1 ? 1 : number);
}

/* ------------------------------------------------------------
   Кнопка плеера (Full_design/Player buttons + controls)

   Слои: внешний контейнер (сдвиг вниз при hovered/pressed)
   → Button → controls → Icon. Состояния On/Off у иконки
   различаются градиентом, у контейнера — фоном и тенью.
   ------------------------------------------------------------ */
const PLAYER_LABEL = {
  pause: 'Пауза',
  play: 'Продолжить',
  stop: 'Остановить',
};

function makePlayerButton(kind, onClick) {
  const root = el('div', `rs-player rs-player--${kind}`);
  root.setAttribute('role', 'button');
  root.setAttribute('tabindex', '0');
  root.setAttribute('aria-label', PLAYER_LABEL[kind] || kind);

  const button = el('div', 'rs-player__button');
  const icons = el('div', 'rs-player__icons');

  if (kind === 'pause') {
    icons.appendChild(el('span', 'rs-player__icon rs-player__icon--bar'));
    icons.appendChild(el('span', 'rs-player__icon rs-player__icon--bar'));
  } else {
    icons.appendChild(el('span', `rs-player__icon rs-player__icon--${kind}`));
  }

  button.appendChild(icons);
  root.appendChild(button);

  let on = false;
  const fire = () => { if (on && onClick) onClick(); };

  root.addEventListener('click', fire);
  root.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      fire();
    }
  });

  return {
    node: root,
    setOn(value) {
      on = Boolean(value);
      root.classList.toggle('is-on', on);
      root.setAttribute('aria-disabled', String(!on));
    },
    get isOn() { return on; },
  };
}
