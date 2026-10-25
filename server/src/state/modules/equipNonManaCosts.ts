// server/src/state/modules/equipNonManaCosts.ts
// Batch 33: life-payment Equip costs ("Equip\u2014Pay 3 life"), parsed by shared/src/equipAbilities.ts as "Pay N life".
// Origin parent: interactionActivateEquipFortifyReconfigure (affordability) and
// targetSelectionBattlefieldAbilityHandlers (payment after the target is chosen).
// Public entry symbols: parseEquipLifeCost, equipLifeCostError, payEquipLifeCost,
//   parseEquipSacrificeCost, equipSacrificeCandidates (UI34 "Equip\u2014Sacrifice a creature").

export function parseEquipLifeCost(cost: unknown): number | null {
  const m = String(cost || '').trim().match(/^pay (\d+) life$/i);
  return m ? Number(m[1]) : null;
}

function currentLife(state: any, playerId: string): number {
  const fromMap = state?.life?.[playerId];
  if (typeof fromMap === 'number') return fromMap;
  const player = (Array.isArray(state?.players) ? state.players : []).find((p: any) => String(p?.id) === playerId);
  return Number(player?.life ?? 0);
}

/** Error text when the player can't pay this equip life cost, else null (also null for non-life costs). */
export function equipLifeCostError(state: any, playerId: string, cost: unknown): string | null {
  const amount = parseEquipLifeCost(cost);
  if (amount === null) return null;
  return currentLife(state, playerId) >= amount ? null : `You can't pay ${amount} life.`;
}

/** Pays the life cost; returns true when the cost was a life cost and was paid. */
export function payEquipLifeCost(state: any, playerId: string, cost: unknown): boolean {
  const amount = parseEquipLifeCost(cost);
  if (amount === null || !state) return false;
  const next = currentLife(state, playerId) - amount;
  if (!state.life || typeof state.life !== 'object') state.life = {};
  state.life[playerId] = next;
  const player = (Array.isArray(state.players) ? state.players : []).find((p: any) => String(p?.id) === playerId);
  if (player) player.life = next;
  return true;
}

/** UI34: "Sacrifice a creature" style equip cost; returns the permanent type word, else null. */
export function parseEquipSacrificeCost(cost: unknown): string | null {
  const m = String(cost || '').trim().match(/^sacrifice an? (creature|artifact|enchantment|land)$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Permanents playerId controls that can be sacrificed for the cost (excluding the equipment / equip target). */
export function equipSacrificeCandidates(state: any, playerId: string, cost: unknown, excludeIds: readonly string[] = []): any[] {
  const type = parseEquipSacrificeCost(cost);
  if (!type) return [];
  const exclude = new Set(excludeIds.map(String));
  return (Array.isArray(state?.battlefield) ? state.battlefield : []).filter((p: any) => p
    && String(p.controller || '') === String(playerId)
    && !exclude.has(String(p.id))
    && new RegExp('\\b' + type + '\\b').test(String(p?.card?.type_line || '').toLowerCase()));
}
