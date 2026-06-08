import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

function collectGaps(value: unknown): string[] {
  const gaps: string[] = [];
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if ((v as { kind?: string }).kind === 'unknown') {
      gaps.push(String((v as { raw?: string }).raw || ''));
      return;
    }
    if (Array.isArray(v)) return v.forEach(walk);
    for (const [k, c] of Object.entries(v)) {
      if (!['raw', 'text', 'effectText'].includes(k)) walk(c);
    }
  };
  walk(value);
  return gaps;
}

const samples = [
  'draw a card. enchanted creature has protection from creatures.',
  'draw a card. crew 3 you may cast this card from your graveyard',
  'then discard two cards unless you discard a pirate card',
  'scry 1.")',
  'you gain life equal to the life you lost when it entered',
  'put the same number of each kind of counter on that creature',
  'the player with the lowest life total gains control of this creature',
  'for each opponent, you may cast up to one target instant or sorcery card',
  'you and target opponent each reveal the top card of your library',
];

for (const t of samples) {
  const ir = parseOracleTextToIR(t, 'Test');
  const gaps: string[] = [];
  for (const a of ir.abilities || []) {
    for (const s of a.steps || []) collectGaps(s).forEach((g) => gaps.push(g));
  }
  console.log('\n---', t.slice(0, 70));
  console.log('gaps:', gaps);
  console.log('abilities:', ir.abilities?.length);
  console.log('steps:', JSON.stringify(ir.abilities?.[0]?.steps, null, 2));
  if (gaps.length && (ir.abilities?.[0]?.steps?.length ?? 0) <= 1) {
    console.log('FULL:', JSON.stringify(ir.abilities, null, 2));
  }
}
