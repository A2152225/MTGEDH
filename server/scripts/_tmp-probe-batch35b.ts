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
  'x life and you gain x',
  'where x is this creature\'s power',
  'this permanent\'s power',
  'you may reveal a permanent card from among them and put it into your hand. put the rest on the bottom of your library',
  'until end of turn, that player can\'t cast spells, you may look at the top card of their library any time, you may play the top card of their library, and you may spend mana as though it were mana of any color to cast spells this way',
  'the player gets another poison counter at the beginning of their next upkeep unless they pay {2} before that upkeep',
  'storied matriarch, return up to one target goblin card from your graveyard to your hand',
  'bert, and william die, if they were a creature, return them to the battlefield',
  'vehicles you control have crew 1',
  'you may move all counters from this permanent onto target creature',
  'you may draw x cards, where x is the number of shrines you control',
  'this creature isn\'t a creature until end of turn',
  'you may have that opponent gain control of this permanent until end of combat',
  'then conjure two cards named mishra\'s foundry onto the battlefield tapped',
  'you may copy it, except the copy is a 1/1 spirit in addition to its other types',
];

for (const t of samples) {
  const ir = parseOracleTextToIR(t, 'Test');
  const gaps: string[] = [];
  for (const a of ir.abilities || []) {
    for (const s of a.steps || []) collectGaps(s).forEach((g) => gaps.push(g));
  }
  console.log(gaps.length ? `FAIL [${gaps[0].slice(0, 80)}]` : 'OK', t.slice(0, 75));
}
