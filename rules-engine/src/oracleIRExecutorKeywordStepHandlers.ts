import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import { createCustomEmblem } from './emblemSupport';
import { getRingAbilities } from './keywordActions/ringTemptsYou';
import { executePopulate, getPopulateTargets } from './keywordActions/populate';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { isExecutorCreature } from './oracleIRExecutorPermanentUtils';
import { quantityToNumber, resolvePlayers } from './oracleIRExecutorPlayerUtils';
import { createTokensByName } from './tokenCreation';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason: 'player_choice_required' | 'failed_to_apply';
  readonly options?: {
    readonly classification?: 'player_choice';
    readonly metadata?: Record<string, string | number | boolean | readonly string[]>;
  };
};

export type KeywordStepHandlerResult = StepApplyResult | StepSkipResult;

function createChoiceRequiredResult(message: string, metadata?: Record<string, string | number | boolean | readonly string[]>): StepSkipResult {
  return {
    applied: false,
    message,
    reason: 'player_choice_required',
    options: {
      classification: 'player_choice',
      ...(metadata ? { metadata } : {}),
    },
  };
}

function getTimeCounterCount(record: unknown): number {
  const count = Number((record as Record<string, unknown> | null | undefined)?.time ?? 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function decrementTimeCounterRecord(record: unknown): Record<string, number> {
  const nextCounters = { ...(((record || {}) as Record<string, number>)) };
  const current = getTimeCounterCount(nextCounters);
  if (current <= 1) {
    delete nextCounters.time;
  } else {
    nextCounters.time = current - 1;
  }
  return nextCounters;
}

export function applyInvestigateStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'investigate' }>,
  ctx: OracleIRExecutionContext
): KeywordStepHandlerResult {
  const amount = quantityToNumber(step.amount, ctx);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped investigate (unsupported amount): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped investigate (unsupported player selector): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const created = createTokensByName('Clue', Math.max(0, amount), playerId, nextState.battlefield || [], ctx.sourceId, ctx.sourceName);
    if (!created) {
      return {
        applied: false,
        message: `Skipped investigate (Clue token definition unavailable): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }
    nextState = {
      ...nextState,
      battlefield: [...(nextState.battlefield || []), ...created.tokens.map(token => token.token)],
    };
    log.push(...created.log);
  }

  return {
    applied: true,
    state: nextState,
    log,
  };
}

export function applyPopulateStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'populate' }>,
  ctx: OracleIRExecutionContext
): KeywordStepHandlerResult {
  const amount = quantityToNumber(step.amount, ctx);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped populate (unsupported amount): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped populate (unsupported player selector): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    for (let i = 0; i < amount; i += 1) {
      const eligibleTokens = getPopulateTargets(nextState.battlefield || [], playerId);
      if (eligibleTokens.length === 0) {
        log.push(`Populate had no creature tokens for ${playerId}: ${step.raw}`);
        break;
      }

      if (eligibleTokens.length > 1) {
        return createChoiceRequiredResult(`Skipped populate (requires choosing a creature token): ${step.raw}`, {
          playerId,
          eligibleTokenIds: eligibleTokens
            .map((permanent) => String((permanent as any)?.id || '').trim())
            .filter(Boolean),
        });
      }

      const originalToken = eligibleTokens[0];
      const result = executePopulate(nextState.battlefield || [], playerId, String(originalToken.id || '').trim());
      if (!result.newToken) {
        return {
          applied: false,
          message: `Skipped populate (failed to create token copy): ${step.raw}`,
          reason: 'failed_to_apply',
        };
      }

      const newToken: BattlefieldPermanent = {
        ...(result.newToken as any),
        ownerId: playerId,
        createdBySourceId: String(ctx.sourceId || '').trim() || undefined,
        createdBySourceName: String(ctx.sourceName || '').trim() || undefined,
      } as BattlefieldPermanent;

      nextState = {
        ...nextState,
        battlefield: [...(nextState.battlefield || []), newToken],
      };
      log.push(`Populated ${String((originalToken as any)?.id || '').trim() || 'a creature token'} for ${playerId}`);
    }
  }

  return {
    applied: true,
    state: nextState,
    log,
  };
}

export function applyTimeTravelStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'time_travel' }>,
  ctx: OracleIRExecutionContext
): KeywordStepHandlerResult {
  const repetitions = quantityToNumber(step.amount, ctx);
  if (repetitions === null) {
    return {
      applied: false,
      message: `Skipped time travel (unsupported amount): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped time travel (unsupported player selector): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  if (players.length !== 1) {
    return createChoiceRequiredResult(`Skipped time travel (requires deterministic player): ${step.raw}`, {
      eligiblePlayerIds: players.map(playerId => String(playerId || '').trim()).filter(Boolean),
    });
  }

  if (repetitions <= 0) {
    return {
      applied: true,
      state,
      log: [`Time travel ${repetitions} time(s) (no-op): ${step.raw}`],
    };
  }

  const controllerId = String(players[0] || '').trim() as PlayerID;
  let nextState = state;
  let battlefieldChanged = 0;
  let exileChanged = 0;

  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    const nextBattlefield = (nextState.battlefield || []).map((permanent) => {
      if (String(permanent?.controller || '').trim() !== controllerId) return permanent;
      if (getTimeCounterCount((permanent as any)?.counters) <= 0) return permanent;
      battlefieldChanged += 1;
      return {
        ...(permanent as any),
        counters: decrementTimeCounterRecord((permanent as any)?.counters),
      } as BattlefieldPermanent;
    });

    const nextPlayers = (nextState.players || []).map((player: any) => {
      const playerId = String(player?.id || '').trim();
      const exile = Array.isArray(player?.exile) ? player.exile : [];
      let playerChanged = 0;
      const nextExile = exile.map((card: any) => {
        const cardOwnerId = String(card?.owner || card?.ownerId || playerId).trim();
        if (cardOwnerId !== controllerId) return card;
        if (getTimeCounterCount(card?.counters) <= 0) return card;
        playerChanged += 1;
        return {
          ...card,
          counters: decrementTimeCounterRecord(card?.counters),
        };
      });
      exileChanged += playerChanged;
      return playerChanged > 0 ? { ...player, exile: nextExile } : player;
    });

    nextState = {
      ...(nextState as any),
      battlefield: nextBattlefield as any,
      players: nextPlayers as any,
    } as GameState;
  }

  if (battlefieldChanged === 0 && exileChanged === 0) {
    return {
      applied: true,
      state,
      log: [`Time travel had no eligible time counters to change: ${step.raw}`],
    };
  }

  return {
    applied: true,
    state: nextState,
    log: [
      `${controllerId} time traveled ${repetitions} time(s), removing time counters from ${battlefieldChanged} permanent(s) and ${exileChanged} exiled card(s)`,
    ],
  };
}

function getPositiveCounterEntries(record: unknown): Array<[string, number]> {
  if (!record || typeof record !== 'object') return [];

  const entries: Array<[string, number]> = [];
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    const count = Number(value);
    if (!key || !Number.isFinite(count) || count <= 0) continue;
    entries.push([key, count]);
  }
  return entries;
}

