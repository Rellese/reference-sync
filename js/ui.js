import { L, setText, setUiText, setLocalizedProperty, bindTextRender } from './i18n.js';
/* ============================================================
   ReferenceSync — базовые UI-примитивы
   Каждая фабрика возвращает DOM-узел + методы управления
   состоянием. Разметка соответствует слоям из Figma.
   ============================================================ */

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) setText(node, text);
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* ------------------------------------------------------------
   Switch — 36×18, слоистая структура из switch.css
   ------------------------------------------------------------ */
export function createSwitch({ checked = false, onChange, label, id } = {}) {
  const root = el('div', 'rs-switch');
  root.setAttribute('role', 'switch');
  root.setAttribute('tabindex', '0');
  root.appendChild(el('div', 'rs-switch__knob'));
  if (id) root.id = id;

  let value = Boolean(checked);

  const apply = () => {
    root.classList.toggle('is-on', value);
    root.setAttribute('aria-checked', String(value));
  };

  const toggle = () => {
    if (root.classList.contains('is-disabled')) return;
    value = !value;
    root.classList.add('is-hover-suppressed');
    apply();
    if (onChange) onChange(value);
  };

  root.addEventListener('pointerleave', () => root.classList.remove('is-hover-suppressed'));
  root.addEventListener('click', toggle);
  root.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      toggle();
    }
  });
  apply();

  const api = {
    node: root,
    get value() { return value; },
    set(next, silent) {
      value = Boolean(next);
      apply();
      if (!silent && onChange) onChange(value);
    },
    setDisabled(state) { root.classList.toggle('is-disabled', Boolean(state)); },
  };

  if (label === undefined) return api;

  /* Обёртка со подписью */
  const row = el('div', 'rs-switch-row');
  const text = el('span', 'rs-switch-row__label', label);
  text.addEventListener('click', toggle);
  row.append(root, text);
  api.row = row;
  api.labelNode = text;
  return api;
}

/* ------------------------------------------------------------
   Checkbox — 12×12 + галочка Vector 1
   ------------------------------------------------------------ */
