// server/src/socket/combat-handlers/combatBatch53AttackAlone.ts
// Batch 53: "This creature can't attack alone." (Bonded Construct, Trusty Companion, ...)
// "~ can't attack alone unless he has a +1/+1 counter on him." (Pipsqueak)
// "Enchanted creature ... can't attack alone." (Sightless Brawler bestow)
// Origin parent: combatDeclareAttackersSupport.ts (getOwnerAttackRestrictionReason).
// Public entry symbols: cantAttackAloneReason.

function oracleLower(perm: any): string {
  return String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'").toLowerCase();
}

function hasPlusOneCounter(creature: any): boolean {
  const counters = creature?.counters || {};
  return Number(counters['+1/+1'] || counters.p1p1 || 0) > 0;
}

function selfCantAttackAlone(text: string): { restricted: boolean; unlessPlusOne: boolean } {
  if (/can't attack alone unless (?:he|she|it|they) has? (?:a |an )?\+1\/\+1 counter/.test(text)) {
    return { restricted: true, unlessPlusOne: true };
  }
  if (/(?:^|[.\n]\s*)(?:this creature|~) can't attack alone\b/.test(text)) {
    return { restricted: true, unlessPlusOne: false };
  }
  if (/(?:^|[.\n]\s*)[a-z][a-z0-9 ,'.-]* can't attack alone\b/.test(text) && !/enchanted creature/.test(text)) {
    return { restricted: true, unlessPlusOne: /unless (?:he|she|it|they) has?/.test(text) && /\+1\/\+1/.test(text) };
  }
  return { restricted: false, unlessPlusOne: false };
}

function attachedGrantsCantAttackAlone(text: string): boolean {
  return /\benchanted creature\b[^.\n]*\bcan't attack alone\b/.test(text);
}

export function cantAttackAloneReason(
  creature: any,
  proposedAttackerIds: readonly string[] | undefined,
  battlefield?: readonly any[],
): string | null {
  // Without the proposed attack set we cannot know if the creature would be alone.
  if (!Array.isArray(proposedAttackerIds)) return null;

  let restricted = false;
  let unlessPlusOne = false;
  const self = selfCantAttackAlone(oracleLower(creature));
  if (self.restricted) {
    restricted = true;
    unlessPlusOne = unlessPlusOne || self.unlessPlusOne;
  }
  const id = String(creature?.id || '');
  for (const src of Array.isArray(battlefield) ? battlefield : []) {
    if (!src || src.phasedOut) continue;
    if (String(src.attachedTo || '') !== id) continue;
    if (attachedGrantsCantAttackAlone(oracleLower(src))) restricted = true;
  }
  if (!restricted) return null;
  if (unlessPlusOne && hasPlusOneCounter(creature)) return null;

  const others = proposedAttackerIds.map(String).filter((x) => x && x !== id);
  if (others.length > 0) return null;
  return "can't attack alone";
}
