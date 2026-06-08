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
  'add an additional one mana of any type that land produced for each other land you control with the same name as it',
  'add x {g} or x {w}, where x is the number of other creatures you control',
  'aftermath create a treasure token for each creature you controlled that dealt combat damage to a player this turn',
  'damage equal to the number of charge counters on it to target player and that much',
  'damage equal to the number of quest counters on it to up to one target creature unless that creature\'s controller has this permanent deal that much',
  'dog, or hero spell, create a food token',
  'draw a card.") {2}, Sacrifice another creature or a Blood token: Each opponent',
  'for each delay counter removed this way, you lose 1 life unless you',
  'for each other permanent or player the spell or ability could target',
  'for each other creature that the spell could target',
  'for each other creature you control that the spell could target',
  'fuse create four 1/1 white bird creature tokens with flying',
  'hand, and library, seek two creature cards with mana value 3 or less',
  'horde, exile them',
  'increase your speed by 1',
  'level 2 equip abilities you activate cost {2} less to activate',
  'level 3 you may look at the top card of your library any time',
  'life and discards cards equal to the number of permanents they control but don\'t own',
  'mayhem cost is equal to its mana cost',
  'miracle {w}{w}',
  'no life instead',
  'otherwise, you',
  'penitent culler, mill three cards',
  'prowess if a noncreature source you control would deal damage to a creature, battle, or opponent, it deals that much damage plus 2 instead',
  'rimebound and at the beginning of your first main phase, add two mana of any one color',
  'scry 1.")',
  'sorcery, or villain spell each turn, exile it',
  'soulshift 4',
  'spell mastery -',
  'station 3+',
  'that creature\'s mana value',
  'that creature\'s owner can\'t cast spells with the same name as that creature until your next turn',
  'that many cards and each other player loses that much',
  'that many cards minus one',
  'that player adds two mana of any one color they choose',
  'that player simultaneously untaps each tapped artifact, creature, and land they control and taps each untapped artifact, creature, and land they control',
  'that source\'s controller exiles a card from their hand at random',
  'that spell gains rebound',
  'the blocking creature gets +1/+1 until end of turn',
  'the copy targets ivy',
  'the copy targets the chosen creature',
  'the copy targets the chosen permanent',
  'the exiled card\'s owner creates an x/x blue illusion creature token, where x is the mana value of the exiled card',
  'the exiled card\'s owner manifests dread',
  'the fading light, exile them',
  'the greatest mana value among creatures sacrificed this way',
  'the greatest power among creatures you control',
  'the monarch controls enchanted creature',
  'the next instant or sorcery spell you cast this turn costs {x} less to cast',
];

for (const t of samples) {
  const ir = parseOracleTextToIR(t, 'Test');
  const gaps: string[] = [];
  for (const a of ir.abilities || []) {
    for (const s of a.steps || []) collectGaps(s).forEach((g) => gaps.push(g));
  }
  console.log(gaps.length ? `FAIL [${gaps[0].slice(0, 80)}]` : 'OK', t.slice(0, 75));
}