function getPermanentCounterKinds(permanent: BattlefieldPermanent): readonly string[] {
  const kinds = new Set<string>();
  for (const [counter] of getPositiveCounterEntries((permanent as any)?.counters)) {
    kinds.add(counter);
  }

  const loyalty = Number((permanent as any)?.loyalty);
  if (Number.isFinite(loyalty) && loyalty > 0) {
    kinds.add('loyalty');
  }

  return [...kinds];
}

function proliferatePermanent(permanent: BattlefieldPermanent): BattlefieldPermanent {
  const nextCounters = { ...((((permanent as any)?.counters || {}) as Record<string, number>)) };
  for (const [counter] of getPositiveCounterEntries((permanent as any)?.counters)) {
    nextCounters[counter] = Number(nextCounters[counter] || 0) + 1;
  }

  const loyalty = Number((permanent as any)?.loyalty);
  const nextPermanent: any = { ...(permanent as any) };
  if (Object.keys(nextCounters).length > 0) {
    nextPermanent.counters = nextCounters;
  }
  if (Number.isFinite(loyalty) && loyalty > 0) {
    nextPermanent.loyalty = loyalty + 1;
  }
  return nextPermanent as BattlefieldPermanent;
}

type PlayerCounterSnapshot = {
  readonly counters: Readonly<Record<string, number>>;
};

