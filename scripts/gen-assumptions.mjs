// Generates ASSUMPTIONS.md from src/data/assumptions.json so the page and the file never drift apart.
import { readFileSync, writeFileSync } from 'node:fs';

export function render() {
  const { assumptions } = JSON.parse(readFileSync(new URL('../src/data/assumptions.json', import.meta.url), 'utf8'));
  const label = { STANDARD: 'Standard says', IMPLEMENTATION_VARIES: 'Implementations vary' };
  const lines = [
    '# Assumptions',
    '',
    'Generated from `src/data/assumptions.json` (run `npm run assumptions`). The same list is shown in the Assumptions panel of the tool.',
    'Entries `S-n` are required by spec section 7A.13. Entries `A-n` are choices made while implementing, where the spec was ambiguous.',
    '',
    '| ID | Area | Label | Source | Added in | Assumption |',
    '|----|------|-------|--------|----------|------------|',
  ];
  for (const a of assumptions) lines.push(`| ${a.id} | ${a.area} | ${label[a.label]} | ${a.source} | ${a.milestone} | ${a.text.replace(/\|/g, '\\|')} |`);
  return lines.join('\n') + '\n';
}

if (process.argv[1] && process.argv[1].endsWith('gen-assumptions.mjs')) {
  writeFileSync(new URL('../ASSUMPTIONS.md', import.meta.url), render());
}
