import type { GameContext } from '../context.js';
import { isCreatureNow } from '../creatureTypeNow.js';
import { destroyPermanent, runSBA } from './counters_tokens.js';

function getDivineReckoningChoiceBatches(state: any): Record<string, any> {
  if (
    state?.divineReckoningChoiceBatches &&
    typeof state.divineReckoningChoiceBatches === 'object' &&
    !Array.isArray(state.divineReckoningChoiceBatches)
  ) {
    return state.divineReckoningChoiceBatches as Record<string, any>;
  }

  return {};
}

function getPrisonersDilemmaChoiceBatches(state: any): Record<string, any> {
  if (
    state?.prisonersDilemmaChoiceBatches &&
    typeof state.prisonersDilemmaChoiceBatches === 'object' &&
    !Array.isArray(state.prisonersDilemmaChoiceBatches)
  ) {
    return state.prisonersDilemmaChoiceBatches as Record<string, any>;
  }

  return {};
}

export function createDivineReckoningChoiceBatch(
  state: any,
  batch: {
    id: string;
    controller?: string;
    sourceId?: string;
    sourceName?: string;
    expectedPlayerIds?: string[];
    choices?: Record<string, string>;
  },
): any {
  if (!state) return null;

  const batchId = String(batch?.id || '').trim();
  if (!batchId) return null;

  const stateAny = state as any;
  stateAny.divineReckoningChoiceBatches = getDivineReckoningChoiceBatches(stateAny);

  const existing = stateAny.divineReckoningChoiceBatches[batchId] || {};
  const expectedPlayerIds = Array.isArray(batch?.expectedPlayerIds)
    ? batch.expectedPlayerIds.map((value) => String(value || '').trim()).filter(Boolean)
    : Array.isArray(existing?.expectedPlayerIds)
      ? existing.expectedPlayerIds.map((value: any) => String(value || '').trim()).filter(Boolean)
      : [];

  const nextBatch = {
    ...existing,
    ...batch,
    id: batchId,
    controller: String(batch?.controller || existing?.controller || '').trim() || undefined,
    sourceId: String(batch?.sourceId || existing?.sourceId || '').trim() || undefined,
    sourceName: String(batch?.sourceName || existing?.sourceName || '').trim() || undefined,
    expectedPlayerIds,
    choices: {
      ...(existing?.choices && typeof existing.choices === 'object' && !Array.isArray(existing.choices)
        ? existing.choices
        : {}),
      ...(batch?.choices && typeof batch.choices === 'object' && !Array.isArray(batch.choices)
        ? batch.choices
        : {}),
    },
  };

  stateAny.divineReckoningChoiceBatches[batchId] = nextBatch;
  return nextBatch;
}

export function recordDivineReckoningChoice(
  state: any,
  batchId: string,
  choice: {
    playerId: string;
    permanentId: string;
    controller?: string;
    sourceId?: string;
    sourceName?: string;
    expectedPlayerIds?: string[];
  },
): any {
  const normalizedBatchId = String(batchId || '').trim();
  const playerId = String(choice?.playerId || '').trim();
  const permanentId = String(choice?.permanentId || '').trim();
  if (!normalizedBatchId || !playerId || !permanentId) return null;

  const batch = createDivineReckoningChoiceBatch(state, {
    id: normalizedBatchId,
    controller: choice?.controller,
    sourceId: choice?.sourceId,
    sourceName: choice?.sourceName,
    expectedPlayerIds: choice?.expectedPlayerIds,
  });
  if (!batch) return null;

  batch.choices = {
    ...(batch?.choices && typeof batch.choices === 'object' && !Array.isArray(batch.choices)
      ? batch.choices
      : {}),
    [playerId]: permanentId,
  };

  return batch;
}

export function clearDivineReckoningChoiceBatch(state: any, batchId: string): void {
  if (
    !state?.divineReckoningChoiceBatches ||
    typeof state.divineReckoningChoiceBatches !== 'object' ||
    Array.isArray(state.divineReckoningChoiceBatches)
  ) {
    return;
  }

  const normalizedBatchId = String(batchId || '').trim();
  if (!normalizedBatchId) return;

  delete state.divineReckoningChoiceBatches[normalizedBatchId];
  if (Object.keys(state.divineReckoningChoiceBatches).length === 0) {
    delete state.divineReckoningChoiceBatches;
  }
}

