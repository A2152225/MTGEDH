import fs from 'node:fs';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';

function collectUnknowns(value: unknown): string[] {
  const unknowns: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ((node as { kind?: string }).kind === 'unknown') {
      unknowns.push(String((node as { raw?: string }).raw ?? ''));
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'raw' || key === 'text' || key === 'effectText') continue;
      walk(child);
    }
  };
  walk(value);
  return unknowns.filter(Boolean);
}

const cards = JSON.parse(fs.readFileSync('oracle-cards.json', 'utf8')) as Array<{ name: string; oracle_text?: string }>;
const names = ['Gift Shop', 'Balloon Stand', 'Wildfire Howl', 'Funeral Rites', 'Mind Shatter', 'Unctus, Grand Metatect'];
for (const name of names) {
  const card = cards.find((c) => c.name === name);
  if (!card?.oracle_text) continue;
  const gaps = collectUnknowns(parseOracleTextToIR(card.oracle_text, name));
  console.log(`\n=== ${name} ===`);
  console.log('gaps:', gaps);
}
