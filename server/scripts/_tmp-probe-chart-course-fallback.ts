import type { PlayerID } from '../../shared/src/index.js';
import { createContext } from '../src/state/context.js';
import { applyOracleIRUncategorizedSpellFallback } from '../src/state/modules/oracleIrUncategorizedSpellFallback.js';

process.env.ORACLE_IR_SPELL_PRIMARY = '0';

const playerId = 'p1' as PlayerID;
const ctx = createContext('test') as any;
ctx.state = {
  players: [{ id: playerId, name: 'P1' }],
  life: { [playerId]: 40 },
  battlefield: [],
  zones: {
    [playerId]: { library: [], hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
  },
  stack: [],
  pendingDiscard: {},
  turnNumber: 1,
};

ctx.libraries.set(
  playerId,
  [
    { id: 'lib-1', name: 'Island' },
    { id: 'lib-2', name: 'Forest' },
  ],
);

const oracleText = 'Draw two cards, then discard a card.';
const applied = applyOracleIRUncategorizedSpellFallback(
  ctx,
  oracleText,
  playerId,
  'Chart a Course',
  undefined,
  undefined,
  'stack-1',
);

console.log('applied', applied);
console.log('hand', ctx.state.zones[playerId].hand.length);
console.log('pendingDiscard', ctx.state.pendingDiscard?.[playerId]);

process.exit(applied > 0 && ctx.state.zones[playerId].hand.length === 2 && ctx.state.pendingDiscard?.[playerId]?.count === 1 ? 0 : 1);