export function applyDivineReckoningBatchResult(
  ctx: GameContext,
  survivorIds: string[],
): { survivorIds: string[]; destroyedIds: string[] } {
  const battlefield = Array.isArray(ctx.state?.battlefield) ? (ctx.state.battlefield as any[]) : [];
  const normalizedSurvivorIds = Array.from(
    new Set(survivorIds.map((value) => String(value || '').trim()).filter(Boolean)),
  );
  const survivorIdSet = new Set(normalizedSurvivorIds);
  const destroyedIds: string[] = [];

  for (const permanent of [...battlefield]) {
    const permanentId = String((permanent as any)?.id || '').trim();
    if (!permanentId || survivorIdSet.has(permanentId) || !isCreatureNow(permanent)) {
      continue;
    }

    destroyPermanent(ctx, permanentId, true);
    destroyedIds.push(permanentId);
  }

  if (destroyedIds.length > 0) {
    runSBA(ctx);
  }

  return {
    survivorIds: normalizedSurvivorIds,
    destroyedIds,
  };
}

export function createPrisonersDilemmaChoiceBatch(
  state: any,
  batch: {
    id: string;
    controller?: string;
    sourceId?: string;
    sourceName?: string;
    expectedPlayerIds?: string[];
    choices?: Record<string, string>;
  },
): any {
  if (!state) return null;

  const batchId = String(batch?.id || '').trim();
  if (!batchId) return null;

  const stateAny = state as any;
  stateAny.prisonersDilemmaChoiceBatches = getPrisonersDilemmaChoiceBatches(stateAny);

  const existing = stateAny.prisonersDilemmaChoiceBatches[batchId] || {};
  const expectedPlayerIds = Array.isArray(batch?.expectedPlayerIds)
    ? batch.expectedPlayerIds.map((value) => String(value || '').trim()).filter(Boolean)
    : Array.isArray(existing?.expectedPlayerIds)
      ? existing.expectedPlayerIds.map((value: any) => String(value || '').trim()).filter(Boolean)
      : [];

  const nextBatch = {
    ...existing,
    ...batch,
    id: batchId,
    controller: String(batch?.controller || existing?.controller || '').trim() || undefined,
    sourceId: String(batch?.sourceId || existing?.sourceId || '').trim() || undefined,
    sourceName: String(batch?.sourceName || existing?.sourceName || '').trim() || undefined,
    expectedPlayerIds,
    choices: {
      ...(existing?.choices && typeof existing.choices === 'object' && !Array.isArray(existing.choices)
        ? existing.choices
        : {}),
      ...(batch?.choices && typeof batch.choices === 'object' && !Array.isArray(batch.choices)
        ? batch.choices
        : {}),
    },
  };

  stateAny.prisonersDilemmaChoiceBatches[batchId] = nextBatch;
  return nextBatch;
}

export function recordPrisonersDilemmaChoice(
  state: any,
  batchId: string,
  choice: {
    playerId: string;
    choice: string;
    controller?: string;
    sourceId?: string;
    sourceName?: string;
    expectedPlayerIds?: string[];
  },
): any {
  const normalizedBatchId = String(batchId || '').trim();
  const playerId = String(choice?.playerId || '').trim();
  const selectedChoice = String(choice?.choice || '').trim().toLowerCase();
  if (!normalizedBatchId || !playerId || !['silence', 'snitch'].includes(selectedChoice)) return null;

  const batch = createPrisonersDilemmaChoiceBatch(state, {
    id: normalizedBatchId,
    controller: choice?.controller,
    sourceId: choice?.sourceId,
    sourceName: choice?.sourceName,
    expectedPlayerIds: choice?.expectedPlayerIds,
  });
  if (!batch) return null;

  batch.choices = {
    ...(batch?.choices && typeof batch.choices === 'object' && !Array.isArray(batch.choices)
      ? batch.choices
      : {}),
    [playerId]: selectedChoice,
  };

  return batch;
}

