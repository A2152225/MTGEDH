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
  'you gain x life and draw x cards, where x is the number of permanents you own that your opponents control.',
  'x life and draw x cards',
  'you may tap another untapped citizen you control. if you do, this creature gets +1/+0 and gains lifelink until end of turn.',
  'exile that many cards from the top of your library. until end of turn, you may cast spells from among those exiled cards.',
  'search your library for up to x basic land cards, where x is the number of colors among permanents you control. reveal those cards, put them into your hand, then shuffle. you may play an additional land on each of your turns.',
  'you may remove any number of +1/+1 counters from among creatures you control. if you do, put twice that many +1/+1 counters on this creature.',
  'discard it into exile. when you do, cast it for its madness cost or put it into your graveyard.)',
];

for (const s of samples) {
  console.log('\n===', s.slice(0, 90), '===');
  console.log('gaps:', gaps(s).length ? gaps(s) : 'OK');
  const ir = parseOracleTextToIR(s, 'Test');
  console.log('steps:', JSON.stringify(ir.abilities?.[0]?.steps, null, 2));
}
