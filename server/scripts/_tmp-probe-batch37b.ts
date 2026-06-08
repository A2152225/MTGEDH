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
  'then secretly choose human, merfolk, or goblin',
  'you may activate the lesser production ability of any building of prestige 5 or lower you control',
  'this permanent enters under the control of an opponent of your choice',
  'up to one other target creature loses all abilities',
  'when you next cast an instant or sorcery spell this turn, copy it and you may choose new targets for the copy',
  'you may search your hand and/or library for a card with a name noted as you drafted cards named this permanent',
  'you get an amount of {e} equal to the amount of mana spent to cast that spell',
  'you get six {e}',
  'you may move a counter from this artifact onto that creature',
  'you may unattach an equipment from a creature you control',
  'until end of turn, that permanent becomes saddled if it\'s a mount and becomes an artifact creature if it\'s a vehicle',
  'you lose the game.] exile this permanent',
  'your team may pass the ball',
  'this creature and another target creature each get +1/+0 until end of turn',
  'two cards unless you discard an artifact card',
  'then put this creature\'s counters on that token',
  'until your next turn, this creature\'s base power becomes twice that card\'s power and its base toughness becomes twice that card\'s toughness',
  'then up to one other target attacking creature gets +x/+0 until end of turn, where x is this permanent\'s power',
  'this permanent endures 2',
  'hand, and library, seek two creature cards with mana value 3 or less',
  'damage to a permanent or player, it deals double that',
  'a card or pay {2}',
  'this permanent must be blocked each combat this turn if able',
  'that player chooses up to two creatures they control',
  'then if it has no oil counters on it, you lose the game',
  'you gain 2 life for each gate you control',
  'two cards unless you discard a pirate card',
  'then for each nontoken permanent attached to it, create a token that\'s a copy of that permanent attached to that creature',
  'target opponent discards a card for each zubera that died this turn',
  'rekindled, you may discard a card',
  'transform up to one target incubator token you control',
  'until end of turn, that creature gets +2/+0, gains trample if it\'s red, and gains vigilance if it\'s white',
  'then put the rest of the revealed cards on the bottom of your library in a random order',
  'you get that many {e}."',
  'until you exile x permanent cards, where x is the number of times this creature has mutated',
  'then if you\'ve done all four this turn, transform this permanent',
  'you gain 2 life for each creature you control with flying',
  'then each player who discarded a card this way draws a card',
  'then they exile a nonland card from their graveyard',
  'then you get an experience counter for each player who discarded a card this turn',
];

for (const t of samples) {
  const ir = parseOracleTextToIR(t, 'Test');
  const gaps: string[] = [];
  for (const a of ir.abilities || []) {
    for (const s of a.steps || []) collectGaps(s).forEach((g) => gaps.push(g));
  }
  console.log(gaps.length ? `FAIL [${gaps[0].slice(0, 80)}]` : 'OK', t.slice(0, 75));
}
