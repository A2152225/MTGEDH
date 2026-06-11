import { createInitialGameState } from '../src/state/gameState.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { tryResolveSpellViaOracleIR } from '../src/state/modules/oracleIrSpellExecution.js';

const gameId = 'probe_each150';
const g = createInitialGameState(gameId);
const p1 = 'p1';
const p2 = 'p2';

g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });

(g.state as any).battlefield = [
  {
    id: 'c1',
    controller: p1,
    owner: p1,
    counters: {},
    card: { id: 'c1_card', name: 'A', type_line: 'Creature — Elf' },
  },
  {
    id: 'c2',
    controller: p1,
    owner: p1,
    counters: {},
    card: { id: 'c2_card', name: 'B', type_line: 'Creature — Elf' },
  },
];

const text = 'Put a +1/+1 counter on each creature you control.';
const steps = collectOracleEffectSteps(text, 'Test');
console.log('steps', JSON.stringify(steps, null, 2));

(g as any).gameId = gameId;
const result = tryResolveSpellViaOracleIR(g as any, {
  controller: p1,
  spellName: 'Test Collective Growth',
  oracleText: text,
  sourceId: 'spell-1',
  targets: [],
});
console.log('handled', result.handled, 'applied', result.applied);
console.log('c1', (g.state as any).battlefield.find((p: any) => p.id === 'c1')?.counters);
console.log('c2', (g.state as any).battlefield.find((p: any) => p.id === 'c2')?.counters);

process.exit(0);
