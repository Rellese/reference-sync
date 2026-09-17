import { L, setText, setLocalizedProperty, bindTextRender } from './i18n.js';
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

/* Геометрия одной ячейки остаётся постоянной при любом масштабе.
   Количество ячеек рассчитывается по доступной ширине шкалы. */
const CELL_WIDTH = 2;
const CELL_GAP = 3;
export let CELL_COUNT = 0;

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
/* Один проход полосы от одного края до другого, мс */
const BAND_PERIOD = 750;

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

  /* Scale: количество ячеек зависит от доступной ширины */
  const scaleNode = el('div', 'rs-scale');
  const cells = [];

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

    /* ---------- Адаптивное количество ячеек ---------- */

  function cellCountForWidth(width) {
    if (!Number.isFinite(width) || width <= 0) return 0;

    /*
      Для n ячеек:
        n * CELL_WIDTH + (n - 1) * CELL_GAP <= width

      Отсюда:
        n <= (width + CELL_GAP) / (CELL_WIDTH + CELL_GAP)
    */
    return Math.max(
      1,
      Math.floor(
        (width + CELL_GAP) / (CELL_WIDTH + CELL_GAP),
      ),
    );
  }

  function rebuildScale(nextCount) {
    if (nextCount <= 0 || nextCount === CELL_COUNT) return;

    const previousCells = cells.slice();
    const previousCount = previousCells.length;
    const fragment = document.createDocumentFragment();

    cells.length = 0;
    CELL_COUNT = nextCount;

    for (let index = 0; index < CELL_COUNT; index += 1) {
      const cell = makeCell();
      cells.push(cell);
      fragment.appendChild(cell.node);
    }

    scaleNode.replaceChildren(fragment);

    /*
      При изменении размера переносим текущее визуальное состояние
      на новое количество полос. Прогресс не сбрасывается.
    */
    if (previousCount > 0) {
      for (let index = 0; index < CELL_COUNT; index += 1) {
        const sourceIndex = Math.min(
          previousCount - 1,
          Math.floor(index * previousCount / CELL_COUNT),
        );
        const source = previousCells[sourceIndex];

        paintCell(index, source.alpha, source.glow);
      }

      return;
    }

    /*
      Первый расчёт происходит после добавления компонента в интерфейс.
      Если состояние уже было установлено, восстанавливаем текущий
      процент. Бегущие состояния обновятся своим animation frame.
    */
    if (mode !== 'search' && mode !== 'reviewing') {
      paintStatic(shown, {
        fade: mode === 'downloading',
      });
    }
  }

  const scaleResizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;

    const nextCount = cellCountForWidth(entry.contentRect.width);
    rebuildScale(nextCount);
  });

  scaleResizeObserver.observe(scaleNode);

  /* ---------- Покраска ячейки ---------- */
  function paintCell(index, alpha, glow) {
    const cell = cells[index];
    if (!cell) return;

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
    setText(interest, `${Math.round(clamp01(shown) * 100)}%`);

    if (t >= 1) {
      animating = false;
      shown = target;
      paintStatic(target, { fade: useFade });
      setText(interest, `${Math.round(clamp01(target) * 100)}%`);
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
      setText(interest, `${Math.round(value * 100)}%`);
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

  /*
   * Пинг-понг без выхода полосы за границы шкалы:
   *
   * search:
   * левый край → правый край → левый край;
   *
   * reviewing:
   * правый край → левый край → правый край.
   *
   * Полоса всегда остаётся видна полностью и в крайних
   * точках только касается границы шкалы.
   */
  const elapsed = (now - bandStart) / BAND_PERIOD;
  const cycle = elapsed % 2;
  const pingPong = cycle <= 1
    ? cycle
    : 2 - cycle;

  const position = bandDir > 0
    ? pingPong
    : 1 - pingPong;

  const maxHead = CELL_COUNT - BAND_TOTAL;
  const head = Math.round(position * maxHead);

  const palette = PALETTE[mode];

  for (let i = 0; i < CELL_COUNT; i += 1) {
    const rel = i - head;

    if (rel < 0 || rel >= BAND_TOTAL) {
      paintCell(i, 0, false);
      continue;
    }

    let alpha;

    if (rel < BAND_TAIL) {
      alpha = BAND_TAIL_ALPHA[rel];
    } else if (rel < BAND_TAIL + BAND_CORE) {
      alpha = 1;
    } else {
      alpha =
        BAND_TAIL_ALPHA[BAND_TOTAL - 1 - rel];
    }

    paintCell(
      i,
      alpha,
      Boolean(palette.glow),
    );
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
      setText(interest, '100%');
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

  function paintSplitLabel(node, text) {
    bindTextRender(node, 'progress-label', L(text), renderSplitLabel);
  }

  function renderSplitLabel(node, text) {
    setText(node, '');
    const idx = text.indexOf(':');
    if (idx === -1) {
      const only = el('span', 'rs-progress__label-value');
      setText(only, text);
      node.appendChild(only);
      return;
    }
    const before = el('span', 'rs-progress__label-key');
    setText(before, text.slice(0, idx + 1));
    const after = el('span', 'rs-progress__label-value');
    setText(after, text.slice(idx + 1));
    node.append(before, after);
  }

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
      if (lead !== undefined) paintSplitLabel(leadText, lead || '');
      if (trail !== undefined) paintSplitLabel(trailText, trail || '');
      if (found !== undefined) {
        paintSplitLabel(
          foundText,
          found || '',
        );
      }

      if (displayed !== undefined) {
        paintSplitLabel(
          displayedText,
          displayed || '',
        );
      }

      if (selected !== undefined) {
        paintSplitLabel(
          selectedText,
          selected || '',
        );
      }
      if (typeof progress === 'number') animateTo(progress);
      if (interestText !== undefined) setText(interest, interestText);
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
      setText(interest, `${Math.round(shown * 100)}%`);
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
  setLocalizedProperty(root, 'ariaLabel', L(PLAYER_LABEL[kind] || kind));

  const button = el('div', 'rs-player__button');

  const enableFrame = el(
    'span',
    'rs-player__frame rs-player__frame--enable',
  );

  const enableGradientId =
    `rs-player-enable-border-${kind}`;

  enableFrame.innerHTML = `
    <svg
      width="36"
      height="36"
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect
        width="36"
        height="36"
        rx="5"
        fill="#262626"
        fill-opacity="0.2"
      />

      <rect
        x="0.5"
        y="0.5"
        width="35"
        height="35"
        rx="4.5"
        fill="none"
        stroke="url(#${enableGradientId})"
        stroke-opacity="0.3"
      />

      <defs>
        <linearGradient
          id="${enableGradientId}"
          x1="12.0936"
          y1="-4.02829"
          x2="37.4203"
          y2="19.1515"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            offset="0"
            stop-color="#707070"
          />

          <stop
            offset="0.735778"
            stop-color="#707070"
            stop-opacity="0"
          />
        </linearGradient>
      </defs>
    </svg>
  `;

  const hoveredFrame = el(
    'span',
    'rs-player__frame rs-player__frame--hovered',
  );

  const hoveredGradientId =
    `rs-player-hovered-border-${kind}`;

  const hoveredShadowId =
    `rs-player-hovered-shadow-${kind}`;

  hoveredFrame.innerHTML = `
    <svg
      width="38"
      height="38"
      viewBox="0 0 38 38"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g filter="url(#${hoveredShadowId})">
        <rect
          x="1"
          y="0"
          width="36"
          height="36"
          rx="5"
          fill="#262626"
          fill-opacity="0.8"
          shape-rendering="crispEdges"
        />

        <rect
          x="1.5"
          y="0.5"
          width="35"
          height="35"
          rx="4.5"
          fill="none"
          stroke="url(#${hoveredGradientId})"
          stroke-opacity="0.4"
          shape-rendering="crispEdges"
        />
      </g>

      <defs>
        <filter
          id="${hoveredShadowId}"
          x="0"
          y="0"
          width="38"
          height="38"
          filterUnits="userSpaceOnUse"
          color-interpolation-filters="sRGB"
        >
          <feFlood
            flood-opacity="0"
            result="BackgroundImageFix"
          />

          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="
              0 0 0 0 0
              0 0 0 0 0
              0 0 0 0 0
              0 0 0 127 0
            "
            result="hardAlpha"
          />

          <feMorphology
            radius="1"
            operator="dilate"
            in="SourceAlpha"
            result="hoveredOuterShadow"
          />

          <feOffset dy="1" />

          <feComposite
            in2="hardAlpha"
            operator="out"
          />

          <feColorMatrix
            type="matrix"
            values="
              0 0 0 0 0
              0 0 0 0 0
              0 0 0 0 0
              0 0 0 0.1 0
            "
          />

          <feBlend
            mode="normal"
            in2="BackgroundImageFix"
            result="hoveredButtonShadow"
          />

          <feBlend
            mode="normal"
            in="SourceGraphic"
            in2="hoveredButtonShadow"
            result="shape"
          />
        </filter>

        <linearGradient
          id="${hoveredGradientId}"
          x1="7.47241"
          y1="-9.66247"
          x2="49.6028"
          y2="19.3496"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            offset="0"
            stop-color="#707070"
          />

          <stop
            offset="0.322613"
            stop-color="#707070"
            stop-opacity="0"
          />

          <stop
            offset="0.724756"
            stop-color="#707070"
            stop-opacity="0"
          />

          <stop
            offset="1"
            stop-color="#707070"
          />
        </linearGradient>
      </defs>
    </svg>
  `;

    const pressedFrame = el(
    'span',
    'rs-player__frame rs-player__frame--pressed',
  );

  const pressedGradientId =
    `rs-player-pressed-border-${kind}`;

  const pressedShadowId =
    `rs-player-pressed-shadow-${kind}`;

  pressedFrame.innerHTML = `
    <svg
      width="36"
      height="37"
      viewBox="0 0 36 37"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g filter="url(#${pressedShadowId})">
        <rect
          y="1"
          width="36"
          height="36"
          rx="5"
          fill="#151515"
        />

        <rect
          x="0.5"
          y="1.5"
          width="35"
          height="35"
          rx="4.5"
          fill="none"
          stroke="url(#${pressedGradientId})"
          stroke-opacity="0.3"
        />
      </g>

      <defs>
        <filter
          id="${pressedShadowId}"
          x="0"
          y="1"
          width="36"
          height="37"
          filterUnits="userSpaceOnUse"
          color-interpolation-filters="sRGB"
        >
          <feFlood
            flood-opacity="0"
            result="BackgroundImageFix"
          />

          <feBlend
            mode="normal"
            in="SourceGraphic"
            in2="BackgroundImageFix"
            result="shape"
          />

          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="
              0 0 0 0 0
              0 0 0 0 0
              0 0 0 0 0
              0 0 0 127 0
            "
            result="hardAlpha"
          />

          <feMorphology
            in="SourceAlpha"
            operator="erode"
            radius="1"
            result="pressedInnerShadow"
          />

          <feOffset dy="2" />

          <feComposite
            in2="hardAlpha"
            operator="arithmetic"
            k2="-1"
            k3="1"
          />

          <feColorMatrix
            type="matrix"
            values="
              0 0 0 0 0
              0 0 0 0 0
              0 0 0 0 0
              0 0 0 0.1 0
            "
          />

          <feBlend
            mode="normal"
            in2="shape"
            result="pressedInnerShadow"
          />
        </filter>

        <linearGradient
          id="${pressedGradientId}"
          x1="12.0936"
          y1="-3.02829"
          x2="37.4203"
          y2="20.1515"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            offset="0.264222"
            stop-color="#707070"
            stop-opacity="0"
          />

          <stop
            offset="1"
            stop-color="#707070"
          />
        </linearGradient>
      </defs>
    </svg>
  `;

  const icons = el('div', 'rs-player__icons');

  const icon = el(
    'span',
    `rs-player__icon rs-player__icon--${kind}`,
  );

    if (kind === 'pause') {
    icon.innerHTML = `
      <svg
        width="15"
        height="15"
        viewBox="0 0 15 15"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <g class="rs-player__svg-active">
          <rect
            width="6"
            height="15"
            rx="3"
            fill="var(--rs-control-underlay)"
          />

          <rect
            width="6"
            height="15"
            rx="3"
            fill="url(#rs-pause-base-left)"
          />

          <rect
            width="6"
            height="15"
            rx="3"
            fill="url(#rs-pause-light-left)"
          />

          <rect
            x="0.5"
            y="0.5"
            width="5"
            height="14"
            rx="2.5"
            fill="none"
            stroke="var(--rs-control-stroke)"
            style="mix-blend-mode: color-dodge"
          />

          <rect
            x="9"
            width="6"
            height="15"
            rx="3"
            fill="var(--rs-control-underlay)"
          />

          <rect
            x="9"
            width="6"
            height="15"
            rx="3"
            fill="url(#rs-pause-base-right)"
          />

          <rect
            x="9"
            width="6"
            height="15"
            rx="3"
            fill="url(#rs-pause-light-right)"
          />

          <rect
            x="9.5"
            y="0.5"
            width="5"
            height="14"
            rx="2.5"
            fill="none"
            stroke="var(--rs-control-stroke)"
            style="mix-blend-mode: color-dodge"
          />
        </g>

        <g class="rs-player__svg-disabled">
          <rect
            width="6"
            height="15"
            rx="3"
            fill="url(#rs-pause-disabled-left)"
          />

          <rect
            x="9"
            width="6"
            height="15"
            rx="3"
            fill="url(#rs-pause-disabled-right)"
          />
        </g>

        <defs>
          <filter
            id="rs-pause-hover-shadow"
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
            color-interpolation-filters="sRGB"
          >
            <feMorphology
              in="SourceAlpha"
              operator="dilate"
              radius="1"
              result="spread"
            />

            <feGaussianBlur
              in="spread"
              stdDeviation="4"
              result="blur"
            />

            <feFlood
              flood-color="#000000"
              flood-opacity="0.65"
              result="shadow-color"
            />

            <feComposite
              in="shadow-color"
              in2="blur"
              operator="in"
              result="shadow"
            />

            <feMerge>
              <feMergeNode in="shadow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient
            id="rs-pause-base-left"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="
              translate(3 0)
              rotate(90)
              scale(15 3.65341)
            "
          >
            <stop
              offset="0.166446"
              stop-color="var(--rs-control-base-start)"
            />
            <stop
              offset="0.902612"
              stop-color="var(--rs-control-base-end)"
            />
            <stop
              offset="1"
              stop-color="var(--rs-control-base-end)"
            />
          </radialGradient>

          <radialGradient
            id="rs-pause-light-left"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="
              translate(3 0)
              rotate(90)
              scale(9.88636 3.77531)
            "
          >
            <stop
              stop-color="var(--rs-control-light-start)"
            />
            <stop
              offset="0.643872"
              stop-color="var(--rs-control-light-middle)"
            />
            <stop
              offset="1"
              stop-color="var(--rs-control-light-end)"
            />
          </radialGradient>

          <radialGradient
            id="rs-pause-base-right"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="
              translate(12 0)
              rotate(90)
              scale(15 3.65341)
            "
          >
            <stop
              offset="0.166446"
              stop-color="var(--rs-control-base-start)"
            />
            <stop
              offset="0.902612"
              stop-color="var(--rs-control-base-end)"
            />
            <stop
              offset="1"
              stop-color="var(--rs-control-base-end)"
            />
          </radialGradient>

          <radialGradient
            id="rs-pause-light-right"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="
              translate(12 0)
              rotate(90)
              scale(9.88636 3.77531)
            "
          >
            <stop
              stop-color="var(--rs-control-light-start)"
            />
            <stop
              offset="0.643872"
              stop-color="var(--rs-control-light-middle)"
            />
            <stop
              offset="1"
              stop-color="var(--rs-control-light-end)"
            />
          </radialGradient>

          <radialGradient
            id="rs-pause-disabled-left"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="
              translate(3 15)
              rotate(-90)
              scale(15 5.7282)
            "
          >
            <stop
              stop-color="var(--rs-control-disabled-start)"
            />
            <stop
              offset="1"
              stop-color="var(--rs-control-disabled-end)"
            />
          </radialGradient>

          <radialGradient
            id="rs-pause-disabled-right"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="
              translate(12 15)
              rotate(-90)
              scale(15 5.7282)
            "
          >
            <stop
              stop-color="var(--rs-control-disabled-start)"
            />
            <stop
              offset="1"
              stop-color="var(--rs-control-disabled-end)"
            />
          </radialGradient>
        </defs>
      </svg>
    `;
  }

  if (kind === 'stop') {
    icon.innerHTML = `
      <svg
        width="15"
        height="15"
        viewBox="0 0 15 15"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <g class="rs-player__svg-active">
          <rect
            width="15"
            height="15"
            rx="3"
            fill="url(#rs-stop-base)"
          />

          <rect
            width="15"
            height="15"
            rx="3"
            fill="url(#rs-stop-light)"
          />

          <rect
            x="0.5"
            y="0.5"
            width="14"
            height="14"
            rx="2.5"
            fill="none"
            stroke="var(--rs-control-stroke)"
            style="mix-blend-mode: color-dodge"
          />
        </g>

        <rect
          class="rs-player__svg-disabled"
          width="15"
          height="15"
          rx="3"
          fill="url(#rs-stop-disabled)"
        />

        <defs>
          <filter
            id="rs-stop-hover-shadow"
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
            color-interpolation-filters="sRGB"
          >
            <feMorphology
              in="SourceAlpha"
              operator="dilate"
              radius="1"
              result="spread"
            />

            <feGaussianBlur
              in="spread"
              stdDeviation="4"
              result="blur"
            />

            <feFlood
              flood-color="#000000"
              flood-opacity="0.65"
              result="shadow-color"
            />

            <feComposite
              in="shadow-color"
              in2="blur"
              operator="in"
              result="shadow"
            />

            <feMerge>
              <feMergeNode in="shadow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient
            id="rs-stop-base"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="
              translate(7.5 0)
              rotate(90)
              scale(15 9.13352)
            "
          >
            <stop
              offset="0.166446"
              stop-color="var(--rs-control-base-start)"
            />
            <stop
              offset="0.902612"
              stop-color="var(--rs-control-base-end)"
            />
            <stop
              offset="1"
              stop-color="var(--rs-control-base-end)"
            />
          </radialGradient>

          <radialGradient
            id="rs-stop-light"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="
              translate(7.5 0)
              rotate(90)
              scale(9.88636 9.43829)
            "
          >
            <stop
              stop-color="var(--rs-control-light-start)"
            />
            <stop
              offset="0.643872"
              stop-color="var(--rs-control-light-middle)"
            />
            <stop
              offset="1"
              stop-color="var(--rs-control-light-end)"
            />
          </radialGradient>

          <radialGradient
            id="rs-stop-disabled"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="
              translate(7.5 15)
              rotate(-90)
              scale(15 14.3205)
            "
          >
            <stop
              stop-color="var(--rs-control-disabled-start)"
            />
            <stop
              offset="1"
              stop-color="var(--rs-control-disabled-end)"
            />
          </radialGradient>
        </defs>
      </svg>
    `;
  }

  if (kind === 'play') {
    icon.innerHTML = `
      <svg
        width="15"
        height="15"
        viewBox="0 0 15 15"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <g class="rs-player__play-active">
          <path
            d="M13.9655 5.88932C15.3448 6.60518 15.3448 8.39482 13.9655 9.11068L3.10345 14.7481C1.72414 15.4639 -6.96187e-08 14.5691 0 13.1374L5.48247e-07 1.86263C6.17866e-07 0.430913 1.72414 -0.46391 3.10345 0.251947L13.9655 5.88932Z"
            fill="url(#rs-play-base)"
          />

          <path
            d="M13.9655 5.88932C15.3448 6.60518 15.3448 8.39482 13.9655 9.11068L3.10345 14.7481C1.72414 15.4639 -6.96187e-08 14.5691 0 13.1374L5.48247e-07 1.86263C6.17866e-07 0.430913 1.72414 -0.46391 3.10345 0.251947L13.9655 5.88932Z"
            fill="url(#rs-play-light)"
          />

          <path
            class="rs-player__play-stroke"
            d="M1.26465 0.695312C1.73426 0.451605 2.3382 0.417829 2.87305 0.695312L13.7354 6.33301C14.2638 6.60729 14.5 7.06535 14.5 7.5C14.5 7.93465 14.2638 8.39271 13.7354 8.66699L2.87305 14.3047C2.3382 14.5822 1.73426 14.5484 1.26465 14.3047C0.796005 14.0615 0.500128 13.6342 0.5 13.1377V1.8623C0.500128 1.36577 0.796006 0.938537 1.26465 0.695312Z"
            fill="none"
          />
        </g>

        <path
          class="rs-player__play-disabled"
          d="M13.9655 5.88932C15.3448 6.60518 15.3448 8.39482 13.9655 9.11068L3.10345 14.7481C1.72414 15.4639 -6.96187e-08 14.5691 0 13.1374L5.48247e-07 1.86263C6.17866e-07 0.430913 1.72414 -0.46391 3.10345 0.251947L13.9655 5.88932Z"
          fill="url(#rs-play-disabled)"
        />

        <defs>
          <filter
            id="rs-play-hover-shadow"
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
            color-interpolation-filters="sRGB"
          >
            <feMorphology
              in="SourceAlpha"
              operator="dilate"
              radius="1"
              result="spread"
            />

            <feGaussianBlur
              in="spread"
              stdDeviation="4"
              result="blur"
            />

            <feFlood
              flood-color="#000000"
              flood-opacity="0.65"
              result="shadow-color"
            />

            <feComposite
              in="shadow-color"
              in2="blur"
              operator="in"
              result="shadow"
            />

            <feMerge>
              <feMergeNode in="shadow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient
            id="rs-play-base"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="
              translate(7.5 0)
              rotate(90)
              scale(15 9.13352)
            "
          >
            <stop
              offset="0.166446"
              stop-color="var(--rs-control-base-start)"
            />

            <stop
              offset="0.902612"
              stop-color="var(--rs-control-base-end)"
            />

            <stop
              offset="1"
              stop-color="var(--rs-control-base-end)"
            />
          </radialGradient>

          <radialGradient
            id="rs-play-light"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="
              translate(7.5 0)
              rotate(90)
              scale(9.88636 9.43829)
            "
          >
            <stop
              stop-color="var(--rs-control-light-start)"
            />

            <stop
              offset="0.643872"
              stop-color="var(--rs-control-light-middle)"
            />

            <stop
              offset="1"
              stop-color="var(--rs-control-light-end)"
            />
          </radialGradient>

          <radialGradient
            id="rs-play-disabled"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="
              translate(7.5 15)
              rotate(-90)
              scale(15 14.3205)
            "
          >
            <stop
              stop-color="var(--rs-control-disabled-start)"
            />

            <stop
              offset="1"
              stop-color="var(--rs-control-disabled-end)"
            />
          </radialGradient>
        </defs>
      </svg>
    `;
  }

  icons.appendChild(icon);

  button.append(
    enableFrame,
    hoveredFrame,
    pressedFrame,
    icons,
  );

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
