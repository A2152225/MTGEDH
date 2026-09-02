/**
 * Origin sibling: oracleIrBattlefieldEntryPrompts.ts.
 * Cluster: automatic (non-prompt) as-enters replacements for permanents IR
 *   puts onto the battlefield (tap from replacement effects, stamp
 *   battlefieldEntryReplacement the same way spell-entry does).
 * Public: applyAsEntersAutomaticReplacementsForPermanent,
 *   tryApplyAsEntersAutomaticReplacementsForPermanent.
 *
 * createBattlefieldPermanentsFromCards never calls
 * evaluateBattlefieldEntryReplacementEvent / checkPermanentEntersTapped
 * the way putCardOntoBattlefield and stack permanent-entry do.
 */

import { checkPermanentEntersTapped } from './triggerPermanentEntersTapped.js';
import { evaluateBattlefieldEntryReplacementEvent } from './replacement-effects.js';
import { debug } from '../../utils/debug.js';

function readEntryCounters(permanent: any): Record<string, number> {
  const raw = permanent?.counters && typeof permanent.counters === 'object'
    ? permanent.counters
    : {};
  const entryCounters: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount > 0) entryCounters[key] = amount;
  }
  return entryCounters;
}

/**
 * Apply automatic as-enters replacement effects to one IR-stamped permanent.
 * Does not queue player prompts (shock pay-life, reveal, color/copy/type).
 */
export function applyAsEntersAutomaticReplacementsForPermanent(
  state: any,
  permanent: any,
  controller: string,
): void {
  if (!permanent || !state) return;
  const card = permanent.card || permanent;
  const controllerId = String(controller || permanent.controller || permanent.controllerId || '').trim();
  if (!controllerId) return;

  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const permanentId = String(permanent.id || '').trim();
  const others = battlefield.filter((entry: any) => String(entry?.id || '').trim() !== permanentId);

  if (!permanent.tapped && checkPermanentEntersTapped(others, controllerId, card)) {
    permanent.tapped = true;
  }

  const copySourceId = String(
    permanent.copySourceId
    || permanent.copiedFromPermanentId
    || card.copiedFromCardId
    || '',
  ).trim();

  const entryReplacement = evaluateBattlefieldEntryReplacementEvent({
    state,
    card,
    permanent,
    controllerId,
    entersTapped: Boolean(permanent.tapped),
    entryCounters: readEntryCounters(permanent),
    entersTransformed: Boolean(permanent.transformed || card.transformed),
    entersFaceDown: Boolean(permanent.faceDown || card.faceDown || permanent.faceUpCard),
    copySourceId: copySourceId || undefined,
    cause: 'oracle_ir:battlefield_entry',
  });

  if (entryReplacement.applied) {
    permanent.battlefieldEntryReplacement = entryReplacement;
  }
}

/**
 * Crash-safe wrapper: a missing, misnamed, or unbound helper must not kill the
 * process (tsx transpile-only does not catch unbound identifiers at compile time).
 */
export function tryApplyAsEntersAutomaticReplacementsForPermanent(
  state: any,
  permanent: any,
  controller: string,
  applyFn: unknown = applyAsEntersAutomaticReplacementsForPermanent,
): void {
  if (typeof applyFn !== 'function') return;
  try {
    (applyFn as typeof applyAsEntersAutomaticReplacementsForPermanent)(state, permanent, controller);
  } catch (error) {
    debug(2, `[oracleIR] as-enters automatic replacements skipped: ${error}`);
  }
}
