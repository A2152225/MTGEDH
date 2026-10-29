/**
 * Origin: Planetary Annihilation / Razia's Purification choice batch.
 * Each chooser keeps up to N permanents of the printed types; the rest of those
 * types are sacrificed. Public: createChooseThenSacrificeRestBatch,
 * recordChooseThenSacrificeRestChoice, sacrificeUnkeptChooseThenSacrificeRest,
 * applyChooseThenSacrificeRestChoiceReplay, applyChooseThenSacrificeRestBatchReplay.
 */

import type { GameContext } from '../context.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import { applyOracleIRStepsToGameState } from '../../../../rules-engine/src/oracleIRExecutor.js';
import { permanentMatchesChooseThenSacrificeKeepTypes } from '../../../../rules-engine/src/oracleIRExecutorEachPlayerChooseSacrificeRest.js';
import { runSBA } from './counters_tokens.js';
import { sacrificePermanent } from './upkeep-triggers.js';

export type ChooseThenSacrificeRestBatch = {
  id: string;
  controller?: string;
  sourceId?: string;
  sourceName?: string;
  keepTypes: string[];
  keepCount: number;
  upTo: boolean;
  affectedPlayerIds: string[];
  expectedPlayerIds: string[];
  choices: Record<string, string[]>;
  respondedPlayerIds: string[];
  resumeStepsJson?: string;
  oracleIrControllerId?: string;
  oracleIrSourceId?: string;
  oracleIrSourceName?: string;
};

function batches(state: any): Record<string, ChooseThenSacrificeRestBatch> {
  if (
    state?.chooseThenSacrificeRestBatches
    && typeof state.chooseThenSacrificeRestBatches === 'object'
    && !Array.isArray(state.chooseThenSacrificeRestBatches)
  ) {
    return state.chooseThenSacrificeRestBatches as Record<string, ChooseThenSacrificeRestBatch>;
  }
  return {};
}

export function createChooseThenSacrificeRestBatch(
  state: any,
  batch: ChooseThenSacrificeRestBatch,
): ChooseThenSacrificeRestBatch | null {
  if (!state) return null;
  const batchId = String(batch?.id || '').trim();
  if (!batchId) return null;
  const stateAny = state as any;
  stateAny.chooseThenSacrificeRestBatches = batches(stateAny);
  const existing = stateAny.chooseThenSacrificeRestBatches[batchId];
  const next: ChooseThenSacrificeRestBatch = {
    ...existing,
    ...batch,
    id: batchId,
    choices: {
      ...(existing?.choices || {}),
      ...(batch.choices || {}),
    },
    respondedPlayerIds: Array.from(new Set([
      ...(existing?.respondedPlayerIds || []),
      ...(batch.respondedPlayerIds || []),
    ])),
  };
  stateAny.chooseThenSacrificeRestBatches[batchId] = next;
  return next;
}

export function getChooseThenSacrificeRestBatch(state: any, batchId: string): ChooseThenSacrificeRestBatch | null {
  const found = batches(state)[String(batchId || '').trim()];
  return found || null;
}

export function recordChooseThenSacrificeRestChoice(
  state: any,
  batchId: string,
  playerId: string,
  permanentIds: readonly string[],
): ChooseThenSacrificeRestBatch | null {
  const existing = getChooseThenSacrificeRestBatch(state, batchId);
  if (!existing) return null;
  const normalizedPlayerId = String(playerId || '').trim();
  if (!normalizedPlayerId) return null;
  existing.choices = {
    ...existing.choices,
    [normalizedPlayerId]: permanentIds.map((id) => String(id || '').trim()).filter(Boolean),
  };
  existing.respondedPlayerIds = Array.from(new Set([...existing.respondedPlayerIds, normalizedPlayerId]));
  return existing;
}

export function chooseThenSacrificeRestBatchComplete(batch: ChooseThenSacrificeRestBatch | null): boolean {
  if (!batch) return false;
  return batch.expectedPlayerIds.every((playerId) => batch.respondedPlayerIds.includes(playerId));
}

export function clearChooseThenSacrificeRestBatch(state: any, batchId: string): void {
  const table = batches(state);
  const normalized = String(batchId || '').trim();
  if (!normalized || !table[normalized]) return;
  delete table[normalized];
  if (Object.keys(table).length === 0 && state) {
    delete state.chooseThenSacrificeRestBatches;
  }
}

