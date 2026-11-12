/**
 * Beam me up keyword ability
 * Rule 702.196 (MagicCompRules 20261106)
 *
 * Beam me up appears on some instants and sorceries. It represents two static
 * abilities: one that functions while the card is in a player's graveyard and
 * another that functions while the card is on the stack.
 *
 * "Beam me up [cost]" means "You may cast this card from your graveyard if the
 * resulting spell is an instant or sorcery spell by paying [cost] and returning
 * a creature you control to its owner's hand rather than paying its mana cost"
 * and "If the beam me up cost was paid, exile this card instead of putting it
 * anywhere else any time it would leave the stack."
 *
 * 702.196b: If a creature can't be beamed up, its controller can't return it to
 * its owner's hand to pay that portion of the beam me up cost.
 */

const CANT_BE_BEAMED_UP_RE = /can't be beamed up|can\u2019t be beamed up/i;
const ENCHANTED_CANT_BE_BEAMED_UP_RE =
  /enchanted (?:creature|permanent)[^.]*can't be beamed up|enchanted (?:creature|permanent)[^.]*can\u2019t be beamed up/i;

export interface BeamMeUpAbility {
  readonly type: 'beam_me_up';
  readonly cost: string;
  readonly source: string;
  readonly wasCastWithBeamMeUp: boolean;
}

/**
 * Creates a beam me up ability (Rule 702.196a).
 */
export function beamMeUp(source: string, cost: string): BeamMeUpAbility {
  return {
    type: 'beam_me_up',
    cost,
    source,
    wasCastWithBeamMeUp: false,
  };
}

/**
 * Parses the alternative cost from generic "Beam me up [cost]" oracle text.
 */
export function extractBeamMeUpCost(oracleText: string): string | null {
  const normalized = String(oracleText || '').replace(/\r?\n/g, ' ');
  const match = normalized.match(/\bbeam me up\s+([^.;]+)/i);
  if (!match) return null;
  const cost = String(match[1] || '').replace(/\s*\(.*$/, '').trim();
  return cost || null;
}

export function isInstantOrSorceryTypeLine(typeLine: string): boolean {
  const line = String(typeLine || '').toLowerCase();
  return /\binstant\b/.test(line) || /\bsorcery\b/.test(line);
}

/**
 * 702.196a: only from the graveyard, and only if the resulting spell is an instant or sorcery.
 */
export function canCastWithBeamMeUpFromZone(
  _ability: BeamMeUpAbility,
  zone: string,
  resultingSpellTypeLine: string,
): boolean {
  if (String(zone || '').trim().toLowerCase() !== 'graveyard') return false;
  return isInstantOrSorceryTypeLine(resultingSpellTypeLine);
}

export function castWithBeamMeUp(ability: BeamMeUpAbility): BeamMeUpAbility {
  return {
    ...ability,
    wasCastWithBeamMeUp: true,
  };
}

/**
 * 702.196a: if the beam me up cost was paid, exile the card whenever it would leave the stack.
 */
export function shouldExileAfterBeamMeUp(ability: BeamMeUpAbility): boolean {
  return ability.wasCastWithBeamMeUp;
}

/**
 * 702.196b: a creature that can't be beamed up (printed or granted, including auras)
 * cannot pay the bounce portion of the cost.
 */
export function canCreatureBeBeamedUp(
  creatureOracleText: string,
  auraOracleTexts: readonly string[] = [],
): boolean {
  if (CANT_BE_BEAMED_UP_RE.test(String(creatureOracleText || ''))) return false;
  return !auraOracleTexts.some((text) => ENCHANTED_CANT_BE_BEAMED_UP_RE.test(String(text || '')));
}
