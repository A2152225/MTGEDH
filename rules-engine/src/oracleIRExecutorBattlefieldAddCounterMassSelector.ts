/**
 * Origin parent: oracleIRExecutorBattlefieldStepHandlers.ts (applyAddCounterStep).
 * Cluster: generic mass-selector fallback for add_counter targets ("each other Dragon creature you control",
 * "each creature you control with a +1/+1 counter on it", compound "... and a loyalty counter on each planeswalker you control").
 * Public entries: resolveAddCounterMassSelector, applyAddCounterMassSelectorCompanion.
 */

import type { BattlefieldPermanent, GameState } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { applyCounterDeltasToBattlefieldTargets } from './oracleIRExecutorCounterPlacementCommit';
import { resolveMassBattlefieldSelector } from './oracleIRExecutorMassBattlefieldSelectorResolver';

export type AddCounterMassSelectorResolution = {
  readonly targets: BattlefieldPermanent[];
  readonly companion?: { readonly counterName: string; readonly targets: BattlefieldPermanent[] };
};

type MassRuntime = { readonly lastExiledCards?: readonly any[]; readonly lastMovedCards?: readonly any[] };

/** null = selector not recognized (keep the caller's gap); empty targets = recognized, nothing matches. */
export function resolveAddCounterMassSelector(
  state: GameState,
  targetText: string,
  ctx: OracleIRExecutionContext,
  runtime?: MassRuntime
): AddCounterMassSelectorResolution | null {
  const text = String(targetText || '').replace(/\u2019/g, "'").trim();
  const compound = text.match(/^(.+?) and an? ([a-z0-9+/\- ]+?) counters? on each (.+)$/i);
  if (compound) {
    const primary = resolveMassBattlefieldSelector(state, String(compound[1]), ctx, runtime);
    const companionTargets = resolveMassBattlefieldSelector(state, String(compound[3]), ctx, runtime);
    if (!primary || !companionTargets) return null;
    return {
      targets: primary,
      companion: { counterName: String(compound[2]).trim().toLowerCase(), targets: companionTargets },
    };
  }
  // "that creature and each other creature you control that shares a creature type with it"
  const boundAndRest = text.match(/^(?:that creature|it) and (each other .+)$/i);
  if (boundAndRest) {
    const refId = String(ctx.targetCreatureId || ctx.lastReferencedPermanentId || ctx.sourceId || '').trim();
    const bound = ((state.battlefield || []) as BattlefieldPermanent[]).filter(
      (perm: any) => refId && String(perm?.id || '').trim() === refId
    );
    const rest = resolveMassBattlefieldSelector(state, String(boundAndRest[1]), ctx, runtime);
    if (!rest || bound.length === 0) return null;
    const seen = new Set(bound.map((perm: any) => String(perm?.id || '').trim()));
    return { targets: [...bound, ...rest.filter((perm: any) => !seen.has(String(perm?.id || '').trim()))] };
  }
  const targets = resolveMassBattlefieldSelector(state, text, ctx, runtime);
  return targets ? { targets } : null;
}

/**
 * "Other creatures you control enter with an additional +1/+1 counter on them ..." is a static replacement
 * effect that rides along in the same sentence as the real trigger text; it must never place counters on
 * creatures already on the battlefield.
 */
export function isEntersWithAdditionalCounterReplacementText(raw: string): boolean {
  return /\benters? (?:the battlefield )?with an additional\b.*\bcounters?\b/i.test(String(raw || ''));
}

const UP_TO_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

/**
 * "each of up to two target attacking creatures": the chosen permanents when the player already chose,
 * 'choice_required' when not, null when the text is not an up-to-N target selector.
 */
export function resolveAddCounterUpToNTargets(
  state: GameState,
  targetText: string,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] | 'choice_required' | null {
  const match = String(targetText || '')
    .trim()
    .toLowerCase()
    .match(/^(?:each of )?up to (one|two|three|four|five|\d+) target (?:[a-z -]+ )?(?:creatures?|permanents?|planeswalkers?)(?: you control)?$/);
  if (!match) return null;
  const limit = UP_TO_WORDS[match[1]] ?? Number(match[1]);
  const chosen = new Set(
    (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  );
  if (chosen.size === 0) return 'choice_required';
  return ((state.battlefield || []) as BattlefieldPermanent[])
    .filter((perm: any) => chosen.has(String(perm?.id || '').trim()))
    .slice(0, limit);
}

export function applyAddCounterMassSelectorCompanion(
  state: GameState,
  resolution: AddCounterMassSelectorResolution,
  ctx: OracleIRExecutionContext
): { state: GameState; log: string[]; halted?: boolean } {
  const companion = resolution.companion;
  if (!companion || companion.targets.length === 0) return { state, log: [] };
  const ids = companion.targets.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean);
  return applyCounterDeltasToBattlefieldTargets(state, ids, companion.counterName, 1, ctx, 'add_counter');
}
