import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const oraclePath = path.join(repoRoot, 'oracle-cards.json');
const atomicPath = path.join(repoRoot, 'AtomicCards.json');

const oracle = JSON.parse(fs.readFileSync(oraclePath, 'utf8'));
const cards = Array.isArray(oracle) ? oracle : Array.isArray(oracle?.data) ? oracle.data : [];
console.log('oracle_cards', cards.length);

const setKeys = new Set<string>();
const sampleBySet = new Map<string, string[]>();
for (const card of cards) {
  const set = String(card?.set || card?.set_code || card?.setCode || '').trim();
  if (set) {
    setKeys.add(set);
    if (!sampleBySet.has(set)) sampleBySet.set(set, []);
    const samples = sampleBySet.get(set)!;
    if (samples.length < 2) samples.push(String(card?.name || ''));
  }
}

const targetSets = ['MSH', 'HOB', 'HOC', 'MSC'];
for (const code of targetSets) {
  console.log(code, 'count', cards.filter((c: any) => String(c?.set || c?.set_code || c?.setCode || '') === code).length, 'samples', sampleBySet.get(code));
}

const recentSets = [...setKeys].filter((s) => /^(MSH|HOB|HOC|MSC|MAR|UN|BLB|DSK)/i.test(s)).sort();
console.log('matching_set_codes', recentSets.slice(0, 30));

const nameHits = cards
  .filter((c: any) => /spider|hobbit|marvel|bilbo|gandalf|sauron/i.test(String(c?.name || '')))
  .slice(0, 10)
  .map((c: any) => `${c.name} [${c.set || c.set_code || '?'}]`);
console.log('name_hits', nameHits);

const atomic = JSON.parse(fs.readFileSync(atomicPath, 'utf8'));
const data = atomic?.data || {};
let atomicSetHits = 0;
for (const printings of Object.values(data) as any[]) {
  if (!Array.isArray(printings)) continue;
  for (const printing of printings) {
    const set = String(printing?.setCode || printing?.set || '').trim();
    if (targetSets.includes(set)) atomicSetHits += 1;
  }
}
console.log('atomic_target_set_printings', atomicSetHits);
