// Portable project styling: never carry source CSS, URLs or executable values.
export function caseBackground(value) {
  const color=typeof value==='string' ? value.trim() : '';
  if(!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color))return '';
  const hex=color.slice(1);
  return '#'+(hex.length<5 ? [...hex].map(c=>c+c).join('') : hex).toUpperCase();
}
export function caseSpacing(value) {
  if(typeof value!=='number' && (typeof value!=='string'||!/^\d+(?:\.\d+)?(?:px)?$/.test(value.trim())))return null;
  const number=typeof value==='number' ? value : Number(value.trim().replace(/px$/,''));
  return Number.isFinite(number)&&number>=0&&number<=10000 ? number : null;
}
export function caseLayout(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  return {backgroundColor:caseBackground(value.backgroundColor),
    topSpacing:caseSpacing(value.topSpacing) ?? 0,blockSpacing:caseSpacing(value.blockSpacing) ?? 0};
}
