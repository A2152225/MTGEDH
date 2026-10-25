// server/src/socket/combat-handlers/combatBatch34AttackRestrictions.ts
// Batch 34: "~ can't attack unless you've cast a creature spell this turn." (Goblin Cohort, Mogg Conscripts)
// and the noncreature variant. Origin parent: combatDeclareAttackersSupport.ts (getOwnerAttackRestrictionReason).
// Public entry symbols: castThisTurnAttackRestrictionReason.

const CAST_GATE_RE = /can't attack unless you've cast a (creature|noncreature) spell this turn\b/;

export function castThisTurnAttackRestrictionReason(creature: any, gameState: unknown): string | null {
  const text = String(creature?.card?.oracle_text || creature?.oracle_text || '').replace(/\u2019/g, "'").toLowerCase();
  const m = text.match(CAST_GATE_RE);
  if (!m) return null;
  const controller = String(creature?.controller || '');
  const list = (gameState as any)?.spellsCastThisTurn;
  const entries = Array.isArray(list) ? list : [];
  const wantCreature = m[1] === 'creature';
  const found = entries.some((entry: any) => {
    const caster = String(entry?.casterId ?? entry?.playerId ?? entry?.controllerId ?? '');
    if (caster !== controller) return false;
    const isCreature = /\bcreature\b/i.test(String(entry?.card?.type_line ?? entry?.type_line ?? ''));
    return wantCreature ? isCreature : !isCreature;
  });
  if (found) return null;
  return `${String(creature?.card?.name || 'This creature')} can't attack unless you've cast a ${m[1]} spell this turn`;
}
