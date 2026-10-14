// Compose independent numbering and text rules without changing user edits.
export function composeNaming({ name, description, counters, values, descriptions = [] }) {
  const parts = { name: [name], description: [description] };
  for (const counter of counters) {
    const value = values?.[counter.id];
    if (!Number.isInteger(value)) continue;
    const text = `${counter.marker ?? ''}${value}`;
    const targets = counter.destination === 'both' ? ['name', 'description'] : [counter.destination];
    for (const target of targets) if (parts[target]) parts[target].push(text);
  }
  for (const rule of descriptions) {
    const text = String(rule.text || '').trim();
    if (!text) continue;
    const targets = rule.destination === 'both' ? ['name', 'description'] : [rule.destination];
    for (const target of targets) {
      if (!parts[target]) continue;
      if (rule.placement === 'start') parts[target].unshift(text);
      else parts[target].push(text);
    }
  }
  return {
    name: parts.name.filter(Boolean).join(' '),
    description: parts.description.filter(Boolean).join('\n\n'),
  };
}
