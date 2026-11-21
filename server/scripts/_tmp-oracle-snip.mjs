import fs from 'node:fs';
const names = new Set(['Showstopping Surprise', 'Haywire Mite']);
const text = fs.readFileSync(new URL('../../oracle-cards.jsonl', import.meta.url), 'utf8');
for (const line of text.split(/\n/)) {
  if (!line) continue;
  let row;
  try { row = JSON.parse(line); } catch { continue; }
  if (!names.has(row.name)) continue;
  console.log('NAME', row.name);
  console.log('TYPE', row.type_line);
  console.log('ORACLE', row.oracle_text);
  console.log('---');
}
