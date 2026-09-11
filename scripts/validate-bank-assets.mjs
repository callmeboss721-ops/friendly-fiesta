import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = await readFile(resolve(root, 'src/lib/bankBrands.ts'), 'utf8');
for (const code of ['KBANK', 'SCB', 'KTB', 'BBL', 'BAY', 'TTB', 'GSB']) {
  if (!source.includes(`${code}:`)) throw new Error(`Missing bank registry entry: ${code}`);
}
const assetMatches = [...source.matchAll(/localAsset: '([^']+)'/g)].map((match) => match[1]);
for (const asset of assetMatches) await access(resolve(root, 'public', asset.replace(/^\//, '')));
if (assetMatches.length && source.includes('officialSource: null')) throw new Error('Local bank assets require official provenance.');
console.log(`Bank registry valid; ${assetMatches.length} provenance-verified local assets.`);
