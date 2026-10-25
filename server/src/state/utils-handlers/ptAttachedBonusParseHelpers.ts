// server/src/state/utils-handlers/ptAttachedBonusParseHelpers.ts
// Origin parent: server/src/state/utils.ts
// Cluster moved: attached P/T bonus count/parse helpers
//   (parseVariableAttachedPTBonus, resolveAttachedPTBonusFromOracle,
//   resolveSetBasePTFromAttachedAuras, Trepanation Blade pump predicates).
// Public entry symbols: resolveSetBasePTFromAttachedAuras,
//   isEquippedAttackRevealUntilLandPump, getEquippedAttackRevealPumpPowerPerCard,
//   shouldUseAttachedBonusNameTable, parseStaticAttachedPTBonusFromOracle,
//   resolveAttachedPTBonusFromOracle.
// Re-exported from utils.ts (public symbols) so "./utils.js" keeps working.

import { extractCreatureTypes } from './ptTypeLineCreatureTypes.js';

function countControlledPermanentsWithTypeIncludes(
  battlefield: any[],
  controllerId: string,
  typeSubstrings: string[],
): number {
  return battlefield.filter((perm) => {
    if (!perm || perm.controller !== controllerId) return false;
    const typeLine = String(perm.card?.type_line || '').toLowerCase();
    return typeSubstrings.some((substring) => typeLine.includes(substring));
  }).length;
}

function countActiveOpponents(gameState: any | undefined, controllerId: string): number {
  const players = gameState?.players || [];
  return players.filter((player: any) => player && player.id !== controllerId && !player.hasLost).length;
}

