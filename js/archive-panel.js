import { el } from './ui.js';
export function createArchivePicker(onFile, onResolve) {
  const root = el('div', 'rs-archive');
  const drop = el('button', 'rs-archive__drop', 'Перетащите ZIP, JSON или HTML сюда\nили выберите файл');
  drop.type = 'button';
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.zip,.json,.html,.htm'; input.hidden = true;
  const hint = el('div', 'rs-hint', 'Файлы внутри архива импортируются локально. Для сохранённых ссылок нужен доступ к соцсети через выбранный профиль браузера.');
  const result = el('div', 'rs-hint');
  const resolve = el('button', 'rs-btn-ghost', 'Загрузить публикации по ссылкам');
  resolve.hidden = true; resolve.addEventListener('click', () => onResolve?.());
  function choose(file) { if (file) onFile?.(file); input.value = ''; }
  drop.addEventListener('click', () => input.click());
  input.addEventListener('change', () => choose(input.files[0]));
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('is-over'); choose(event.dataTransfer.files[0]); });
  root.append(drop, input, hint, result, resolve);
  return { node: root, setStatus(text, links = 0) { result.textContent = text; resolve.hidden = links === 0; } };
}
