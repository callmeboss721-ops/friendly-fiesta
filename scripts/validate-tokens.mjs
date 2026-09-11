import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const tokens = JSON.parse(await readFile(resolve(root, 'tokens/ce-empire-2026.json'), 'utf8'));
for (const group of ['color', 'spacing', 'radius', 'motion', 'elevation', 'typography']) {
  if (!tokens[group] || Object.keys(tokens[group]).length === 0) throw new Error(`Missing token group: ${group}`);
}
for (const [name, color] of Object.entries(tokens.color)) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Invalid color token: ${name}`);
}
console.log('CE 2026 design tokens are valid.');
