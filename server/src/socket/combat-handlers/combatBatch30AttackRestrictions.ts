// server/src/socket/combat-handlers/combatBatch30AttackRestrictions.ts
// Batch 30: "~ can't attack unless there are seven or more cards in your graveyard." (Deep-Sea Terror,
// River Serpent with five). Threshold-style attack gate counted from the controller's graveyard.
// Origin parent: combatDeclareAttackersSupport.ts (getOwnerAttackRestrictionReason).
// Public entry symbols: graveyardCountAttackRestrictionReason.

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const GY_RE = /can't attack unless there are (\d+|[a-z]+) or more cards in your graveyard/;

export function graveyardCountAttackRestrictionReason(creature: any, gameState: unknown): string | null {
  const text = String(creature?.card?.oracle_text || creature?.oracle_text || '').replace(/\u2019/g, "'").toLowerCase();
  const m = text.match(GY_RE);
  if (!m) return null;
  const need = /^\d+$/.test(m[1]) ? Number(m[1]) : WORDS[m[1]];
  if (!Number.isFinite(need)) return null;
  const zones: any = (gameState as any)?.zones?.[String(creature?.controller || '')];
  const have = Array.isArray(zones?.graveyard) ? zones.graveyard.length : Number(zones?.graveyardCount || 0);
  return have >= need ? null : "can't attack unless there are " + m[1] + ' or more cards in your graveyard';
}
