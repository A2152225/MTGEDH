// server/src/state/utils-handlers/ptAttachedBonusNameTables.ts
// Origin parent: server/src/state/utils.ts
// Cluster moved: EQUIPMENT_BONUSES / AURA_BONUSES (legacy empty name tables).
// Public entry symbols: EQUIPMENT_BONUSES, AURA_BONUSES.
// Not re-exported from utils.ts (were file-private).

/**
 * Legacy equipment P/T bonuses when attached card objects lack oracle_text.
 * Prefer resolveAttachedPTBonusFromOracle / parseStaticAttachedPTBonusFromOracle.
 */
export const EQUIPMENT_BONUSES: Record<string, { power: number; toughness: number }> = {};

/**
 * Legacy aura P/T bonuses when attached card objects lack oracle_text.
 * Prefer resolveAttachedPTBonusFromOracle / parseStaticAttachedPTBonusFromOracle.
 */
export const AURA_BONUSES: Record<string, { power: number; toughness: number }> = {};
