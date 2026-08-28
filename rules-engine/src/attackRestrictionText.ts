/**
 * Oracle-pattern combat restrictions that are not the one-shot IR `cant_attack` step.
 *
 * Families:
 * - Blanket: this creature cannot attack anyone (Pacifism, "can't attack this turn")
 * - Player-specific: can't attack its owner / you (Alexios, Xantcha)
 * - Must-attack: attacks each combat if able (self, card name, or "all creatures")
 * - Can't be sacrificed (Alexios, Assault Suit)
 * - Player prohibition: creatures can't attack you (Blazing Archon; not pillowfort unless)
 *
 * Do not treat every "can't attack" substring as a total attack lock.
 */

export interface SelfCombatRestrictions {
  readonly mustAttackEachCombat: boolean;
  readonly cantAttackOwner: boolean;
  readonly cantAttackOwnerPlaneswalkers: boolean;
  readonly cantBeSacrificed: boolean;
  readonly hasBlanketCantAttack: boolean;
}

const OTHER_MUST_ATTACK_SUBJECT =
  /\b(?:enchanted creature|equipped creature|target creature|that creature|all creatures|each creature|creatures you (?:don't |do not )?control|creatures your opponents control|creatures an opponent controls)\b/i;

function normalizeAttackRestrictionText(text: string): string {
  return String(text || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitRestrictionSentences(text: string): string[] {
  return normalizeAttackRestrictionText(text)
    .split(/[.!?\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isPlayerSpecificCantAttackTail(tail: string): boolean {
  const normalized = String(tail || '').trim().toLowerCase();
  if (!normalized) return false;
  if (/^unless\b/.test(normalized)) return true;
  if (/^alone\b/.test(normalized)) return true;
  if (/^if\b/.test(normalized)) return true;
  if (/^during\b/.test(normalized)) return true;
  if (/^its owner\b/.test(normalized)) return true;
  if (/^you\b/.test(normalized)) return true;
  if (/^planeswalkers?\b/.test(normalized)) return true;
  if (/^(?:a |the |that |this )?player\b/.test(normalized)) return true;
  return false;
}

function isExternalCantAttackSubject(subject: string): boolean {
  const normalized = String(subject || '').trim().toLowerCase();
  if (!normalized) return false;
  if (/^other\b/.test(normalized)) return true;
  if (/^all creatures\b/.test(normalized)) return true;
  if (/^each creature\b/.test(normalized)) return true;
  if (/^creatures\b/.test(normalized)) return true;
  if (/\bcreatures with\b/.test(normalized)) return true;
  if (/\bcreatures you control\b/.test(normalized)) return true;
  return false;
}

export function hasBlanketCantAttack(text: string): boolean {
  const sentences = splitRestrictionSentences(text);
  for (const sentence of sentences) {
    const match = sentence.match(/^(.*?)\bcan(?:not|'t)\s+attack(\b.*)?$/i);
    if (!match) continue;
    const subject = String(match[1] || '').trim();
    const tail = String(match[2] || '').trim();
    if (isPlayerSpecificCantAttackTail(tail)) continue;
    if (isExternalCantAttackSubject(subject)) continue;
    return true;
  }
  return false;
}

export function parseSelfCombatRestrictions(oracleText: string): SelfCombatRestrictions {
  const normalized = normalizeAttackRestrictionText(oracleText);
  const lower = normalized.toLowerCase();

  const cantAttackOwner = /\bcan't attack its owner\b/i.test(normalized);
  const cantAttackOwnerPlaneswalkers = /\bplaneswalkers its owner controls\b/i.test(normalized);
  const cantBeSacrificed = /\bcan't be sacrificed\b/i.test(normalized);

  let mustAttackEachCombat = false;
  for (const sentence of splitRestrictionSentences(normalized)) {
    if (!/\battacks each combat if able\b/i.test(sentence)) continue;
    if (OTHER_MUST_ATTACK_SUBJECT.test(sentence) && !/^(?:this creature|this permanent|it)\b/i.test(sentence)) {
      continue;
    }
    mustAttackEachCombat = true;
    break;
  }

  return {
    mustAttackEachCombat,
    cantAttackOwner,
    cantAttackOwnerPlaneswalkers,
    cantBeSacrificed,
    hasBlanketCantAttack: hasBlanketCantAttack(normalized),
  };
}

export function getIllegalDefendingPlayerRestriction(args: {
  oracleText?: string;
  ownerId?: string | null;
  controllerId?: string | null;
  defendingPlayerId?: string | null;
  cantAttackOwner?: boolean;
  targetIsOwnerPlaneswalker?: boolean;
}): { illegal: boolean; reason?: string } {
  const defendingPlayerId = String(args.defendingPlayerId || '').trim();
  if (!defendingPlayerId) {
    return { illegal: false };
  }

  const restrictions = parseSelfCombatRestrictions(String(args.oracleText || ''));
  const cantAttackOwner = args.cantAttackOwner === true || restrictions.cantAttackOwner;
  if (!cantAttackOwner) {
    return { illegal: false };
  }

  const ownerId = String(args.ownerId || '').trim();
  if (!ownerId || defendingPlayerId !== ownerId) {
    return { illegal: false };
  }

  if (args.targetIsOwnerPlaneswalker) {
    if (restrictions.cantAttackOwnerPlaneswalkers) {
      return {
        illegal: true,
        reason: "This creature can't attack planeswalkers its owner controls",
      };
    }
    return { illegal: false };
  }

  return {
    illegal: true,
    reason: "This creature can't attack its owner",
  };
}

export function permanentHasMustAttackRequirement(
  permanent: any,
  battlefield?: readonly any[],
): boolean {
  if (Boolean(permanent?.mustAttackEachCombat) || Boolean(permanent?.mustAttack)) {
    return true;
  }

  const selfText = [
    String(permanent?.card?.oracle_text || ''),
    String(permanent?.oracle_text || ''),
    Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities.join('\n') : '',
  ].join('\n');
  if (parseSelfCombatRestrictions(selfText).mustAttackEachCombat) {
    return true;
  }

  if (!Array.isArray(battlefield)) {
    return false;
  }

  const attackingPlayerId = String(permanent?.controller || '').trim();
  for (const source of battlefield) {
    const text = normalizeAttackRestrictionText(String(source?.card?.oracle_text || source?.oracle_text || ''));
    if (/(?:all creatures|each creature)\s+attacks?\s+each combat if able/i.test(text)) {
      return true;
    }
    const sourceController = String(source?.controller || '').trim();
    if (
      sourceController &&
      sourceController === attackingPlayerId &&
      /creatures you control\s+attack(?:s)?\s+each combat if able/i.test(text)
    ) {
      return true;
    }
    if (
      sourceController &&
      attackingPlayerId &&
      sourceController !== attackingPlayerId &&
      /(?:creatures|each creature) you (?:don't|do not) control\s+attacks?\s+each combat if able/i.test(text)
    ) {
      return true;
    }
  }

  return false;
}

function attachedPermanents(permanent: any, battlefield?: readonly any[]): any[] {
  if (!Array.isArray(battlefield) || !permanent) return [];
  const attachedIds = new Set<string>([
    ...(Array.isArray(permanent.attachments) ? permanent.attachments : []),
    ...(Array.isArray(permanent.attachedEquipment) ? permanent.attachedEquipment : []),
  ].map((id) => String(id || '').trim()).filter(Boolean));
  const permanentId = String(permanent.id || '').trim();
  return battlefield.filter((entry) => {
    const id = String(entry?.id || '').trim();
    if (attachedIds.has(id)) return true;
    return Boolean(permanentId) && String(entry?.attachedTo || '').trim() === permanentId;
  });
}

export function permanentCannotBeSacrificed(
  permanent: any,
  battlefield?: readonly any[],
): boolean {
  if (!permanent) return false;
  if (permanent.cantBeSacrificed === true) return true;

  const selfText = [
    String(permanent?.card?.oracle_text || ''),
    String(permanent?.oracle_text || ''),
    Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities.join('\n') : '',
  ].join('\n');
  if (parseSelfCombatRestrictions(selfText).cantBeSacrificed) {
    return true;
  }

  const controllerId = String(permanent?.controller || '').trim();
  const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
  const isCreature = /\bcreature\b/.test(typeLine);

  for (const attached of attachedPermanents(permanent, battlefield)) {
    const attachedText = normalizeAttackRestrictionText(String(attached?.card?.oracle_text || ''));
    const grantsOnEquipped = /\bequipped creature\b/i.test(attachedText);
    const grantsOnEnchanted = /\benchanted (?:creature|permanent)\b/i.test(attachedText);
    if ((grantsOnEquipped || grantsOnEnchanted) && /\bcan't be sacrificed\b/i.test(attachedText)) {
      return true;
    }
  }

  if (!Array.isArray(battlefield) || !controllerId) {
    return false;
  }

  for (const source of battlefield) {
    if (String(source?.controller || '').trim() !== controllerId) continue;
    const text = normalizeAttackRestrictionText(String(source?.card?.oracle_text || ''));
    if (/\bpermanents you control can't be sacrificed\b/i.test(text)) return true;
    if (isCreature && /\bcreatures you control can't be sacrificed\b/i.test(text)) return true;
  }

  return false;
}

export function getAttackProhibitionSourceForPlayer(
  battlefield: readonly any[] | undefined,
  defendingPlayerId: string | undefined,
): string | null {
  if (!Array.isArray(battlefield) || !defendingPlayerId) {
    return null;
  }

  const normalizedDefendingPlayerId = String(defendingPlayerId || '').trim();
  for (const permanent of battlefield) {
    if (String(permanent?.controller || '').trim() !== normalizedDefendingPlayerId) {
      continue;
    }

    const oracleText = normalizeAttackRestrictionText(String(permanent?.card?.oracle_text || ''));
    if (/\byou can't be attacked(?!\s+except)\b/i.test(oracleText)) {
      return String(permanent?.card?.name || 'an effect');
    }
    // Color-prefixed "Black creatures can't attack you" is gated (StaticEffectSpec),
    // not a blanket player lock. "Flying Creatures can't attack you" still matches.
    // Pillowfort with "or planeswalkers you control unless …" is tax, not a lock.
    if (
      /(?<!(?:nonblack|nonwhite|nonblue|nonred|nongreen|black|white|blue|red|green)\s)\bcreatures can't attack you(?!(?: or planeswalkers? you control)?\s+unless)/i.test(oracleText)
    ) {
      return String(permanent?.card?.name || 'an effect');
    }
  }

  return null;
}