export function createCheckbox({
  checked = false,
  mixed = false,
  disabled = false,
  onChange,
  onPointerDown,
  onPointerEnter,
  label,
} = {}) {
  const root = el('div', 'rs-check');
  root.setAttribute('role', 'checkbox');
  root.setAttribute('tabindex', '0');

  const mark = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'svg',
  );

  mark.classList.add('rs-check__mark');
  mark.setAttribute('viewBox', '0 0 6 4');
  mark.setAttribute('width', '6');
  mark.setAttribute('height', '4');
  mark.setAttribute('aria-hidden', 'true');

  const markPath = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'path',
  );

  markPath.setAttribute(
    'd',
    'M0.5 2 L2.25 3.5 L5.5 0.5',
  );
  markPath.setAttribute('fill', 'none');
  markPath.setAttribute(
    'stroke',
    'currentColor',
  );
  markPath.setAttribute(
    'stroke-width',
    '1',
  );
  markPath.setAttribute(
    'stroke-linecap',
    'round',
  );
  markPath.setAttribute(
    'stroke-linejoin',
    'round',
  );

  mark.appendChild(markPath);
  root.appendChild(mark);

  let value = Boolean(checked);
  let isMixed = Boolean(mixed);
  let isDisabled = Boolean(disabled);
  let suppressNextClick = false;

  const POINTER_PRESS_CLASSES = [
  'is-press-from-off',
  'is-press-from-on',
  'is-press-from-mixed',
];

  const clearPointerPress = () => {
    root.classList.remove(
      ...POINTER_PRESS_CLASSES,
    );

    window.removeEventListener(
      'pointerup',
      clearPointerPress,
    );

    window.removeEventListener(
      'pointercancel',
      clearPointerPress,
    );

    window.removeEventListener(
      'blur',
      clearPointerPress,
    );
  };

  const showPointerPress = (state) => {
    clearPointerPress();

    root.classList.add(
      `is-press-from-${state}`,
    );

    window.addEventListener(
      'pointerup',
      clearPointerPress,
    );

    window.addEventListener(
      'pointercancel',
      clearPointerPress,
    );

    window.addEventListener(
      'blur',
      clearPointerPress,
    );
  };

  const apply = () => {
    root.classList.toggle(
      'is-on',
      value && !isMixed,
    );

    root.classList.toggle(
      'is-mixed',
      isMixed,
    );

    root.classList.toggle(
      'is-disabled',
      isDisabled,
    );

    root.setAttribute(
      'aria-checked',
      isMixed ? 'mixed' : String(value),
    );

    root.setAttribute(
      'aria-disabled',
      String(isDisabled),
    );

    root.setAttribute(
      'tabindex',
      isDisabled ? '-1' : '0',
    );
  };

  const toggle = (event) => {
    if (isDisabled) return;

    value = isMixed
      ? true
      : !value;

    isMixed = false;
    apply();

    if (onChange) {
      onChange(value, event);
    }
  };

  const handleClick = (event) => {
    event.stopPropagation();

    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }

    toggle(event);
  };

  const handlePointerDown = (event) => {
    if (
      isDisabled ||
      !onPointerDown ||
      event.button !== 0
    ) {
      return;
    }

    /*
    * Запоминаем визуальное состояние до того,
    * как callback изменит логическое значение.
    */
    const pressedState = isMixed
      ? 'mixed'
      : value
        ? 'on'
        : 'off';

    const handled = onPointerDown(
      event,
      api,
    ) === true;

    if (!handled) {
      return;
    }

    showPointerPress(pressedState);

    suppressNextClick = true;
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePointerEnter = (event) => {
    if (
      isDisabled ||
      !onPointerEnter
    ) {
      return;
    }

    const handled = onPointerEnter(
      event,
      api,
    ) === true;

    if (!handled) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  root.addEventListener(
    'click',
    handleClick,
  );

  root.addEventListener(
    'pointerdown',
    handlePointerDown,
  );

  root.addEventListener(
    'pointerenter',
    handlePointerEnter,
  );

  root.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key !== ' ' &&
        event.key !== 'Enter'
      ) {
        return;
      }

      event.preventDefault();
      toggle(event);
    },
  );

  const api = {
    node: root,

    get value() {
      return value;
    },

    get disabled() {
      return isDisabled;
    },

    set(next, silent = false) {
      value = Boolean(next);
      isMixed = false;
      apply();

      if (!silent && onChange) {
        onChange(value);
      }
    },

    setMixed(state) {
      isMixed = Boolean(state);

      if (isMixed) {
        value = false;
      }

      apply();
    },

    setDisabled(state) {
      isDisabled = Boolean(state);
      apply();
    },
  

  setPressedFrom(state) {
    if (
      state !== 'off' &&
      state !== 'on' &&
      state !== 'mixed'
    ) {
      clearPointerPress();
      return;
    }

    showPointerPress(state);
  },

  clearPressed() {
    clearPointerPress();
  },
  };

  apply();

  if (label === undefined) {
    return api;
  }

  const row = el(
    'div',
    'rs-check-row',
  );

  const text = el(
    'span',
    'rs-check-row__label',
    label,
  );

  text.addEventListener(
    'click',
    (event) => toggle(event),
  );

  row.append(root, text);
  api.row = row;

  return api;
}

/* ------------------------------------------------------------
   Radio — 12×12 + точка Ellipse 7
   ------------------------------------------------------------ */
export function createRadio({ checked = false, label, onSelect } = {}) {
  const root = el('div', 'rs-radio');
  root.setAttribute('role', 'radio');
  root.setAttribute('tabindex', '0');
  root.appendChild(el('div', 'rs-radio__dot'));

  let value = Boolean(checked);
  const apply = () => {
    root.classList.toggle('is-on', value);
    root.setAttribute('aria-checked', String(value));
  };

  const select = () => {
    if (value) return;
    if (onSelect) onSelect();
  };

  root.addEventListener('click', select);
  root.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      select();
    }
  });
  apply();

  const api = {
    node: root,
    get value() { return value; },
    set(next) { value = Boolean(next); apply(); },
  };

  if (label === undefined) return api;

  const row = el('div', 'rs-radio-row');
  const text = el('span', 'rs-radio-row__label', label);
  text.addEventListener('click', select);
  row.append(root, text);
  api.row = row;
  return api;
}

