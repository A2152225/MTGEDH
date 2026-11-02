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

/** B37: "Equip\u2014Discard a card." Returns true for a single-card discard equip cost. */
export function parseEquipDiscardCost(cost: unknown): boolean {
  return /^discard an? card$/i.test(String(cost || '').trim());
}

/** Cards in playerId's hand that can be discarded for the equip cost. */
export function equipDiscardCandidates(state: any, playerId: string, cost: unknown): any[] {
  if (!parseEquipDiscardCost(cost)) return [];
  const hand = state?.zones?.[playerId]?.hand;
  return Array.isArray(hand) ? hand.filter((c: any) => c && c.id) : [];
}

// B41: energy costs ("Pay eight {E}", "{E}{E}{E}") shared by alternative costs and graveyard keywords.
const B41_ENERGY_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
export function parseEnergyCost(cost: unknown): number | null {
  const s = String(cost || '').trim().replace(/[.]+$/, '');
  let m = s.match(/^(?:pay\s+)?((?:\{E\})+)$/i);
  if (m) return (m[1].match(/\{E\}/gi) || []).length;
  m = s.match(/^pay\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+\{E\}$/i);
  if (m) return /^\d+$/.test(m[1]) ? Number(m[1]) : B41_ENERGY_WORDS[m[1].toLowerCase()];
  return null;
}
export function energyCostError(state: any, playerId: string, cost: unknown): string | null {
  const n = parseEnergyCost(cost);
  if (n === null) return null;
  const have = Number(state?.energy?.[playerId] || 0);
  return have >= n ? null : `You need ${n} energy (you have ${have}).`;
}
export function payEnergyCost(state: any, playerId: string, cost: unknown): boolean {
  const n = parseEnergyCost(cost);
  if (n === null || !state) return false;
  const have = Number(state?.energy?.[playerId] || 0);
  if (have < n) return false;
  state.energy = state.energy || {};
  state.energy[playerId] = have - n;
  if (state.energyCount && typeof state.energyCount === 'object') state.energyCount[playerId] = state.energy[playerId];
  return true;
}
