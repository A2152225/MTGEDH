// Cluster: "For each opponent, exile [up to one] target <type> that player controls
//   [until ~ leaves the battlefield]" (Grasp of Fate, Banisher-style per-opponent exiles).
// Public entry: tryApplyForEachOpponentExileStep.
//
// The chosen targets bind per opponent: each opponent contributes at most one of the
// chosen ids that it controls and that matches the printed type. "Up to one" never
// auto-picks; only a mandatory "target" falls back to a deterministic pick when the
// player bound nothing at all.

import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import { annotateBattlefieldExilesWithSource } from './oracleIRExecutorBattlefieldAnnotateExiles';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import { parseSimpleBattlefieldSelector } from './oracleIRExecutorBattlefieldParser';
import { oracleIrBattlefieldRemovalOptions } from './oracleIRExecutorBattlefieldRemovalHelpers';
import {
  finalizeBattlefieldRemoval,
  permanentMatchesSelector,
  permanentMatchesType,
} from './oracleIRExecutorBattlefieldOps';

function buildPerOpponentTypeMatcher(
  exileRaw: string,
  ctx: OracleIRExecutionContext,
): { matches: (perm: any) => boolean; upTo: boolean } {
  const typed = exileRaw.match(
    /\bexile\s+(up to one\s+)?target\s+(.+?)\s+(?:that player|they)\s+controls?\b/i,
  );
  const upTo = Boolean(typed?.[1]);
  const typePhrase = String(typed?.[2] || '').trim();
  const selector = typePhrase
    ? parseSimpleBattlefieldSelector({ kind: 'raw', text: `target ${typePhrase}` } as any)
    : null;
  if (selector) {
    // Controller is enforced per opponent below; ignore any parsed controller filter.
    const anyController = { ...(selector as any), controllerFilter: 'any' };
    return { matches: (perm) => permanentMatchesSelector(perm, anyController, ctx), upTo };
  }
  return { matches: (perm) => permanentMatchesType(perm, 'creature'), upTo };
}

export function tryApplyForEachOpponentExileStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile' }>,
  ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult | null {
  const exileRaw = String(step.raw || '').trim();
  if (!/^for each opponent,\s+exile\s+/i.test(exileRaw)) return null;

  const controllerId = String(ctx.controllerId || '').trim() as PlayerID;
  const opponents = (state.players || [])
    .map((entry: any) => String(entry?.id || '').trim())
    .filter((id) => id && id !== controllerId);
  const { matches, upTo } = buildPerOpponentTypeMatcher(exileRaw, ctx);
  const chosenIds = collectBoundBattlefieldIds(ctx);
  let workingState = state;
  const combinedLog: string[] = [];
  const exiledSnapshots: any[] = [];
  let battlefieldNow = [...((workingState.battlefield || []) as any[])];

  for (const opponentId of opponents) {
    const boundForOpponent = chosenIds.filter((id) => {
      const perm = battlefieldNow.find((p) => String(p?.id || '').trim() === id);
      return perm && String(perm?.controller || '').trim() === opponentId && matches(perm);
    });
    let targetId = boundForOpponent[0] || '';
    if (!targetId && !upTo && chosenIds.length === 0) {
      targetId = String(
        battlefieldNow.find((p) => String(p?.controller || '').trim() === opponentId && matches(p))?.id || '',
      ).trim();
    }
    if (!targetId) continue;
    const toRemove = battlefieldNow.filter((p) => String(p?.id || '').trim() === targetId);
    if (toRemove.length === 0) continue;
    const removedIds = new Set(toRemove.map((p) => String(p?.id || '').trim()));
    const kept = battlefieldNow.filter((p) => !removedIds.has(String(p?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(
      workingState,
      toRemove,
      removedIds,
      kept,
      'exile',
      'exiled',
      oracleIrBattlefieldRemovalOptions(ctx, 'exile'),
    );
    workingState = annotateBattlefieldExilesWithSource(result.state, toRemove, ctx);
    battlefieldNow = [...((workingState.battlefield || []) as any[])];
    combinedLog.push(...(result.log || []));
    exiledSnapshots.push(...toRemove);
  }

  return {
    applied: true,
    state: workingState,
    log: combinedLog.length > 0 ? combinedLog : [`No opponent permanents exiled: ${exileRaw}`],
    lastMovedCards: exiledSnapshots,
  };
}