/* Группа радиокнопок с общим состоянием */
export function createRadioGroup(items, { value, onChange } = {}) {
  const radios = new Map();
  let current = value ?? items[0]?.value;

  const apply = () => {
    radios.forEach((radio, key) => radio.set(key === current));
  };

  items.forEach((item) => {
    const radio = createRadio({
      label: item.label,
      checked: item.value === current,
      onSelect: () => {
        current = item.value;
        apply();
        if (onChange) onChange(current);
      },
    });
    radios.set(item.value, radio);
  });

  return {
    radios,
    get value() { return current; },
    set(next) { current = next; apply(); },
    rowOf(key) { return radios.get(key)?.row; },
    nodeOf(key) { return radios.get(key)?.node; },
  };
}

/* ------------------------------------------------------------
   Info — круглая иконка с подсказкой (300px тултип)
   ------------------------------------------------------------ */
/* Текст подсказки задаётся строкой, где важная часть обёрнута
   в двойные звёздочки: 'обычный **важный** обычный'.
   Важная часть выводится оранжевым — как в макете Figma. */
function renderTipText(tip, text) {
  clear(tip);
  String(text).split(/\*\*/).forEach((part, index) => {
    if (!part) return;
    /* Чётные части — обычный текст, нечётные — выделенные */
    tip.appendChild(index % 2
      ? el('span', 'rs-tip__mark', part)
      : document.createTextNode(part));
  });
}

export function createInfo(text, { accent = false } = {}) {
  const root = el('div', 'rs-info');
  root.appendChild(el('span', 'rs-info__glyph', 'i'));

  const tip = el('div', 'rs-tip' + (accent ? ' is-accent' : ''));
  bindTextRender(tip, 'tooltip', L(text), renderTipText);
  document.body.appendChild(tip);

  const place = () => {
    const box = root.getBoundingClientRect();
    tip.classList.add('is-visible');
    const tipBox = tip.getBoundingClientRect();
    let left = box.left + box.width + 10;
    if (left + tipBox.width > window.innerWidth - 10) {
      left = box.left - tipBox.width - 10;
    }
    let top = box.top - 4;
    if (top + tipBox.height > window.innerHeight - 10) {
      top = window.innerHeight - tipBox.height - 10;
    }
    tip.style.left = `${Math.max(10, left)}px`;
    tip.style.top = `${Math.max(10, top)}px`;
  };

  root.addEventListener('mouseenter', place);
  root.addEventListener('mouseleave', () => tip.classList.remove('is-visible'));

  return {
    node: root,
    tip,
    setText(next) { bindTextRender(tip, 'tooltip', L(next), renderTipText); },
  };
}

/* ------------------------------------------------------------
   Подпись поля с кнопкой Info у правого края.

   В Figma отступ между заголовком и Info автоматический:
   значок всегда прижат вправо, а пустое место между ними
   заполняется целиком. Здесь это распорка flex-grow.
   ------------------------------------------------------------ */
export function createLabelWithInfo(title, tipText, options = {}) {
  const { className = 'rs-field-label', ...tipOptions } = options;

  /* rs-label-row задаёт раскладку, className — типографику,
     чтобы заголовки шагов сохраняли свой размер шрифта. */
  const root = el('div', `rs-label-row ${className}`);
  root.appendChild(el('span', 'rs-field-label__text', title));

  if (!tipText) return { node: root, info: null };

  root.appendChild(el('span', 'rs-field-label__gap'));
  const info = createInfo(L(tipText), tipOptions);
  root.appendChild(info.node);

  return { node: root, info };
}