function countCreaturesSharingTypeWith(
  battlefield: any[],
  controllerId: string,
  creaturePerm: any,
  excludeEquippedCreature: boolean,
): number {
  const creatureTypes = extractCreatureTypes(creaturePerm.card?.type_line || '');
  if (creatureTypes.length === 0) return 0;

  let matchCount = 0;
  for (const perm of battlefield) {
    if (!perm?.card) continue;
    if (excludeEquippedCreature && perm.id === creaturePerm.id) continue;
    if (perm.controller !== controllerId) continue;
    const typeLine = String(perm.card.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    if (creatureTypes.some((creatureType) => typeLine.includes(creatureType.toLowerCase()))) {
      matchCount++;
    }
  }
  return matchCount;
}

function countUniqueColorsAmongControlledPermanents(battlefield: any[], controllerId: string): number {
  const colors = new Set<string>();
  for (const perm of battlefield) {
    if (!perm || perm.controller !== controllerId) continue;
    for (const color of perm.card?.colors || []) {
      colors.add(color);
    }
  }
  return colors.size;
}

function countAurasYouControlAttachedToCreatures(battlefield: any[], controllerId: string): number {
  return battlefield.filter((perm) => {
    if (!perm || perm.controller !== controllerId) return false;
    const typeLine = String(perm.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('enchantment')) return false;
    const attachedToId = String(perm.attachedTo || '').trim();
    if (!attachedToId) return false;
    const host = battlefield.find((candidate) => candidate?.id === attachedToId);
    if (!host?.card) return false;
    return String(host.card.type_line || '').toLowerCase().includes('creature');
  }).length;
}

function countCardsInGraveyardsMatching(
  gameState: any | undefined,
  predicate: (card: any) => boolean,
  scope: 'all' | 'controller',
  controllerId: string,
): number {
  if (!gameState) return 0;
  const zones = gameState.zones || {};
  const playerIds = scope === 'all'
    ? (gameState.players || []).map((player: any) => player?.id).filter(Boolean)
    : [controllerId];
  let count = 0;
  for (const playerId of playerIds) {
    const graveyard = zones[playerId]?.graveyard || [];
    for (const card of graveyard) {
      if (predicate(card)) count++;
    }
  }
  return count;
}

function cardTypeLineIncludes(card: any, substring: string): boolean {
  return String(card?.type_line || card?.typeLine || '').toLowerCase().includes(substring);
}

/**
 * Parse variable +X/+Y equipment/aura bonuses from oracle text (e.g. "for each land you control").
 * Returns null when the text does not match a supported variable pattern.
 */
function parseVariableAttachedPTBonus(
  oracleText: string,
  controllerId: string,
  battlefield: any[],
  gameState: any | undefined,
  attachedPerm: any,
  equippedCreature: any,
): { power: number; toughness: number } | null {
  const text = String(oracleText || '').toLowerCase();
  const parsePair = (powerText: string, toughnessText?: string) => ({
    powerPer: parseInt(powerText, 10),
    toughnessPer: toughnessText === undefined ? 0 : parseInt(toughnessText, 10),
  });

  let match = text.match(
    /(?:equipped|enchanted) creature gets \+(\d+)\/\+(\d+) for each artifact and enchantment you control/,
  );
  if (match) {
    const { powerPer, toughnessPer } = parsePair(match[1], match[2]);
    const count = countControlledPermanentsWithTypeIncludes(battlefield, controllerId, ['artifact', 'enchantment']);
    return { power: powerPer * count, toughness: toughnessPer * count };
  }

  match = text.match(/equipped creature gets \+(\d+)\/\+0 for each artifact you control/);
  if (match) {
    const { powerPer } = parsePair(match[1]);
    const count = countControlledPermanentsWithTypeIncludes(battlefield, controllerId, ['artifact']);
    return { power: powerPer * count, toughness: 0 };
  }

  match = text.match(/equipped creature gets \+(\d+)\/\+(\d+) for each land you control/);
  if (match) {
    const { powerPer, toughnessPer } = parsePair(match[1], match[2]);
    const count = countControlledPermanentsWithTypeIncludes(battlefield, controllerId, ['land']);
    return { power: powerPer * count, toughness: toughnessPer * count };
  }

  match = text.match(/enchanted creature gets \+(\d+)\/\+(\d+) for each aura you control attached to a creature/);
  if (match) {
    const { powerPer, toughnessPer } = parsePair(match[1], match[2]);
    const count = countAurasYouControlAttachedToCreatures(battlefield, controllerId);
    return { power: powerPer * count, toughness: toughnessPer * count };
  }

  match = text.match(/enchanted creature gets \+(\d+)\/\+(\d+) for each enchantment you control/);
  if (match) {
    const { powerPer, toughnessPer } = parsePair(match[1], match[2]);
    const count = countControlledPermanentsWithTypeIncludes(battlefield, controllerId, ['enchantment']);
    return { power: powerPer * count, toughness: toughnessPer * count };
  }

  match = text.match(/enchanted creature gets \+(\d+)\/\+(\d+) for each other enchantment on the battlefield/);
  if (match) {
    const { powerPer, toughnessPer } = parsePair(match[1], match[2]);
    const count = battlefield.filter((perm) => {
      if (!perm || perm.id === attachedPerm?.id) return false;
      return String(perm.card?.type_line || '').toLowerCase().includes('enchantment');
    }).length;
    return { power: powerPer * count, toughness: toughnessPer * count };
  }

  match = text.match(/equipped creature gets \+(\d+)\/\+0 for each opponent(?: you have)?/);
  if (match) {
    const { powerPer } = parsePair(match[1]);
    const count = countActiveOpponents(gameState, controllerId);
    return { power: powerPer * count, toughness: 0 };
  }

  match = text.match(
    /equipped creature gets \+(\d+)\/\+(\d+) for each creature(?: you control)?(?: on the battlefield)? that shares a creature type with equipped creature/,
  );
  if (match) {
    const { powerPer, toughnessPer } = parsePair(match[1], match[2]);
    const count = countCreaturesSharingTypeWith(battlefield, controllerId, equippedCreature, true);
    return { power: powerPer * count, toughness: toughnessPer * count };
  }

  match = text.match(/equipped creature gets \+(\d+)\/\+(\d+) for each color among permanents you control/);
  if (match) {
    const { powerPer, toughnessPer } = parsePair(match[1], match[2]);
    const count = countUniqueColorsAmongControlledPermanents(battlefield, controllerId);
    return { power: powerPer * count, toughness: toughnessPer * count };
  }

  match = text.match(
    /equipped creature gets \+x\/\+x, where x is the number of creature cards in all graveyards/,
  );
  if (match) {
    const count = countCardsInGraveyardsMatching(
      gameState,
      (card) => cardTypeLineIncludes(card, 'creature'),
      'all',
      controllerId,
    );
    return { power: count, toughness: count };
  }

  match = text.match(
    /gets \+x\/\+0, where x is the number of instant and sorcery cards in your graveyard/,
  );
  if (match) {
    const count = countCardsInGraveyardsMatching(
      gameState,
      (card) => cardTypeLineIncludes(card, 'instant') || cardTypeLineIncludes(card, 'sorcery'),
      'controller',
      controllerId,
    );
    return { power: count, toughness: 0 };
  }

  match = text.match(
    /(?:equipped|enchanted) creature gets \+(\d+)\/\+(\d+) for each \+1\/\+1 counter on it/,
  );
  if (match) {
    const { powerPer, toughnessPer } = parsePair(match[1], match[2]);
    const count = countPlusOneCountersOnPermanent(equippedCreature);
    return { power: powerPer * count, toughness: toughnessPer * count };
  }

  return null;
}

function countPlusOneCountersOnPermanent(perm: any): number {
  const counters = perm?.counters || {};
  return (
    counters['+1/+1'] ||
    counters['plus_one'] ||
    counters['plusOne'] ||
    counters['p1p1'] ||
    0
  );
}

/**
 * Parse layer-7b "set base P/T" lines from attached aura oracle text (Frogify, Lignify, etc.).
 */
function parseSetBasePTFromAttachedAuraOracle(
  oracleText: string,
): { power: number; toughness: number } | null {
  const text = String(oracleText || '').toLowerCase();

  let match = text.match(
    /enchanted (?:creature|artifact|permanent|land) (?:[^.\n]*? )?(?:has|with) base power and toughness (\d+)\/(\d+)/i,
  );
  if (match) {
    return { power: parseInt(match[1], 10), toughness: parseInt(match[2], 10) };
  }

  match = text.match(
    /enchanted (?:creature|artifact|permanent|land) is an? [^.]+ with base power and toughness (\d+)\/(\d+)/i,
  );
  if (match) {
    return { power: parseInt(match[1], 10), toughness: parseInt(match[2], 10) };
  }

  // Zendikon-style animation: "Enchanted land is a 5/3 green Elemental creature. It's still a land."
  match = text.match(/enchanted (?:artifact|land) is an? (\d+)\/(\d+) [a-z ]*?creature\b[^.]*\.\s*it(?:'|\u2019)s still an? (?:artifact|land)\b/i);
  if (match) {
    return { power: parseInt(match[1], 10), toughness: parseInt(match[2], 10) };
  }

  return null;
}

/**
 * Resolve characteristic-setting base P/T from auras attached to a creature.
 * When multiple auras set base P/T, the last attached aura in battlefield order wins (timestamp simplification).
 */
export function resolveSetBasePTFromAttachedAuras(
  creaturePerm: any,
  battlefield: any[],
): { power: number; toughness: number } | null {
  if (!creaturePerm || !Array.isArray(battlefield)) return null;

  let result: { power: number; toughness: number } | null = null;

  for (const perm of battlefield) {
    if (!perm?.card) continue;

    const typeLine = String(perm.card.type_line || '').toLowerCase();
    if (!typeLine.includes('aura') || !typeLine.includes('enchantment')) continue;

    const isAttached =
      perm.attachedTo === creaturePerm.id ||
      (creaturePerm.attachedEquipment && creaturePerm.attachedEquipment.includes(perm.id));
    if (!isAttached) continue;

    const setBase = parseSetBasePTFromAttachedAuraOracle(perm.card.oracle_text || '');
    if (setBase) result = setBase;
  }

  return result;
}

export function shouldUseAttachedBonusNameTable(oracleText: string): boolean {
  return String(oracleText || '').trim().length === 0;
}

/**
 * Attack-triggered equipment pump stored on the permanent (e.g. Trepanation Blade reveal count).
 */
export function isEquippedAttackRevealUntilLandPump(oracleText: string): boolean {
  const text = String(oracleText || '').toLowerCase();
  return text.includes('whenever equipped creature attacks')
    && text.includes('until they reveal a land card')
    && text.includes('for each card revealed this way');
}

export function getEquippedAttackRevealPumpPowerPerCard(oracleText: string): number {
  const text = String(oracleText || '').toLowerCase();
  const match = text.match(/gets \+(\d+)\/\+0(?: until end of turn)? for each card revealed this way/);
  return match ? parseInt(match[1], 10) : 1;
}

function parseStoredRevealAttachedPTBonus(
  oracleText: string,
  attachedPerm: any,
): { power: number; toughness: number } | null {
  const text = String(oracleText || '').toLowerCase();
  if (!text.includes('for each card revealed this way')) return null;
  const storedBonus = attachedPerm.trepanationBonus || attachedPerm.lastTrepanationBonus || 0;
  if (storedBonus <= 0) return null;
  return { power: storedBonus, toughness: 0 };
}

/**
 * Compound static equipment bonuses with type-conditional riders (e.g. Tenza, Godo's Maul).
 */
function parseCompoundAttachedPTBonus(
  oracleText: string,
  equippedCreature: any,
): { power: number; toughness: number } | null {
  const text = String(oracleText || '').toLowerCase();
  const baseMatch = text.match(/equipped creature gets \+(\d+)\/\+(\d+)\./);
  const legendaryExtra = text.match(/as long as it's legendary, it gets an additional \+(\d+)\/\+(\d+)/);
  if (!baseMatch || !legendaryExtra) return null;

  let power = parseInt(baseMatch[1], 10);
  let toughness = parseInt(baseMatch[2], 10);
  const typeLine = String(equippedCreature?.card?.type_line || '').toLowerCase();
  if (typeLine.includes('legendary')) {
    power += parseInt(legendaryExtra[1], 10);
    toughness += parseInt(legendaryExtra[2], 10);
  }
  return { power, toughness };
}

export function parseStaticAttachedPTBonusFromOracle(
  oracleText: string,
): { power: number; toughness: number } | null {
  // Unconditional statics only: "as long as" (Black Scarab), triggered and until-end-of-turn sentences
  // belong to the conditional spec reader / trigger pipeline.
  const text = String(oracleText || '').toLowerCase().split(/\n+|(?<=\.)\s+/)
    .filter((s) => !/as long as|until end of turn|^\s*(?:when|whenever|at the beginning|if)\b/.test(s))
    .join('\n');

  let match = text.match(/equipped creature gets? \+(\d+)\/\+(\d+)(?! for each)/i);
  if (match) {
    return { power: parseInt(match[1], 10), toughness: parseInt(match[2], 10) };
  }

  match = text.match(/equipped creature gets? \+(\d+)\/\+0(?! for each)/i);
  if (match) {
    return { power: parseInt(match[1], 10), toughness: 0 };
  }

  match = text.match(/equipped creature gets? \+(\d+)\/(-\d+)/i);
  if (match) {
    return { power: parseInt(match[1], 10), toughness: parseInt(match[2], 10) };
  }

  match = text.match(/enchanted creature gets? \+(\d+)\/\+(\d+)(?! for each)/i);
  if (match) {
    return { power: parseInt(match[1], 10), toughness: parseInt(match[2], 10) };
  }

  match = text.match(/enchanted creature gets? \+(\d+)\/\+0(?! for each)/i);
  if (match) {
    return { power: parseInt(match[1], 10), toughness: 0 };
  }

  return null;
}

export function resolveAttachedPTBonusFromOracle(
  oracleText: string,
  controllerId: string,
  battlefield: any[],
  gameState: any | undefined,
  attachedPerm: any,
  equippedCreature: any,
): { power: number; toughness: number } | null {
  return (
    parseVariableAttachedPTBonus(
      oracleText,
      controllerId,
      battlefield,
      gameState,
      attachedPerm,
      equippedCreature,
    )
    ?? parseStoredRevealAttachedPTBonus(oracleText, attachedPerm)
    ?? parseCompoundAttachedPTBonus(oracleText, equippedCreature)
  );
}