function getPlayerCounterSnapshot(state: GameState, player: any): PlayerCounterSnapshot {
  const playerId = String(player?.id || '').trim();
  const counters: Record<string, number> = {};

  const assignIfPositive = (name: string, value: unknown): void => {
    const count = Number(value);
    if (!Number.isFinite(count) || count <= 0) return;
    counters[name] = count;
  };

  assignIfPositive('poison', player?.poisonCounters ?? (state as any)?.poisonCounters?.[playerId] ?? player?.counters?.poison);
  assignIfPositive('energy', player?.energyCounters ?? player?.energy ?? player?.counters?.energy);
  assignIfPositive(
    'experience',
    player?.experienceCounters ?? player?.experience ?? (state as any)?.experienceCounters?.[playerId] ?? player?.counters?.experience
  );
  assignIfPositive('rad', player?.radCounters ?? player?.counters?.rad);
  assignIfPositive('ticket', player?.ticketCounters ?? player?.counters?.ticket);

  for (const [counter, value] of getPositiveCounterEntries(player?.counters)) {
    if (counter === 'poison' || counter === 'energy' || counter === 'experience' || counter === 'rad' || counter === 'ticket') {
      continue;
    }
    counters[counter] = value;
  }

  return { counters };
}

function proliferatePlayerState(state: GameState, playerId: PlayerID): GameState {
  const player = (state.players || []).find((entry) => entry?.id === playerId) as any;
  if (!player) return state;

  const snapshot = getPlayerCounterSnapshot(state, player);
  const nextCounters = { ...((player?.counters || {}) as Record<string, number>) };
  let nextPlayer: any = { ...player };
  let nextState: any = { ...(state as any) };

  for (const counter of Object.keys(snapshot.counters)) {
    const nextValue = Number(snapshot.counters[counter] || 0) + 1;
    if (counter === 'poison') {
      nextPlayer.poisonCounters = nextValue;
      nextCounters.poison = nextValue;
      nextState.poisonCounters = { ...((nextState.poisonCounters || {}) as Record<string, number>), [playerId]: nextValue };
      continue;
    }

    if (counter === 'energy') {
      nextPlayer.energyCounters = nextValue;
      nextPlayer.energy = nextValue;
      nextCounters.energy = nextValue;
      continue;
    }

    if (counter === 'experience') {
      nextPlayer.experienceCounters = nextValue;
      nextPlayer.experience = nextValue;
      nextCounters.experience = nextValue;
      nextState.experienceCounters = {
        ...((nextState.experienceCounters || {}) as Record<string, number>),
        [playerId]: nextValue,
      };
      continue;
    }

    nextCounters[counter] = nextValue;
  }

  nextPlayer.counters = nextCounters;
  nextState.players = state.players.map((entry) => (entry.id === playerId ? nextPlayer : entry));
  return nextState as GameState;
}