/* ------------------------------------------------------------
   Field — input field.css (366×36)
   ------------------------------------------------------------ */
export function createField({
  value = '',
  placeholder = '',
  placeholderPrefix = '',
  placeholderSuffix = '',
  at = false,
  chevron = false,
  readOnly = false,
  onInput,
  onCommit,
} = {}) {
  const root = el('div', 'rs-field');
  if (at) root.classList.add('has-at');
  if (chevron) root.classList.add('has-chevron');

  const body = el('div', 'rs-field__body');
  body.appendChild(el('span', 'rs-field__at', '@'));

  const input = document.createElement('input');
  input.className = 'rs-field__input';
  input.type = 'text';
  input.value = value;
  const splitPlaceholder = placeholderPrefix || placeholderSuffix;
  setLocalizedProperty(input, 'placeholder', splitPlaceholder ? ' ' : placeholder);
  if (readOnly) input.readOnly = true;
  body.appendChild(input);

  const prefix = el('span', 'rs-field__placeholder-prefix', placeholderPrefix);
  if (splitPlaceholder) {
    const hint = el('span', 'rs-field__split-placeholder');
    hint.setAttribute('aria-hidden', 'true');
    hint.append(prefix, el('span', 'rs-field__placeholder-suffix', placeholderSuffix));
    body.appendChild(hint);
  }

  const chevronNode = el(
    'div',
    'rs-field__chevron',
  );

  const chevronSvg =
    document.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg',
    );

  chevronSvg.setAttribute(
    'viewBox',
    '0 0 10 5',
  );

  chevronSvg.setAttribute(
    'width',
    '10',
  );

  chevronSvg.setAttribute(
    'height',
    '5',
  );

  chevronSvg.setAttribute(
    'fill',
    'none',
  );

  chevronSvg.setAttribute(
    'aria-hidden',
    'true',
  );

  const chevronPath =
    document.createElementNS(
      'http://www.w3.org/2000/svg',
      'path',
    );

  chevronPath.setAttribute(
    'd',
    'M0.5 0.5L5 4.5L9.5 0.5',
  );

  chevronPath.setAttribute(
    'fill',
    'none',
  );

  chevronPath.setAttribute(
    'stroke',
    'currentColor',
  );

  chevronPath.setAttribute(
    'stroke-width',
    '1',
  );

  chevronPath.setAttribute(
    'stroke-linecap',
    'round',
  );

  chevronPath.setAttribute(
    'stroke-linejoin',
    'round',
  );

  chevronSvg.appendChild(
    chevronPath,
  );

  chevronNode.appendChild(
    chevronSvg,
  );

  root.append(
    body,
    chevronNode,
  );

  root.addEventListener('mousedown', (event) => {
    if (event.target !== input) {
      event.preventDefault();
      input.focus();
    }
  });
  input.addEventListener('focus', () => root.classList.add('is-focus'));
  input.addEventListener('blur', () => {
    root.classList.remove('is-focus');
    if (onCommit) onCommit(input.value);
  });
  input.addEventListener('input', () => { if (onInput) onInput(input.value); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
  });

  return {
    node: root,
    input,
    get value() { return input.value; },
    setPlaceholderPrefix(next) { prefix.textContent = next; },
    set(next) { input.value = next ?? ''; },
    setDisabled(state) {
      const disabled = Boolean(state);

      root.classList.toggle(
        'is-disabled',
        disabled,
      );

      root.setAttribute(
        'aria-disabled',
        String(disabled),
      );

      input.disabled = disabled;
    },
  };
}

/* ------------------------------------------------------------
   Select — то же поле, но со выпадающим списком
   ------------------------------------------------------------ */
