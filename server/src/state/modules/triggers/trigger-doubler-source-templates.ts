/**
 * Origin: server/src/state/modules/triggers/trigger-doublers.ts
 * Cluster: generic "If a triggered ability of a(n)/another <types> you control triggers" doublers
 * (Bifur, Melodic Rider: Dwarf + enduring story; Chief of the Wilds: another Wolf or battle).
 * Public: parseSourceTypeTemplateDoubler, controllerHasEnduringStory
 */

/** Card types that name a source's card type rather than a creature subtype. */
const SOURCE_CARD_TYPES = new Set(['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker', 'permanent']);

export interface SourceTypeTemplateDoubler {
  sourceCreatureTypes?: string[];
  sourceCardTypes?: string[];
  sourceAnyCreatureOnly?: boolean;
  affectsOthersOnly?: boolean;
  requiresEnduringStory?: boolean;
}

/**
 * Parses "[As long as you have an enduring story, ]if a triggered ability of a/an/another <T> [or <T>] you
 * control triggers": each word is a card type (battle, artifact, ...) or else a creature type (Dwarf, Wolf).
 */
export function parseSourceTypeTemplateDoubler(patternOracle: string): SourceTypeTemplateDoubler | null {
  const match = /(?:^|[.\n]\s*)(as long as you have an enduring story,\s*)?if a triggered ability of (a|an|another) ([a-z' -]+?)(?: creatures?)? you control triggers/i
    .exec(String(patternOracle || ''));
  if (!match) return null;
  const words = match[3].toLowerCase().split(/\s*(?:,|\bor\b|\band\/or\b)\s*/).map((w) => w.trim()).filter(Boolean);
  if (words.length === 0 || words.some((w) => !/^[a-z'-]+$/.test(w))) return null;
  const cardTypes = words.filter((w) => SOURCE_CARD_TYPES.has(w) && w !== 'permanent');
  const creatureTypes = words.filter((w) => !SOURCE_CARD_TYPES.has(w));
  const result: SourceTypeTemplateDoubler = {};
  if (creatureTypes.length > 0) result.sourceCreatureTypes = creatureTypes;
  if (cardTypes.length === 1 && cardTypes[0] === 'creature' && creatureTypes.length === 0) result.sourceAnyCreatureOnly = true;
  else if (cardTypes.length > 0) result.sourceCardTypes = cardTypes;
  if (match[2].toLowerCase() === 'another') result.affectsOthersOnly = true;
  if (match[1]) result.requiresEnduringStory = true;
  return result;
}

/** Storied: three or more artifacts, legendaries and/or Sagas (each permanent counts once), kept for the game. */
export function controllerHasEnduringStory(gameState: any, battlefield: any[], controllerId: string): boolean {
  const pid = String(controllerId || '');
  if (gameState?.enduringStory?.[pid]) return true;
  const historic = (Array.isArray(battlefield) ? battlefield : []).filter((p: any) => {
    if (!p || String(p.controller || '') !== pid) return false;
    const typeLine = String(p.card?.type_line || '').toLowerCase();
    return typeLine.includes('artifact') || typeLine.includes('legendary') || typeLine.includes('saga');
  });
  return historic.length >= 3;
}