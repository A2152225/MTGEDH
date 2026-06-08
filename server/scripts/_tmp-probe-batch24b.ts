import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

function gaps(text: string): string[] {
  const ir = parseOracleTextToIR(text, 'Test');
  const g: string[] = [];
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if ((v as { kind?: string }).kind === 'unknown') {
      g.push(String((v as { raw?: string }).raw || ''));
      return;
    }
    if (Array.isArray(v)) return v.forEach(walk);
    for (const [k, c] of Object.entries(v)) {
      if (!['raw', 'text', 'effectText'].includes(k)) walk(c);
    }
  };
  for (const a of ir.abilities || []) for (const s of a.steps || []) walk(s);
  return g;
}

const samples = [
  'you gain X life and draw X cards',
  'gain X life and draw X cards',
  'another',
  'that many',
  'two cards at random',
  'any number of land cards',
  'miracle {1}{b}',
  'crew 3 cycling {w}',
  'soulshift 2',
];

for (const s of samples) console.log(s, '->', gaps(s).length ? gaps(s) : 'OK');