export function createSelect({ options = [], value, onChange } = {}) {
  const field = createField({ chevron: true, readOnly: true });
  field.node.classList.add('is-select');

  const menu = el('div', 'rs-select-menu');
  document.body.appendChild(menu);

  let items = Array.isArray(options) ? [...options] : [];
  let current = value ?? items[0]?.value ?? '';

  const labelOf = (key) =>
    items.find((option) => option.value === key)?.label ?? '';

  const render = () => {
    const label = labelOf(current);
    setLocalizedProperty(field.input, 'value', label);
    setLocalizedProperty(field.input, 'title', label);

    clear(menu);
    items.forEach((option) => {
      const item = el('button', 'rs-select-menu__item', option.label);
      setLocalizedProperty(item, 'title', option.label);

      if (option.value === current) {
        item.classList.add('is-active');
      }

      item.addEventListener('click', () => {
        current = option.value;
        render();
        close();
        if (onChange) onChange(current);
      });

      menu.appendChild(item);
    });
  };

  const close = () => {
    menu.classList.remove('is-open');
    document.removeEventListener('mousedown', outside, true);
    field.input.blur();
  };

  const outside = (event) => {
    if (!menu.contains(event.target) &&
        !field.node.contains(event.target)) {
      close();
    }
  };

  const open = () => {
    if (!items.length) return;

    const box = field.node.getBoundingClientRect();
    menu.style.minWidth = `${box.width}px`;
    menu.classList.add('is-open');

    const menuBox = menu.getBoundingClientRect();
    let top = box.bottom + 4;

    if (top + menuBox.height > window.innerHeight - 10) {
      top = box.top - menuBox.height - 4;
    }

    menu.style.left = `${box.left}px`;
    menu.style.top = `${Math.max(10, top)}px`;

    document.addEventListener('mousedown', outside, true);
  };

  field.node.addEventListener('click', () => {
    if (field.node.classList.contains('is-disabled')) return;

    if (menu.classList.contains('is-open')) close();
    else open();
  });

  render();

  return {
    dispose() { close(); menu.remove(); },
    node: field.node,
    input: field.input,

    get value() {
      return current;
    },

    set(next) {
      current = next ?? '';
      render();
    },

    setOptions(nextOptions, nextValue) {
      items = Array.isArray(nextOptions) ? [...nextOptions] : [];

      const requested = nextValue ?? current;
      const requestedExists = items.some(
        (option) => option.value === requested,
      );

      current = requestedExists
        ? requested
        : items[0]?.value ?? '';

      render();
    },

    setDisabled(state) {
      field.setDisabled(state);
    },
  };
}

/* ------------------------------------------------------------
   Spinner — Spinner.css (83×42) + два Stepper
   ------------------------------------------------------------ */
