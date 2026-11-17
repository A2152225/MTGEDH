/**
 * Origin parents: oracleIRExecutorUnlessPaysForEachPermanents.ts (dealtDamageToSourceThisTurn) and
 *   oracleIRExecutorCreatureStepUtils-handlers/oracleIRExecutorCreatureTargetIds.ts (selector text).
 * Cluster: "each creature that dealt damage to it/this creature this turn" selector (Brine Hag).
 * Public: permanentDealtDamageToSource, isCreaturesThatDealtDamageToSourceSelectorText,
 *   resolveCreatureIdsThatDealtDamageToSource.
 * Leaf: imports nothing from the executor barrels (avoids a cycle with CreatureStepUtils).
 */

import type { GameState } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';

const DEALT_DAMAGE_TO_SOURCE_SELECTOR =
  /^(?:(?:each|all)\s+)?creatures?\s+that\s+dealt\s+damage\s+to\s+(?:it|this\s+creature|this\s+permanent)\s+this\s+turn$/i;

export function isCreaturesThatDealtDamageToSourceSelectorText(text: string): boolean {
  return DEALT_DAMAGE_TO_SOURCE_SELECTOR.test(String(text || '').trim().replace(/[.\s]+$/g, ''));
}

/** Dealer-side bags: the permanent recorded that it dealt (combat) damage to `sourceId` this turn. */
export function permanentDealtDamageToSource(permanent: unknown, sourceId: string): boolean {
  if (!sourceId) return false;
  const perm = permanent as {
    dealtCombatDamageTo?: unknown;
    damagedPermanentIds?: unknown;
    combatDamageDealtTo?: unknown;
  };
  const bags = [perm.dealtCombatDamageTo, perm.damagedPermanentIds, perm.combatDamageDealtTo];
  for (const bag of bags) {
    if (bag instanceof Set && bag.has(sourceId)) return true;
    if (Array.isArray(bag) && bag.some((entry) => String(entry || '').trim() === sourceId)) return true;
  }
  return false;
}

function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
}

function permanentIdOf(permanent: unknown): string {
  return String((permanent as { id?: unknown } | null)?.id || '').trim();
}

function looksLikeCreature(permanent: unknown): boolean {
  const perm = permanent as { card?: { type_line?: unknown }; type_line?: unknown } | null;
  const typeLine = String(perm?.card?.type_line ?? perm?.type_line ?? '').toLowerCase();
  return typeLine.includes('creature');
}

/**
 * Battlefield creature ids that dealt damage to the ability's source this turn. Sources of evidence:
 * the damaged permanent's `damageSourceIds` (still on the battlefield, retained on the dying card, or listed on ctx)
 * and each dealer's own damage bags.
 */
export function resolveCreatureIdsThatDealtDamageToSource(
  state: GameState,
  ctx: OracleIRExecutionContext,
): string[] {
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return [];
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];

  const dealerIds = new Set<string>();
  const sourcePermanent = battlefield.find((perm) => permanentIdOf(perm) === sourceId) as any;
  for (const id of idList(sourcePermanent?.damageSourceIds)) dealerIds.add(id);
  const anyCtx = ctx as any;
  for (const id of idList(anyCtx?.damageSourceCreatureIds)) dealerIds.add(id);
  for (const id of idList(anyCtx?.damageSourcePermanentIds)) dealerIds.add(id);
  for (const id of idList(anyCtx?.damageSourceIds)) dealerIds.add(id);
  for (const id of idList(anyCtx?.sourceCard?.damageSourceIds)) dealerIds.add(id);
  if (Array.isArray(anyCtx?.damageSourcePermanents)) {
    for (const perm of anyCtx.damageSourcePermanents) {
      const id = permanentIdOf(perm);
      if (id) dealerIds.add(id);
    }
  }

  const ids: string[] = [];
  for (const perm of battlefield) {
    const id = permanentIdOf(perm);
    if (!id || id === sourceId || !looksLikeCreature(perm)) continue;
    if (dealerIds.has(id) || permanentDealtDamageToSource(perm, sourceId)) ids.push(id);
  }
  return ids;
}
