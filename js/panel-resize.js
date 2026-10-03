import { L, setLocalizedProperty } from './i18n.js';
// Handles occupy only the five-pixel gaps between the affected panels.
export function installPanelResizers({ app, work, right, settings, results, naming }) {
  const handles = [];
  let width = 403, height = null;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  try {
    const saved = JSON.parse(localStorage.getItem('rs-panel-sizes') || '{}');
    if (Number.isFinite(saved.width)) width = saved.width;
    if (Number.isFinite(saved.height)) height = saved.height;
  } catch { /* Defaults also work when storage is unavailable. */ }
  function apply() {
    width = clamp(width, 280, Math.max(280, work.clientWidth - 550));
    app.style.setProperty('--rs-settings-width', `${width}px`);
    if (height !== null) {
      height = clamp(height, 120, Math.max(120, right.clientHeight - 240));
      right.style.setProperty('--rs-naming-height', `${height}px`);
    }
  }
  function save() {
    try { localStorage.setItem('rs-panel-sizes', JSON.stringify({ width, height })); } catch {}
  }
  function position() {
    const origin = app.getBoundingClientRect();
    const left = settings.getBoundingClientRect();
    const bottom = naming.getBoundingClientRect();
    const table = results.getBoundingClientRect();
    Object.assign(handles[0].style, { left: `${left.right - origin.left}px`, top: `${left.top - origin.top}px`, height: `${left.height}px` });
    Object.assign(handles[1].style, { left: `${table.left - origin.left}px`, top: `${bottom.top - origin.top - 5}px`, width: `${table.width}px` });
  }
  for (const axis of ['width', 'height']) {
    const handle = document.createElement('div');
    handle.className = `rs-panel-resizer rs-panel-resizer--${axis}`;
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    setLocalizedProperty(handle, 'ariaLabel', L(axis === 'width' ? 'Ширина настроек' : 'Высота настроек имён'));
    handle.setAttribute('aria-orientation', axis === 'width' ? 'vertical' : 'horizontal');
    let drag = null;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag = { x: event.clientX, y: event.clientY, width, height: naming.getBoundingClientRect().height };
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('is-dragging');
    });
    handle.addEventListener('pointermove', event => {
      if (!drag) return;
      if (axis === 'width') width = drag.width + event.clientX - drag.x;
      else height = drag.height - event.clientY + drag.y;
      apply();
      position();
    });
    const stop = () => { if (!drag) return; drag = null; handle.classList.remove('is-dragging'); save(); };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('lostpointercapture', stop);
    handle.addEventListener('dblclick', event => {
      event.preventDefault();
      if (axis === 'width') width = 403;
      else { height = null; right.style.removeProperty('--rs-naming-height'); }
      apply(); position(); save();
    });
    handle.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const delta = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -10 : 10;
      if (axis === 'width') width += delta;
      else height = (height ?? naming.getBoundingClientRect().height) - delta;
      apply(); position(); save();
    });
    app.appendChild(handle);
    handles.push(handle);
  }
  apply();
  const observer = new ResizeObserver(() => { apply(); position(); });
  for (const node of [work, right, naming, settings]) observer.observe(node);
  position();
}
