// Sacrifice picks against emit-stacked permanents: game view collapses identical tokens (and
// same-named lands) into one `isGroupedTokens` entry with `groupedTokenIds`. Pickers keep the
// stack as one tile with a count; payment and server responses need the real member ids.
// Public entry symbols: stackMemberIds, sacrificeCandidatesExcluding, adjustStackSelection,
//   stackSelectionTotal, expandStackSelection, chunkSacrificeIds, remainingManaUnits,
//   sacrificedIdsInPayment.

import type { BattlefieldPermanent, PaymentItem } from '../../../shared/src';

export type StackSelection = ReadonlyMap<string, number>;

export function stackMemberIds(perm: BattlefieldPermanent): string[] {
  const grouped = (perm as any).isGroupedTokens === true ? (perm as any).groupedTokenIds : undefined;
  if (Array.isArray(grouped) && grouped.length > 0) return grouped.map((id: unknown) => String(id));
  return [String(perm.id)];
}

/** Drop permanents (or stack members) already committed elsewhere, e.g. earlier activations. */
export function sacrificeCandidatesExcluding(
  permanents: readonly BattlefieldPermanent[],
  excludedIds: ReadonlySet<string>,
): BattlefieldPermanent[] {
  if (excludedIds.size === 0) return permanents.slice();
  const result: BattlefieldPermanent[] = [];
  for (const perm of permanents) {
    const members = stackMemberIds(perm).filter((id) => !excludedIds.has(id));
    if (members.length === 0) continue;
    if ((perm as any).isGroupedTokens === true) {
      result.push({ ...perm, groupedTokenIds: members, tokenCount: members.length } as BattlefieldPermanent);
    } else {
      result.push(perm);
    }
  }
  return result;
}

export function stackSelectionTotal(selection: StackSelection): number {
  let total = 0;
  for (const qty of selection.values()) total += qty;
  return total;
}

/** Change how many members of one tile are picked, clamped to the stack size and the total needed. */
export function adjustStackSelection(
  selection: StackSelection,
  perm: BattlefieldPermanent,
  nextQty: number,
  required: number,
): Map<string, number> {
  const id = String(perm.id);
  const current = selection.get(id) || 0;
  const roomLeft = Math.max(0, required - (stackSelectionTotal(selection) - current));
  const qty = Math.max(0, Math.min(Math.floor(nextQty), stackMemberIds(perm).length, roomLeft));
  const next = new Map(selection);
  if (qty > 0) next.set(id, qty);
  else next.delete(id);
  return next;
}

export function expandStackSelection(
  permanents: readonly BattlefieldPermanent[],
  selection: StackSelection,
): string[] {
  const ids: string[] = [];
  for (const perm of permanents) {
    const qty = selection.get(String(perm.id)) || 0;
    if (qty > 0) ids.push(...stackMemberIds(perm).slice(0, qty));
  }
  return ids;
}

export function chunkSacrificeIds(ids: readonly string[], perActivation: number): string[][] {
  const size = Math.max(1, Math.floor(perActivation));
  const chunks: string[][] = [];
  for (let index = 0; index + size <= ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

/** Mana pips still unpaid; caps how many sacrifice activations the picker offers. */
export function remainingManaUnits(remaining: {
  colors: Record<string, number>;
  generic: number;
  hybrids?: readonly unknown[];
}): number {
  let total = Math.max(0, Number(remaining.generic) || 0);
  for (const amount of Object.values(remaining.colors || {})) total += Math.max(0, Number(amount) || 0);
  return total + (remaining.hybrids?.length || 0);
}

export function sacrificedIdsInPayment(items: readonly PaymentItem[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    for (const id of (item as any).sacrificedPermanentIds || []) ids.add(String(id));
  }
  return ids;
}
