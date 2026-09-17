import { messages } from './locales/messages.js';

export const languages = ['ru', 'en', 'fr', 'es', 'zh'];
let language = 'ru';
const bindings = new Set();
const nodeBindings = new WeakMap();
const exact = new Map(messages.map(row => [row[0], row]));
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = messages.filter(row => /\{\d+\}/.test(row[0])).map(row => {
  const slots = [];
  const pieces = row[0].split(/(\{\d+\})/);
  const regex = new RegExp('^' + pieces.map(piece => /^\{\d+\}$/.test(piece)
    ? (slots.push(piece), '([\\s\\S]*?)') : escapeRegex(piece)).join('') + '$');
  return { row, slots, regex };
}).sort((a, b) => b.row[0].replace(/\{\d+\}/g, '').length - a.row[0].replace(/\{\d+\}/g, '').length);

export function normalizeLanguage(code) {
  const value = String(code || '').toLowerCase();
  return value === 'ру' ? 'ru' : value === '中文' ? 'zh' : languages.includes(value) ? value : 'ru';
}
export const getLanguage = () => language;
export function translate(source, locale = language) {
  if (source?.parts) return source.parts.map(part => part instanceof InterfaceText ? translate(part, locale) : String(part ?? '')).join('');
  const text = String(source ?? '');
  const column = { en: 1, fr: 2, es: 3, zh: 4 }[normalizeLanguage(locale)];
  if (!column) return text;
  const row = exact.get(text);
  if (row) return row[column];
  for (const pattern of patterns) {
    const match = pattern.regex.exec(text);
    if (!match) continue;
    const values = new Map(pattern.slots.map((slot, i) => [slot, match[i + 1]]));
    return pattern.row[column].replace(/\{\d+\}/g, slot => values.get(slot) ?? slot);
  }
  return text;
}

// Only explicitly marked interface text is translated. User content stays raw.
class InterfaceText extends String {}
export const L = text => text instanceof InterfaceText ? text : new InterfaceText(text ?? '');
export function joinText(...parts) {
  const value = L(parts.join(''));
  value.parts = parts;
  return value;
}
export function setText(node, text) {
  node.textContent = '';
  const leaf = node.ownerDocument.createTextNode('');
  node.appendChild(leaf);
  bindTextRender(leaf, 'nodeValue', text, (target, value) => { target.nodeValue = value; });
}
export function setUiText(node, text) { setText(node, L(text)); }
export function setLocalizedProperty(node, property, value) {
  bindTextRender(node, property, value, (target, text) => { target[property] = text; });
}
export function bindTextRender(node, key, value, render) {
  let map = nodeBindings.get(node);
  if (!map) { map = new Map(); nodeBindings.set(node, map); }
  const previous = map.get(key);
  if (previous) bindings.delete(previous);
  map.delete(key);
  if (!(value instanceof InterfaceText)) { render(node, String(value ?? '')); return; }
  const binding = { node: new WeakRef(node), source: value, render };
  map.set(key, binding); bindings.add(binding);
  render(node, translate(binding.source));
}
export function setLanguage(code) {
  language = normalizeLanguage(code);
  if (typeof document !== 'undefined') document.documentElement.lang = language === 'zh' ? 'zh-CN' : language;
  for (const binding of bindings) {
    const node = binding.node.deref();
    if (!node || !node.isConnected) { bindings.delete(binding); continue; }
    binding.render(node, translate(binding.source));
  }
  return language;
}
