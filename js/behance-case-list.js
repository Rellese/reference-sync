import { el } from './ui.js';
import { L, setLocalizedProperty } from './i18n.js';
import { componentDisplay } from './carousel-selection.js';

// Insert informational blocks around the existing selectable rows. Component
// positions and their event handlers remain the download selection's identity.
export function showBehanceCaseBlocks(list, post) {
  if (post?.source !== 'behance' || !post.caseDocument?.blocks?.length) return;
  const rows = new Map([...list.children].map(row => [Number(row.dataset.carouselComponentIndex), row]));
  const positions = new Map(post.components.map((component, index) => [componentDisplay(component, index).number, index]));
  const ordered = [];
  for (const [index, block] of post.caseDocument.blocks.entries()) {
    const position = positions.get(block.componentNumber);
    const existing = rows.get(position);
    if (existing) {
      existing.querySelector('.rs-carousel-modal__position').textContent = `${index + 1}.`;
      ordered.push(existing);
      rows.delete(position);
      continue;
    }
    const row = el('div', 'rs-case-block-info');
    row.dataset.caseBlockStatus = block.status;
    const label = block.kind === 'text' ? 'Текст — не отдельный файл'
      : block.status === 'unsupported' ? 'Неподдерживаемый блок' : 'Блок недоступен для скачивания';
    row.append(el('span', 'rs-carousel-modal__position', `${index + 1}.`), el('span', 'rs-case-block-info__status', L(label)));
    if (block.text) {
      const text = el('span', 'rs-case-block-info__text', block.text);
      text.title = block.text;
      row.append(text);
    }
    setLocalizedProperty(row, 'aria-label', L(label));
    ordered.push(row);
  }
  list.replaceChildren(...ordered, ...rows.values());
}