export function sacrificeUnkeptChooseThenSacrificeRest(
  ctx: GameContext,
  args: {
    keepTypes: readonly string[];
    affectedPlayerIds: readonly string[];
    choices: Record<string, readonly string[]>;
  },
): string[] {
  const sacrificedIds: string[] = [];
  for (const playerId of args.affectedPlayerIds) {
    const kept = new Set(
      (args.choices[playerId] || []).map((id) => String(id || '').trim()).filter(Boolean),
    );
    const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
    const victims = battlefield.filter((permanent: any) => {
      if (String(permanent?.controller || '').trim() !== playerId) return false;
      if (!permanentMatchesChooseThenSacrificeKeepTypes(permanent, args.keepTypes)) return false;
      const id = String(permanent?.id || '').trim();
      return Boolean(id) && !kept.has(id);
    });
    for (const permanent of victims) {
      const permanentId = String((permanent as any)?.id || '').trim();
      if (!permanentId) continue;
      const sacrificedName = sacrificePermanent(ctx, permanentId, playerId);
      if (sacrificedName) sacrificedIds.push(permanentId);
    }
  }
  if (sacrificedIds.length > 0) {
    try {
      runSBA(ctx);
    } catch {
      // death cleanup is best-effort after the sacrifices
    }
  }
  return sacrificedIds;
}

export function applyChooseThenSacrificeRestChoiceReplay(ctx: GameContext, event: any): void {
  const batchId = String(event?.batchId || '').trim();
  const playerId = String(event?.playerId || '').trim();
  const permanentIds = Array.isArray(event?.permanentIds)
    ? event.permanentIds.map((id: any) => String(id || '').trim()).filter(Boolean)
    : [];
  if (!batchId || !playerId) return;
  if (!getChooseThenSacrificeRestBatch(ctx.state, batchId)) {
    createChooseThenSacrificeRestBatch(ctx.state, {
      id: batchId,
      controller: String(event?.controller || '').trim() || undefined,
      sourceId: String(event?.sourceId || '').trim() || undefined,
      sourceName: String(event?.sourceName || '').trim() || undefined,
      keepTypes: Array.isArray(event?.keepTypes) ? event.keepTypes.map((type: any) => String(type || '')) : [],
      keepCount: Number(event?.keepCount || 0),
      upTo: event?.upTo === true,
      affectedPlayerIds: Array.isArray(event?.affectedPlayerIds)
        ? event.affectedPlayerIds.map((id: any) => String(id || '').trim()).filter(Boolean)
        : [],
      expectedPlayerIds: Array.isArray(event?.expectedPlayerIds)
        ? event.expectedPlayerIds.map((id: any) => String(id || '').trim()).filter(Boolean)
        : [],
      choices: {},
      respondedPlayerIds: [],
      resumeStepsJson: String(event?.resumeStepsJson || '').trim() || undefined,
    });
  }
  recordChooseThenSacrificeRestChoice(ctx.state, batchId, playerId, permanentIds);
}

export function applyChooseThenSacrificeRestBatchReplay(ctx: GameContext, event: any): void {
  const sacrificedIds = Array.isArray(event?.sacrificedIds)
    ? event.sacrificedIds.map((id: any) => String(id || '').trim()).filter(Boolean)
    : [];
  for (const permanentId of sacrificedIds) {
    const battlefield = Array.isArray(ctx.state?.battlefield) ? ctx.state.battlefield : [];
    const permanent = battlefield.find((entry: any) => String(entry?.id || '') === permanentId);
    if (!permanent) continue;
    sacrificePermanent(ctx, permanentId, String(permanent?.controller || event?.controller || '').trim());
  }
  if (sacrificedIds.length > 0) {
    try {
      runSBA(ctx);
    } catch {
      // best-effort
    }
  }
  clearChooseThenSacrificeRestBatch(ctx.state, String(event?.batchId || '').trim());

  if (!(ctx as any).isReplaying) return;
  const resumeJson = String(event?.resumeStepsJson || '').trim();
  if (!resumeJson) return;
  let steps: OracleEffectStep[] = [];
  try {
    const parsed = JSON.parse(resumeJson);
    if (!Array.isArray(parsed) || parsed.length === 0) return;
    steps = parsed as OracleEffectStep[];
  } catch {
    return;
  }
  const controllerId = String(event?.oracleIrControllerId || event?.controller || '').trim();
  const result = applyOracleIRStepsToGameState(
    ctx.state as any,
    steps,
    {
      controllerId,
      sourceId: String(event?.oracleIrSourceId || event?.sourceId || '').trim() || undefined,
      sourceName: String(event?.oracleIrSourceName || event?.sourceName || '').trim() || undefined,
      sourceObjectType: 'spell',
    } as any,
    { haltOnPlayerChoiceRequired: true },
  );
  if (result?.state) (ctx as any).state = result.state;
  try {
    runSBA(ctx);
  } catch {
    // best-effort lethal cleanup after replayed damage
  }
}