export function createSpinner({
  value = 1,
  min = 1,
  max = 999999999,
  width = 83,
  onChange,
} = {}) {
  const root = el('div', 'rs-spinner');
  root.style.width = `${width}px`;

  const field = el('div', 'rs-spinner__field');

  const input = document.createElement('input');
  input.className = 'rs-spinner__value';
  input.type = 'text';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.spellcheck = false;

  field.appendChild(input);

  const steppers = el(
    'div',
    'rs-spinner__steppers',
  );

  const up = el('div', 'rs-stepper');
  up.setAttribute('role', 'button');
  setLocalizedProperty(up, 'ariaLabel', L('Увеличить значение'));
  const upIcon = el(
    'div',
    'rs-stepper__icon',
  );

  upIcon.innerHTML = `
    <svg
      width="6"
      height="4"
      viewBox="0 0 6 4"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M5.5 3L3 0.499999L0.499999 3"
        stroke="#707070"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  `;

  up.appendChild(upIcon);

  const down = el(
    'div',
    'rs-stepper is-down',
  );

  down.setAttribute('role', 'button');
  setLocalizedProperty(down, 'ariaLabel', L('Уменьшить значение'));
  const downIcon = el(
    'div',
    'rs-stepper__icon',
  );

  downIcon.innerHTML = `
    <svg
      width="6"
      height="4"
      viewBox="0 0 6 4"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M5.5 3L3 0.499999L0.499999 3"
        stroke="#707070"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  `;

  down.appendChild(downIcon);

  steppers.append(up, down);
  root.append(field, steppers);

  let current = value;
  let isDisabled = false;

  const normalize = (next) => {
    const numeric = Number(next);

    if (!Number.isFinite(numeric)) {
      return min;
    }

    return Math.min(
      max,
      Math.max(min, Math.trunc(numeric)),
    );
  };

  const applyState = () => {
    const upDisabled =
      isDisabled || current >= max;

    const downDisabled =
      isDisabled || current <= min;

    root.classList.toggle(
      'is-disabled',
      isDisabled,
    );

    root.setAttribute(
      'aria-disabled',
      String(isDisabled),
    );

    input.disabled = isDisabled;

    up.classList.toggle(
      'is-disabled',
      upDisabled,
    );

    down.classList.toggle(
      'is-disabled',
      downDisabled,
    );

    up.setAttribute(
      'aria-disabled',
      String(upDisabled),
    );

    down.setAttribute(
      'aria-disabled',
      String(downDisabled),
    );

    up.setAttribute(
      'tabindex',
      upDisabled ? '-1' : '0',
    );

    down.setAttribute(
      'tabindex',
      downDisabled ? '-1' : '0',
    );
  };

  const apply = (
    next,
    silent = false,
  ) => {
    const normalized = normalize(next);

    current = normalized;
    input.value = String(normalized);

    applyState();

    if (!silent && onChange) {
      onChange(normalized);
    }
  };

  const commitInput = () => {
    const parsed = Number.parseInt(
      input.value,
      10,
    );

    apply(
      Number.isFinite(parsed)
        ? parsed
        : min,
    );
  };

  const stepUp = () => {
    if (
      isDisabled ||
      current >= max
    ) {
      return;
    }

    input.focus();
    apply(current + 1);
  };

  const stepDown = () => {
    if (
      isDisabled ||
      current <= min
    ) {
      return;
    }

    input.focus();
    apply(current - 1);
  };

  /*
   * Как у обычного Input field:
   * клик по свободной области переводит поле в Focus.
   * Нажатия непосредственно на Stepper обрабатываются отдельно.
   */
  root.addEventListener(
    'mousedown',
    (event) => {
      if (
        isDisabled ||
        event.target.closest('.rs-stepper')
      ) {
        return;
      }

      if (event.target !== input) {
        event.preventDefault();
        input.focus();
      }
    },
  );

  input.addEventListener(
    'focus',
    () => {
      root.classList.add('is-focus');
    },
  );

  input.addEventListener(
    'blur',
    () => {
      root.classList.remove('is-focus');
      commitInput();
    },
  );

  input.addEventListener(
    'input',
    () => {
      input.value = input.value.replace(
        /[^\d]/g,
        '',
      );
    },
  );

  input.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter') {
        input.blur();
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        stepUp();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        stepDown();
      }
    },
  );

  up.addEventListener(
    'click',
    stepUp,
  );

  down.addEventListener(
    'click',
    stepDown,
  );

  const handleStepperKey = (
    event,
    action,
  ) => {
    if (
      event.key !== 'Enter' &&
      event.key !== ' '
    ) {
      return;
    }

    event.preventDefault();
    action();
  };

  up.addEventListener(
    'keydown',
    (event) => {
      handleStepperKey(
        event,
        stepUp,
      );
    },
  );

  down.addEventListener(
    'keydown',
    (event) => {
      handleStepperKey(
        event,
        stepDown,
      );
    },
  );

  apply(value, true);

  return {
    node: root,

    input,

    get value() {
      return current;
    },

    set(next) {
      apply(next, true);
    },

    setDisabled(state) {
      isDisabled = Boolean(state);

      if (isDisabled) {
        root.classList.remove(
          'is-focus',
        );

        input.blur();
      }

      applyState();
    },
  };
}

/* ------------------------------------------------------------
   Search button — Search button.css, 5 слоёв свечения
   ------------------------------------------------------------ */
