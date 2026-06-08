import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

function gaps(text: string): string[] {
  const ir = parseOracleTextToIR(text, 'T');
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
  'look at their hand',
  'you draw a card and convert this permanent',
  'target opponent loses life equal to the life that player lost this turn',
  'the life that player lost this turn',
  'draft a card from this creature\'s spellbook',
  'you may pay any amount of life',
  'your maximum hand size is five',
  'draw a card and reveal it',
  'a card and reveal it',
];
for (const s of samples) {
  console.log('\n===', s.slice(0, 90), '===');
  console.log('gaps:', gaps(s).length ? gaps(s) : 'OK');
  console.log('steps:', JSON.stringify(parseOracleTextToIR(s, 'T').abilities?.[0]?.steps, null, 2));
}
