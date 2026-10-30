import type { GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { PlayerZoneChangeBridgeContext } from './oracleIRExecutorCardZoneTransitionCommit';
import { buildCardDrawTransition } from './oracleIRExecutorEffectTransitionBuilders';
import { readPlayerZoneCards, writePlayerZoneCards } from './oracleIRExecutorPlayerUtils';

export function commitCardDraws(args: {
  state: GameState;
  playerId: PlayerID;
  count: number;
  stepIndex: number;
  stepKind: string;
  cause: string;
  ctx?: OracleIRExecutionContext;
  drawIndexOffset?: number;
  metadata?: Readonly<Record<string, unknown>>;
}): {
  state: GameState;
  log: string[];
  halted: boolean;
  drawnCount: number;
  ledgerRecordedViaBridge: boolean;
} {
  const requested = Math.max(0, args.count | 0);
  if (requested === 0) {
    return {
      state: args.state,
      log: [],
      halted: false,
      drawnCount: 0,
      ledgerRecordedViaBridge: false,
    };
  }

  const bridge = args.ctx?.serverBridge;
  if (!bridge || !Number.isFinite(args.stepIndex)) {
    return drawCardsDirect(args);
  }

  let nextState = args.state;
  const log: string[] = [];
  let drawnCount = 0;
  const drawIndexOffset = Math.max(0, Number(args.drawIndexOffset ?? 0) | 0);
  let guard = 0;

  while (drawnCount < requested && guard < 500) {
    guard += 1;
    const player = nextState.players.find((entry) => entry.id === args.playerId) as any;
    if (!player) break;

    const library = readPlayerZoneCards(nextState, args.playerId, player, 'library');
    if (library.length === 0) {
      log.push(`${args.playerId} cannot draw (empty library)`);
      break;
    }

    const handBefore = readPlayerZoneCards(nextState, args.playerId, player, 'hand');
    const topId = String(library[0]?.id || '').trim();
    if (topId && handBefore.some((card: any) => String(card?.id || '').trim() === topId)) {
      library.shift();
      writePlayerZoneCards(nextState, args.playerId, player, 'library', library);
      continue;
    }

    const topCard = library[0];
    const drawIndex = drawnCount;
    const transition = buildCardDrawTransition({
      playerId: args.playerId,
      stepIndex: args.stepIndex,
      stepKind: args.stepKind,
      cause: args.cause,
      drawIndex: drawIndexOffset + drawIndex,
      topLibraryCard: topCard,
      ctx: args.ctx,
      metadata: {
        ...(args.metadata ?? {}),
        remainingDrawCountAfterChoice: Math.max(0, requested - drawIndex - 1),
      },
    });

    const bridgeResult = bridge.proposeTransitions([transition]);
    if (bridgeResult.halt) {
      if (args.ctx?.transitionHaltState) {
        args.ctx.transitionHaltState.halted = true;
        args.ctx.transitionHaltState.deferred = [...(bridgeResult.deferred || [])];
      }
      return {
        state: nextState,
        log,
        halted: true,
        drawnCount,
        ledgerRecordedViaBridge: drawnCount > 0,
      };
    }

    const ready = bridgeResult.ready?.[0] ?? transition;
    const effectiveCount = Math.max(0, Number(ready.event.count ?? ready.event.amount ?? 1) | 0);
    if (effectiveCount <= 0) {
      break;
    }

    const currentLibrary = readPlayerZoneCards(nextState, args.playerId, player, 'library');
    if (currentLibrary.length === 0) break;

    const handZone = readPlayerZoneCards(nextState, args.playerId, player, 'hand');
    const [drawnCard] = currentLibrary.splice(0, 1);
    handZone.push({ ...drawnCard, zone: 'hand' });
    writePlayerZoneCards(nextState, args.playerId, player, 'library', currentLibrary);
    writePlayerZoneCards(nextState, args.playerId, player, 'hand', handZone);
    drawnCount += 1;
  }

  if (drawnCount > 0) {
    log.push(`${args.playerId} draws ${drawnCount} card(s)`);
  }

  return {
    state: nextState,
    log,
    halted: false,
    drawnCount,
    ledgerRecordedViaBridge: true,
  };
}

function drawCardsDirect(args: {
  state: GameState;
  playerId: PlayerID;
  count: number;
}): {
  state: GameState;
  log: string[];
  halted: boolean;
  drawnCount: number;
  ledgerRecordedViaBridge: boolean;
} {
  const players = args.state.players.map((player) => ({ ...player } as any));
  const player = players.find((entry) => entry.id === args.playerId);
  if (!player) {
    return {
      state: args.state,
      log: [`Player not found: ${args.playerId}`],
      halted: false,
      drawnCount: 0,
      ledgerRecordedViaBridge: false,
    };
  }

  const library = readPlayerZoneCards(args.state, args.playerId, player, 'library');
  const hand = readPlayerZoneCards(args.state, args.playerId, player, 'hand');
  const log: string[] = [];
  let drawn = 0;

  const requestedDirect = Math.max(0, args.count | 0);
  let guard = library.length;
  while (drawn < requestedDirect && guard >= 0) {
    guard -= 1;
    if (library.length === 0) {
      log.push(`${args.playerId} cannot draw (empty library)`);
      break;
    }
    const topId = String(library[0]?.id || '').trim();
    if (topId && hand.some((card: any) => String(card?.id || '').trim() === topId)) {
      library.shift();
      continue;
    }
    const [card] = library.splice(0, 1);
    hand.push(card);
    drawn += 1;
  }

  writePlayerZoneCards(args.state, args.playerId, player, 'library', library);
  writePlayerZoneCards(args.state, args.playerId, player, 'hand', hand);

  return {
    state: { ...args.state, players: players as any } as GameState,
    log: drawn > 0 ? [`${args.playerId} draws ${drawn} card(s)`] : log,
    halted: false,
    drawnCount: drawn,
    ledgerRecordedViaBridge: false,
  };
}
