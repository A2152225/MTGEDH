import { parseOracleTextToIR } from '../../rules-engine/src/oracleIR.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src/index.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const gameId = 'probe136';
const game = createInitialGameState(gameId);
const p1 = 'p1' as PlayerID;
const p2 = 'p2' as PlayerID;
game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

for (const [pid, prefix] of [[p1, 'p1'], [p2, 'p2']] as const) {
  const hand = [
    { id: `${prefix}-1`, name: 'H1', zone: 'hand' },
    { id: `${prefix}-2`, name: 'H2', zone: 'hand' },
    { id: `${prefix}-3`, name: 'H3', zone: 'hand' },
  ];
  (game.state as any).zones = (game.state as any).zones || {};
  (game.state as any).zones[pid] = { hand, handCount: 3, graveyard: [], graveyardCount: 0, library: [], libraryCount: 0 };
  const pl = (game.state as any).players.find((e: any) => e.id === pid);
  pl.hand = hand.map((c) => ({ ...c }));
}

const discardText = 'Each player discards two cards.';
const ir = parseOracleTextToIR(discardText, 'Test');
console.log('discard steps', JSON.stringify(ir.steps, null, 2));

const ctx = game as any;
ctx.gameId = gameId;
ResolutionQueueManager.removeQueue(gameId);

const irCtx = buildOracleIRExecutionContext({ controllerId: p1, sourceName: 'Test' });
const result = applyOracleIRStepsOnServer(ctx, game.state as any, ir.steps, {
  controllerId: p1,
  sourceName: 'Test',
  sourceId: 'spell-1',
  irCtx,
});

console.log('gaps', result?.gaps?.map((g: any) => ({ kind: g.kind, reason: g.reason })));
for (const pid of [p1, p2]) {
  const steps = ResolutionQueueManager.getStepsForPlayer(gameId, pid)
    .filter((s) => s.type === ResolutionStepType.DISCARD_SELECTION);
  console.log('discard queue', pid, steps.length, steps.map((s: any) => s.discardCount));
}

const millText = 'Each player mills two cards.';
const ir2 = parseOracleTextToIR(millText, 'Test Mill');
console.log('mill steps', JSON.stringify(ir2.steps, null, 2));

for (const [pid, prefix] of [[p1, 'p1'], [p2, 'p2']] as const) {
  const lib = [`${prefix}-m1`, `${prefix}-m2`, `${prefix}-m3`, `${prefix}-m4`].map((id) => ({ id, name: id, zone: 'library' }));
  (game.state as any).zones[pid].library = lib;
  (game.state as any).zones[pid].libraryCount = 4;
  const pl = (game.state as any).players.find((e: any) => e.id === pid);
  pl.library = lib.map((c) => ({ ...c }));
}

const result2 = applyOracleIRStepsOnServer(ctx, game.state as any, ir2.steps, {
  controllerId: p1,
  sourceName: 'Test Mill',
  sourceId: 'spell-2',
  irCtx,
});

for (const pid of [p1, p2]) {
  const gy = (game.state as any).zones[pid].graveyard || [];
  console.log('mill gy', pid, gy.length, gy.map((c: any) => c.id));
}

process.exit(0);