export function clearPrisonersDilemmaChoiceBatch(state: any, batchId: string): void {
  if (
    !state?.prisonersDilemmaChoiceBatches ||
    typeof state.prisonersDilemmaChoiceBatches !== 'object' ||
    Array.isArray(state.prisonersDilemmaChoiceBatches)
  ) {
    return;
  }

  const normalizedBatchId = String(batchId || '').trim();
  if (!normalizedBatchId) return;

  delete state.prisonersDilemmaChoiceBatches[normalizedBatchId];
  if (Object.keys(state.prisonersDilemmaChoiceBatches).length === 0) {
    delete state.prisonersDilemmaChoiceBatches;
  }
}

export function computePrisonersDilemmaDamage(
  expectedPlayerIds: string[],
  choices: Record<string, string>,
): Record<string, number> {
  const playerIds = Array.from(
    new Set(
      (Array.isArray(expectedPlayerIds) ? expectedPlayerIds : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );
  const normalizedChoices: Record<string, string> = {};
  for (const playerId of playerIds) {
    const choice = String(choices?.[playerId] || '').trim().toLowerCase();
    if (choice === 'silence' || choice === 'snitch') {
      normalizedChoices[playerId] = choice;
    }
  }

  const submittedPlayerIds = playerIds.filter((playerId) => normalizedChoices[playerId]);
  if (submittedPlayerIds.length === 0) return {};

  const allSilence = submittedPlayerIds.every((playerId) => normalizedChoices[playerId] === 'silence');
  const allSnitch = submittedPlayerIds.every((playerId) => normalizedChoices[playerId] === 'snitch');
  const damageByPlayerId: Record<string, number> = {};

  if (allSilence) {
    for (const playerId of submittedPlayerIds) damageByPlayerId[playerId] = 4;
  } else if (allSnitch) {
    for (const playerId of submittedPlayerIds) damageByPlayerId[playerId] = 8;
  } else {
    for (const playerId of submittedPlayerIds) {
      if (normalizedChoices[playerId] === 'silence') {
        damageByPlayerId[playerId] = 12;
      }
    }
  }

  return damageByPlayerId;
}

export function applyPrisonersDilemmaBatchResult(
  ctx: GameContext,
  options: {
    expectedPlayerIds?: string[];
    choices?: Record<string, string>;
    damageByPlayerId?: Record<string, number>;
  },
): { damageByPlayerId: Record<string, number> } {
  const state = (ctx as any).state || {};
  const players = Array.isArray(state.players) ? state.players : [];
  const damageByPlayerId =
    options?.damageByPlayerId &&
    typeof options.damageByPlayerId === 'object' &&
    !Array.isArray(options.damageByPlayerId)
      ? (Object.fromEntries(
          Object.entries(options.damageByPlayerId)
            .map(([playerId, amount]) => [String(playerId || '').trim(), Math.max(0, Number(amount || 0))])
            .filter(([playerId, amount]) => Boolean(playerId) && Number(amount) > 0),
        ) as Record<string, number>)
      : computePrisonersDilemmaDamage(options?.expectedPlayerIds || [], options?.choices || {});

  state.life = state.life || {};
  for (const [playerId, damageAmountRaw] of Object.entries(damageByPlayerId)) {
    const damageAmount = Math.max(0, Number(damageAmountRaw || 0));
    if (!playerId || damageAmount <= 0) continue;

    const player = players.find((entry: any) => String(entry?.id || '') === playerId);
    const currentLife = Number(state.life[playerId] ?? player?.life ?? state.startingLife ?? 40);
    const nextLife = currentLife - damageAmount;
    state.life[playerId] = nextLife;
    if (player) (player as any).life = nextLife;
    if ((ctx as any).life && typeof (ctx as any).life === 'object') {
      (ctx as any).life[playerId] = nextLife;
    }

    state.damageTakenThisTurnByPlayer = state.damageTakenThisTurnByPlayer || {};
    state.damageTakenThisTurnByPlayer[playerId] =
      Number(state.damageTakenThisTurnByPlayer[playerId] || 0) + damageAmount;
    state.lifeLostThisTurn = state.lifeLostThisTurn || {};
    state.lifeLostThisTurn[playerId] = Number(state.lifeLostThisTurn[playerId] || 0) + damageAmount;
  }

  return { damageByPlayerId };
}
