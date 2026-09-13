import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Telegram bot token', /\b\d{7,12}:[A-Za-z0-9_-]{30,}\b/],
  ['Supabase service key', /\bsb_secret_[A-Za-z0-9_-]{20,}\b/],
  ['generic assigned secret', /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][A-Za-z0-9_\-/+=]{24,}["']/i],
];
const allow = new Set(['package-lock.json']);
const findings = [];
for (const file of files) {
  if (allow.has(file) || /\.(?:png|jpe?g|gif|webp|ico|woff2?)$/i.test(file)) continue;
  let content;
  try { content = await readFile(file, 'utf8'); } catch { continue; }
  const lines = content.split('\n');
  for (const [name, pattern] of patterns) {
    const lineIndex = lines.findIndex((line) => !/(?:\.repeat\(|test-key|placeholder|example\.com|\$\{)/i.test(line) && pattern.test(line));
    if (lineIndex >= 0) findings.push(`${file}:${lineIndex + 1}: ${name}`);
  }
}
if (findings.length) {
  console.error(`Potential secrets detected:\n${findings.join('\n')}`);
  process.exit(1);
}
console.log(`Secret scan passed for ${files.length} tracked files.`);