export function applyProliferateStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'proliferate' }>,
  ctx: OracleIRExecutionContext
): KeywordStepHandlerResult {
  const eligiblePermanents = (state.battlefield || []).filter((permanent) => getPermanentCounterKinds(permanent).length > 0);
  const eligiblePlayers = (state.players || []).filter((player) => {
    const snapshot = getPlayerCounterSnapshot(state, player);
    return Object.keys(snapshot.counters).length > 0;
  });

  const eligibleTargetCount = eligiblePermanents.length + eligiblePlayers.length;
  if (eligibleTargetCount === 0) {
    return {
      applied: true,
      state,
      log: [`Proliferate had no eligible permanents or players: ${step.raw}`],
    };
  }

  if (eligibleTargetCount > 1) {
    return {
      applied: false,
      message: `Skipped proliferate (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          eligiblePermanentIds: eligiblePermanents.map((permanent) => String((permanent as any)?.id || '').trim()).filter(Boolean),
          eligiblePlayerIds: eligiblePlayers.map((player) => String(player?.id || '').trim()).filter(Boolean),
        },
      },
    };
  }

  if (eligiblePermanents.length === 1) {
    const targetId = String((eligiblePermanents[0] as any)?.id || '').trim();
    return {
      applied: true,
      state: {
        ...state,
        battlefield: (state.battlefield || []).map((permanent) =>
          String((permanent as any)?.id || '').trim() === targetId ? proliferatePermanent(permanent) : permanent
        ),
      },
      log: [`Proliferated ${targetId || 'a permanent'} (${ctx.sourceName || 'Oracle IR'})`],
    };
  }

  const playerId = String(eligiblePlayers[0]?.id || '').trim() as PlayerID;
  return {
    applied: true,
    state: proliferatePlayerState(state, playerId),
    log: [`Proliferated player ${playerId} (${ctx.sourceName || 'Oracle IR'})`],
  };
}

function updateRingBearerMarkers(
  battlefield: readonly BattlefieldPermanent[],
  controllerId: PlayerID,
  ringBearerId: string | null
): readonly BattlefieldPermanent[] {
  return battlefield.map((permanent) => {
    if (String(permanent?.controller || '').trim() !== controllerId && !(permanent as any)?.isRingBearer) {
      return permanent;
    }

    const permanentId = String((permanent as any)?.id || '').trim();
    const shouldBeRingBearer = Boolean(ringBearerId) && permanentId === ringBearerId;
    if (Boolean((permanent as any)?.isRingBearer) === shouldBeRingBearer) {
      return permanent;
    }

    return {
      ...(permanent as any),
      isRingBearer: shouldBeRingBearer,
    } as BattlefieldPermanent;
  });
}

export function applyRingTemptsYouStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'ring_tempts_you' }>,
  ctx: OracleIRExecutionContext
): KeywordStepHandlerResult {
  const controllerId = String(ctx.controllerId || '').trim() as PlayerID;
  const player = (state.players || []).find((entry) => String(entry?.id || '').trim() === controllerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped Ring tempts you (controller unavailable): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const controlledCreatures = (state.battlefield || []).filter((permanent) => {
    if (String(permanent?.controller || '').trim() !== controllerId) return false;
    if ((permanent as any)?.phasedOut) return false;
    return isExecutorCreature(permanent);
  });

  if (controlledCreatures.length > 1) {
    return {
      applied: false,
      message: `Skipped Ring tempts you (requires choosing a Ring-bearer): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          eligibleRingBearerIds: controlledCreatures
            .map((permanent) => String((permanent as any)?.id || '').trim())
            .filter(Boolean),
        },
      },
    };
  }

  const ringBearer = controlledCreatures[0] as any;
  const ringBearerId = ringBearer ? String(ringBearer.id || '').trim() : null;
  const ringBearerName = ringBearer ? String(ringBearer?.card?.name || ringBearer?.name || '').trim() || null : null;
  const nextTemptCount = Math.max(0, Number(player?.ringTemptations || 0) || 0) + 1;
  const ringAbilities = getRingAbilities(nextTemptCount);
  const currentEmblems = Array.isArray(player?.emblems) ? [...player.emblems] : [];
  const existingRingIndex = currentEmblems.findIndex((emblem: any) => {
    const name = String(emblem?.name || '').trim().toLowerCase();
    const createdBy = String(emblem?.createdBy || '').trim().toLowerCase();
    return name === 'the ring' || createdBy === 'the ring';
  });

  const log: string[] = [];
  let nextEmblems = currentEmblems;
  if (existingRingIndex >= 0) {
    const existingRing = currentEmblems[existingRingIndex] as any;
    nextEmblems = [...currentEmblems];
    nextEmblems[existingRingIndex] = {
      ...existingRing,
      name: 'The Ring',
      abilities: [...ringAbilities],
      createdBy: 'The Ring',
      sourceId: String(ctx.sourceId || existingRing?.sourceId || '').trim() || undefined,
    };
    log.push(`${controllerId} is tempted by the Ring (${nextTemptCount})`);
  } else {
    const emblem = createCustomEmblem(
      controllerId,
      'The Ring',
      [...ringAbilities],
      'The Ring',
      String(ctx.sourceId || '').trim() || undefined
    );
    nextEmblems = [...currentEmblems, emblem.emblem];
    log.push(...emblem.log);
    log.push(`${controllerId} is tempted by the Ring (${nextTemptCount})`);
  }

  if (ringBearerName) {
    log.push(`${ringBearerName} becomes ${controllerId}'s Ring-bearer`);
  }

  const nextPlayers = state.players.map((entry) => {
    if (String(entry?.id || '').trim() !== controllerId) return entry;
    return {
      ...(entry as any),
      emblems: nextEmblems,
      ringTemptations: nextTemptCount,
      ringBearerId,
      ringBearerName,
    } as any;
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      players: nextPlayers as any,
      battlefield: updateRingBearerMarkers(state.battlefield || [], controllerId, ringBearerId) as any,
    } as GameState,
    log,
  };
}
