import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = JSON.parse(await readFile(resolve(root, 'tokens/ce-empire-2026.json'), 'utf8'));
const kebab = (value) => value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const cssLines = ['/* Generated from tokens/ce-empire-2026.json. Do not edit directly. */', ':root {'];
for (const [group, values] of Object.entries(source)) {
  if (group.startsWith('$') || group === 'typography') continue;
  const cssGroup = group === 'elevation' ? 'shadow' : group === 'spacing' ? 'space' : group;
  for (const [name, value] of Object.entries(values)) cssLines.push(`  --ce-${cssGroup}-${kebab(name)}: ${String(value).toLowerCase()};`);
}
cssLines.push('}', '');
const css = cssLines.join('\n');
const tokenGroups = Object.fromEntries(Object.entries(source).filter(([name]) => !name.startsWith('$')));
const ts = `// Generated from tokens/ce-empire-2026.json. Do not edit directly.\nexport const ceTokens = ${JSON.stringify(tokenGroups, null, 2)} as const;\n\nexport type CeTokenColor = keyof typeof ceTokens.color;\n`;
const outputs = [
  [resolve(root, 'app/generated-tokens.css'), css],
  [resolve(root, 'src/lib/designTokens.generated.ts'), ts],
];
if (process.argv.includes('--check')) {
  for (const [path, expected] of outputs) {
    const current = await readFile(path, 'utf8').catch(() => '');
    if (current !== expected) throw new Error(`Generated token output is stale: ${path}`);
  }
  console.log('Generated token outputs are current.');
} else {
  await Promise.all(outputs.map(([path, content]) => writeFile(path, content)));
  console.log('Generated CE 2026 CSS and TypeScript tokens.');
}