export function createGlassButton({
  label,
  onClick,
  disabled = false,
} = {}) {
  const root = el(
    'div',
    'rs-glass',
  );

  root.setAttribute(
    'role',
    'button',
  );

  const redDown = el(
    'div',
    'rs-glass__base',
  );

  const redEdges = el(
    'div',
    'rs-glass__glow rs-glass__glow--halo',
  );

  const redCenter = el(
    'div',
    'rs-glass__glow rs-glass__glow--wide',
  );

  const yellowDown = el(
    'div',
    'rs-glass__glow rs-glass__glow--core',
  );

  const leftLight = el(
    'div',
    'rs-glass__glow rs-glass__glow--line',
  );

  const plate = el(
    'div',
    'rs-glass__plate',
  );

  const text = el(
    'span',
    'rs-glass__label rs-glass__label--primary',
    label,
  );

  const textOverlay = el(
    'span',
    'rs-glass__label rs-glass__label--secondary',
    label,
  );

  textOverlay.setAttribute(
    'aria-hidden',
    'true',
  );

  root.append(
    redDown,
    redEdges,
    redCenter,
    yellowDown,
    leftLight,
    plate,
    text,
    textOverlay,
  );

  let isDisabled = Boolean(disabled);

  const applyDisabled = () => {
    root.classList.toggle(
      'is-disabled',
      isDisabled,
    );

    root.setAttribute(
      'aria-disabled',
      String(isDisabled),
    );

    root.setAttribute(
      'tabindex',
      isDisabled ? '-1' : '0',
    );

    if (isDisabled) {
      root.classList.remove(
        'is-pressed',
      );
    }
  };

  const fire = () => {
    if (isDisabled) {
      return;
    }

    if (onClick) {
      onClick();
    }
  };

  const clearPressed = () => {
    root.classList.remove(
      'is-pressed',
    );
  };

  root.addEventListener(
    'click',
    fire,
  );

  root.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key !== ' ' &&
        event.key !== 'Enter'
      ) {
        return;
      }

      if (isDisabled) {
        return;
      }

      event.preventDefault();

      root.classList.add(
        'is-pressed',
      );
    },
  );

  root.addEventListener(
    'keyup',
    (event) => {
      if (
        event.key !== ' ' &&
        event.key !== 'Enter'
      ) {
        return;
      }

      if (isDisabled) {
        return;
      }

      event.preventDefault();
      clearPressed();
      fire();
    },
  );

  root.addEventListener(
    'blur',
    clearPressed,
  );

  root.addEventListener(
    'pointercancel',
    clearPressed,
  );

    root.addEventListener(
    'pointerup',
    clearPressed,
  );

  root.addEventListener(
    'pointerleave',
    clearPressed,
  );

  applyDisabled();

  return {
    node: root,

    setLabel(next) {
      const value = String(
        next ?? '',
      );

      setUiText(text, value);
      setUiText(textOverlay, value);
    },

    setDisabled(state) {
      isDisabled = Boolean(state);
      applyDisabled();
    },
  };
}

/* ------------------------------------------------------------
   Social media button — 36×36 с иконкой
   ------------------------------------------------------------ */
export function createSocialButton({
  icon,
  title,
  active = false,
  locked = false,
  onClick,
} = {}) {
  const root = el('div', 'rs-soc');
  setLocalizedProperty(root, 'title', title);
  root.setAttribute('role', 'button');
  root.setAttribute('aria-disabled', String(locked));
  root.setAttribute('tabindex', locked ? '-1' : '0');

  root.appendChild(el('div', 'rs-soc__base'));
  ['halo', 'line', 'top'].forEach((kind) => {
    root.appendChild(el('div', `rs-soc__glow rs-soc__glow--${kind}`));
  });

  const plate = el('div', 'rs-soc__plate');
  const iconBox = el('div', 'rs-soc__icon');
  iconBox.innerHTML = icon || '';
  plate.appendChild(iconBox);
  root.appendChild(plate);

  root.classList.toggle('is-on', Boolean(active));
  root.classList.toggle('is-locked', Boolean(locked));

  root.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); root.click(); }
  });
  root.addEventListener('click', () => {
    if (root.classList.contains('is-locked')) return;
    if (onClick) onClick();
  });

  return {
    node: root,
    setActive(state) { root.classList.toggle('is-on', Boolean(state)); },
  };
}

