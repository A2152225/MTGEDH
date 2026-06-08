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
  'each opponent discards a card and loses 2 life',
  'exile cards from the top of your library until you exile a nonland permanent card. put that card onto the battlefield or into your hand.',
  'until you exile a nonland permanent card',
  'draw a card if you control a creature with the greatest power among creatures on the battlefield',
  'draw a card if your life total is greater than your starting life total',
  'Until end of turn, if you would draw a card, draw two cards instead.',
];
for (const s of samples) {
  console.log('\n===', s.slice(0, 90), '===');
  console.log('gaps:', gaps(s).length ? gaps(s) : 'OK');
  const ir = parseOracleTextToIR(s, 'T');
  console.log('steps:', JSON.stringify(ir.abilities?.[0]?.steps, null, 2));
}
