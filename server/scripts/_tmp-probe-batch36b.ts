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
  'this creature crews vehicles as though its power were 2 greater',
  'the player gets another poison counter at the beginning of their next upkeep unless they pay {2} before that step',
  'until end of turn, whenever one or more gorgons and/or snakes you control deal combat damage to a player, that player loses half their life, rounded up',
  'twice that much',
  'then draw half x cards, rounded down',
  'hand, and library, seek two creature cards with mana value 3 or less',
  'that player attaches this aura to a land of their choice',
  'the excess damage dealt this way',
  'then copy it if you control an enchantment. you may choose new targets for the copies',
  'you skip your next two turns',
  'this effect can\'t reduce their speed below 1',
  'then amass orcs x, where x is the number of equipment attached to this permanent',
  'target player can\'t cast spells until a player planeswalks',
  'that player reveals the chosen card, puts it on the bottom of their library',
  'radha\'s firebrand gets +2/+2 until end of turn',
  'you may have your life total become the total toughness of creatures you control',
  'then if this enchantment has three or more invitation counters on it, transform it',
  'your maximum hand size is equal to the number of hour counters on this enchantment',
  'you may pay {1} rather than pay the mana cost for rune spells you cast',
  'this creature can block an additional creature each combat as long as you\'re the monarch',
  'another card',
  'until a player planeswalks, you can\'t lose the game and your opponents can\'t win the game',
  'the player who controls the most creatures gains control of this creature',
  'until end of turn, this creature gets +2/+2 and gains lifelink',
  'then you may pay {1} and 3 life',
  'that player chooses target player who has more life than they do and is their opponent',
  'this',
];

for (const t of samples) {
  const ir = parseOracleTextToIR(t, 'Test');
  const gaps: string[] = [];
  for (const a of ir.abilities || []) {
    for (const s of a.steps || []) collectGaps(s).forEach((g) => gaps.push(g));
  }
  console.log(gaps.length ? `FAIL [${gaps[0].slice(0, 80)}]` : 'OK', t.slice(0, 75));
}
