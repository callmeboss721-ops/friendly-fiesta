import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = JSON.parse(await readFile(resolve(root, 'tokens/ce-empire-2026.json'), 'utf8'));
const kebab = (value) => value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const lines = ['/* Generated from tokens/ce-empire-2026.json. Do not edit directly. */', ':root {'];
for (const [group, values] of Object.entries(source)) {
  if (group.startsWith('$') || group === 'typography') continue;
  for (const [name, value] of Object.entries(values)) lines.push(`  --ce-${group}-${kebab(name)}: ${String(value).toLowerCase()};`);
}
lines.push('}', '');
await writeFile(resolve(root, 'app/generated-tokens.css'), lines.join('\n'));
