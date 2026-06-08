import { readFileSync } from 'fs';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));
for (const n of ['Scald', "Teferi's Puzzle Box", 'Font of Mythos', 'The Reaper, King No More', 'Elderfang Venom', 'Tovolar, Dire Overlord']) {
  const c = cards.find((x: { name: string; layout?: string }) => (x.name === n || x.name.startsWith(n)) && x.layout !== 'art_series');
  if (!c) {
    console.log('MISS', n);
    continue;
  }
  const o = c.card_faces ? c.card_faces.map((f: { oracle_text?: string }) => f.oracle_text).join('\n') : c.oracle_text;
  console.log('===', c.name, '===\n', o, '\n');
}
