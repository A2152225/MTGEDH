import type { PlayerID } from '../../shared/src/index.js';
import { createContext } from '../src/state/context.js';
import { applyOracleIRUncategorizedSpellFallback } from '../src/state/modules/oracleIrUncategorizedSpellFallback.js';

process.env.ORACLE_IR_SPELL_PRIMARY = '0';

const playerId = 'p1' as PlayerID;
const ctx = createContext('test') as any;
ctx.state = {
  players: [{ id: playerId, name: 'P1' }],
  life: { [playerId]: 40 },
  battlefield: [
    { id: 'c1', controller: playerId, card: { type_line: 'Creature — Merfolk' }, counters: { '+1/+1': 1 } },
    { id: 'c2', controller: playerId, card: { type_line: 'Creature — Elf' }, counters: { '+1/+1': 2 } },
    { id: 'c3', controller: playerId, card: { type_line: 'Creature — Human' }, counters: {} },
  ],
  zones: { [playerId]: { library: [], hand: [], handCount: 0, graveyard: [] } },
  stack: [],
  turnNumber: 1,
};

ctx.libraries.set(
  playerId,
  Array.from({ length: 10 }, (_, i) => ({ id: `lib_${i}`, name: `Card ${i}` })),
);

const oracleText =
  'Draw a card for each creature you control with a +1/+1 counter on it. Those creatures gain indestructible until end of turn.';

const applied = applyOracleIRUncategorizedSpellFallback(ctx, oracleText, playerId, 'Inspiring Call', undefined, undefined, 'stack-1');

console.log('applied', applied);
console.log('hand', ctx.state.zones[playerId].hand.length);
for (const id of ['c1', 'c2', 'c3']) {
  const perm = ctx.state.battlefield.find((p: any) => p.id === id);
  console.log(id, 'tempAbilities', JSON.stringify(perm?.temporaryAbilities), 'tempEffects', JSON.stringify(perm?.temporaryEffects));
}

process.exit(0);