/* ------------------------------------------------------------
   Простые кнопки
   ------------------------------------------------------------ */
export function createButton({ label, onClick, className = 'rs-btn' } = {}) {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', () => {
    if (node.classList.contains('is-disabled')) return;
    if (onClick) onClick();
  });
  return {
    node,
    setLabel(next) { setUiText(node, next); },
    setDisabled(state) { node.classList.toggle('is-disabled', Boolean(state)); },
  };
}

export function createGhostButton(options) {
  return createButton({ ...options, className: 'rs-btn-ghost' });
}

/* ------------------------------------------------------------
   Кнопка редактирования ячейки
   ------------------------------------------------------------ */
export function createEditButton(onClick) {
  const node = el('button', 'rs-edit');
  node.type = 'button';
  setLocalizedProperty(node, 'title', L('Редактировать'));
  node.appendChild(el('span', 'rs-edit__icon'));
  node.addEventListener('click', (event) => {
    event.stopPropagation();
    if (onClick) onClick();
  });
  return node;
}

/*
 * Кнопка сброса ручного изменения ячейки.
 *
 * Использует базовый класс rs-edit, поэтому геометрия,
 * фон, границы и состояния полностью совпадают
 * с кнопкой редактирования.
 */
export function createResetButton(onClick) {
  const node = el(
    'button',
    'rs-edit rs-edit--reset',
  );

  node.type = 'button';
  setLocalizedProperty(node, 'title', L('Сбросить изменения'));

  node.setAttribute(
    'aria-label',
    'Сбросить изменения',
  );

  const icon = el(
    'span',
    'rs-reset__icon',
  );

  icon.setAttribute(
    'aria-hidden',
    'true',
  );

  icon.innerHTML = `
    <svg
      width="12"
      height="11"
      viewBox="0 0 12 11"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M0.593858 6.61553C0.638229 6.44826 0.833309 6.37296 0.97815 6.46762L2.88804 7.71868C3.06101 7.83212 3.03321 8.09404 2.84011 8.16819L2.06822 8.46319C2.93649 9.54457 4.26813 10.2381 5.76321 10.2381C7.72563 10.238 9.40894 9.04512 10.1284 7.34518C10.1929 7.19309 10.3385 7.08829 10.5036 7.08819C10.7656 7.08819 10.9534 7.3416 10.854 7.58398C10.0328 9.58803 8.06326 10.9999 5.76321 11C3.94031 11 2.32506 10.113 1.32443 8.74745L0.345101 9.12342C0.151831 9.19746 -0.0440827 9.02182 0.00874199 8.82181L0.593858 6.61553Z"
        fill="#B4B4B4"
      />
      <path
        d="M5.76321 0C7.94532 0.000140344 9.82908 1.27115 10.7177 3.11276L11.6887 2.88965C11.8905 2.84318 12.0599 3.0443 11.9797 3.23505L11.0937 5.33887C11.0265 5.49841 10.8223 5.54548 10.6921 5.43142L8.97474 3.92751C8.81915 3.79108 8.88376 3.53602 9.08548 3.48956L9.95406 3.28876C9.15986 1.78606 7.58156 0.762005 5.76321 0.761869C3.43416 0.761869 1.49786 2.4415 1.09964 4.6555C1.0649 4.8486 0.902456 4.99748 0.706253 4.9976C0.480749 4.9976 0.302805 4.80347 0.340142 4.58113C0.777506 1.9811 3.03845 0 5.76321 0Z"
        fill="#B4B4B4"
      />
    </svg>
  `;

  node.appendChild(icon);

  node.addEventListener(
    'click',
    (event) => {
      event.stopPropagation();

      if (onClick) {
        onClick();
      }
    },
  );

  return node;
}
