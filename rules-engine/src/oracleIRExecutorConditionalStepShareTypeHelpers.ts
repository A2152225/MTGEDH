/**
 * Origin: oracleIRExecutorConditionalStepSupportHelpers.ts
 * Cluster: kinship / Descendants' Path "shares a creature type" library-top checks
 * Public: topCardSharesCreatureTypeWithSource, topCardSharesCreatureTypeWithControlledCreature
 * Leaf must not import oracleIRExecutorConditionalStepSupportHelpers.ts.
 */

import type { GameState, PlayerID } from '../../shared/src';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { getCreatureSubtypeKeys } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower, hasExecutorClass } from './oracleIRExecutorPermanentUtils';

function getTopLibraryCard(nextState: GameState, ownerId: string): any | null {
  const normalizedOwnerId = String(ownerId || '').trim();
  if (!normalizedOwnerId) return null;
  const player = (nextState.players || []).find((entry: any) => String(entry?.id || '').trim() === normalizedOwnerId) as any;
  return Array.isArray(player?.library) && player.library.length > 0 ? player.library[0] : null;
}

function objectIsCreature(object: any): boolean {
  if (hasExecutorClass(object, 'creature')) return true;
  return /\bcreature\b/i.test(getExecutorTypeLineLower(object));
}

export function topCardSharesCreatureTypeWithSource(nextState: GameState, ownerId: string, sourceRef: any): boolean {
  const topCard = getTopLibraryCard(nextState, ownerId);
  if (!topCard || !sourceRef) return false;

  const topCardSubtypes = new Set(getCreatureSubtypeKeys(topCard, getExecutorTypeLineLower));
  const sourceSubtypes = new Set(getCreatureSubtypeKeys(sourceRef, getExecutorTypeLineLower));
  if (topCardSubtypes.size === 0 || sourceSubtypes.size === 0) return false;

  for (const subtype of topCardSubtypes) {
    if (sourceSubtypes.has(subtype)) return true;
  }
  return false;
}

export function topCardSharesCreatureTypeWithControlledCreature(
  nextState: GameState,
  ownerId: string,
  controllerId: PlayerID,
): boolean {
  const topCard = getTopLibraryCard(nextState, ownerId);
  if (!topCard) return false;
  if (!getExecutorTypeLineLower(topCard).includes('creature')) return false;

  const topCardSubtypes = new Set(getCreatureSubtypeKeys(topCard, getExecutorTypeLineLower));
  if (topCardSubtypes.size === 0) return false;

  const normalizedControllerId = String(controllerId || '').trim();
  if (!normalizedControllerId) return false;

  const battlefield = getProcessedBattlefield(nextState) as any[];
  for (const perm of battlefield) {
    if (String(perm?.controller || '').trim() !== normalizedControllerId) continue;
    if (!objectIsCreature(perm)) continue;
    const permSubtypes = new Set(getCreatureSubtypeKeys(perm, getExecutorTypeLineLower));
    for (const subtype of topCardSubtypes) {
      if (permSubtypes.has(subtype)) return true;
    }
  }
  return false;
}
