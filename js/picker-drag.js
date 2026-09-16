// One active drag; visible rows only, with edge scrolling and cleanup on cancellation.
export function startPickerDrag({ event, body, gesture, apply, active }) {
  let x = event.clientX, y = event.clientY, frame = null;
  const origin = event.target;
  let moved = false;
  let lastId = gesture.getAnchor();
  function visit() {
    if (!active() || !gesture.isDragging()) { end(); return; }
    const bounds = body.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right) return;
    const rows = [...body.querySelectorAll('[data-collection-picker-id]')].filter(row => row.getClientRects().length);
    const row = rows.find(row => { const box = row.getBoundingClientRect(); return y >= box.top && y <= box.bottom; });
    if (row) {
      const current = rows.indexOf(row), previous = rows.findIndex(item => item.dataset.collectionPickerId === lastId);
      const range = previous < 0 ? [row] : rows.slice(Math.min(previous, current), Math.max(previous, current) + 1);
      for (const item of range) {
        const action = gesture.visitDrag(item.dataset.collectionPickerId);
        if (action) apply(action.id, action.checked);
      }
      lastId = row.dataset.collectionPickerId;
    }
    const delta = y < bounds.top + 28 ? -10 : y > bounds.bottom - 28 ? 10 : 0;
    if (delta) body.scrollTop += delta;
  }
  function tick() { frame = null; if (!gesture.isDragging()) return; visit(); frame = requestAnimationFrame(tick); }
  function move(next) {
    if (!(next.buttons & 1)) { end(); return; }
    moved ||= Math.abs(next.clientX - x) + Math.abs(next.clientY - y) > 2;
    x = next.clientX; y = next.clientY;
    visit();
  }
  function suppressClick(next) { if (moved && !origin.contains(next.target)) { next.preventDefault(); next.stopPropagation(); } }
  function end() {
    gesture.endDrag();
    if (frame !== null) cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    window.removeEventListener('blur', end);
    setTimeout(() => window.removeEventListener('click', suppressClick, true), 0);
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('blur', end);
  window.addEventListener('click', suppressClick, true);
  frame = requestAnimationFrame(tick);
}
