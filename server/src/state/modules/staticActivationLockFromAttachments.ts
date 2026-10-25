// server/src/state/modules/staticActivationLockFromAttachments.ts
// Arrest / Pacifism-plus style locks: an Aura or Equipment attached to a
// permanent says "enchanted creature can't attack or block, and its activated
// abilities can't be activated" or "enchanted permanent's activated abilities
// can't be activated" (optionally "unless they're mana abilities").
// Public entry symbols: permanentActivatedAbilitiesLockedByAttachment.

const LOCK_RE =
  /\b(?:enchanted|equipped) (?:creature|permanent|artifact|land|planeswalker)(?:'s|[^.]*?\band its) activated abilities can't be activated(?<unless> unless they're mana abilities)?/;

// Batch 20: global type locks (Stony Silence / Collector Ouphe / Null Rod, Cursed Totem, Linvala, Karn).
const GLOBAL_LOCK_RE =
  /\bactivated abilities of (?<types>[a-z ,]+?)(?<opp> your opponents control)? can't be activated(?<unless> unless they're mana abilities)?(?:\.|$)/;
const LOCK_TYPES = new Set(['artifact', 'creature', 'land', 'planeswalker', 'enchantment']);

function lockedTypes(raw: string): string[] | null {
  const parts = raw.split(/,\s*(?:and |or )?|\s+and\s+|\s+or\s+/).map((p) => p.trim().replace(/s$/, '')).filter(Boolean);
  return parts.length > 0 && parts.every((p) => LOCK_TYPES.has(p)) ? parts : null;
}

function globalTypeLock(permanent: any, other: any, isManaAbility: boolean): boolean {
  const match = lowerOracle(other).match(GLOBAL_LOCK_RE);
  if (!match?.groups) return false;
  const types = lockedTypes(match.groups.types || '');
  if (!types) return false;
  if (match.groups.unless && isManaAbility) return false;
  if (match.groups.opp && String(permanent?.controller || '') === String(other?.controller || '')) return false;
  const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
  return types.some((t) => new RegExp('\\b' + t + '\\b').test(typeLine));
}

function lowerOracle(perm: any): string {
  return String(perm?.card?.oracle_text || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

export function permanentActivatedAbilitiesLockedByAttachment(
  permanent: any,
  state: any,
  isManaAbility: boolean,
): { locked: boolean; sourceName?: string } {
  const id = String(permanent?.id || '');
  if (!id) return { locked: false };
  if (permanent?.activatedAbilitiesLocked === true && !isManaAbility) return { locked: true };
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const other of battlefield) {
    if (other && globalTypeLock(permanent, other, isManaAbility)) return { locked: true, sourceName: other?.card?.name };
    if (!other || String(other.attachedTo || '') !== id) continue;
    const match = lowerOracle(other).match(LOCK_RE);
    if (!match) continue;
    if (match.groups?.unless && isManaAbility) continue;
    return { locked: true, sourceName: other?.card?.name };
  }
  return { locked: false };
}
