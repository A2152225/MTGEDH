/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: private this-turn / count helpers (WORD_NUMBERS, parseCountToken, battlefield counts,
 * this-turn spell/life/land/ETB/died counters, isPermanentCard)
 * Public: parseCountToken, countControlledPermanents, countBasicLands, countLandsWithSubtype,
 * countByPermanentType, didPlayerAttackThisTurn, getCreaturesAttackedThisTurnCount,
 * getSpellsCastThisTurnCount, getSpellsCastFromHandThisTurnCount, getNoncreatureSpellsCastThisTurnCount,
 * getCardsDrawnThisTurn, getExplicitColorSetFromObject, getLifeGainedThisTurn, getLifeLostThisTurn,
 * getStartingLifeTotal, getPlayerLifeMaybe, getLibraryCountMaybe, getLandsEnteredBattlefieldThisTurn,
 * getArtifactsEnteredBattlefieldThisTurn, getEnchantmentsEnteredBattlefieldThisTurn,
 * getPlaneswalkersEnteredBattlefieldThisTurn, getBattlesEnteredBattlefieldThisTurn,
 * getNonlandPermanentsEnteredBattlefieldThisTurn, getCreaturesEnteredBattlefieldThisTurn,
 * getCreaturesDiedThisTurnByController, getCreaturesDiedThisTurnTotal,
 * getCreatureSubtypeDiedThisTurnCount, getCreatureSubtypeDiedThisTurnSum,
 * getCreatureSubtypeEnteredThisTurnCount, getCreatureSubtypeEnteredThisTurnSum,
 * isLikelyCreatureSubtypeToken, getPoisonCounters, hasFullParty, hasLandsOfAllBasicTypes,
 * countCreatureCardsInGraveyard, isPermanentCard
 */

import type { GameContext } from "../context.js";
import { getEffectiveBasicLandTypes } from "../mana-abilities.js";

// OUT->IN copies of helpers that remain in intervening-if.ts (evaluator still uses them).
function normalizeText(text: string): string {
  return String(text || "")
    .replace(/[’]/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toLower(text: string): string {
  return normalizeText(text).toLowerCase();
}

function normalizeColorToken(token: string): string | null {
  const t = String(token || '').trim().toLowerCase();
  if (!t) return null;

  const symbolMap: Record<string, string> = {
    w: 'white',
    u: 'blue',
    b: 'black',
    r: 'red',
    g: 'green',
  };
  if (symbolMap[t]) return symbolMap[t];

  if (['white', 'blue', 'black', 'red', 'green'].includes(t)) return t;
  return null;
}

function getZones(ctx: GameContext): any {
  return (ctx as any).state?.zones || {};
}

function getGraveyard(ctx: GameContext, playerId: string): any[] {
  const zones = getZones(ctx);
  const z = zones?.[playerId];
  const gy = z?.graveyard;
  return Array.isArray(gy) ? gy : [];
}

function getControlledCreatures(ctx: GameContext, controllerId: string): any[] {
  const battlefield = (ctx as any).state?.battlefield || [];
  return (Array.isArray(battlefield) ? battlefield : []).filter((p: any) => {
    if (!p || p.controller !== controllerId) return false;
    const tl = String(p.card?.type_line || "").toLowerCase();
    return tl.includes("creature");
  });
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

function parseCountToken(token: string): number | null {
  const t = toLower(token);
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return WORD_NUMBERS[t] ?? null;
}

function countControlledPermanents(
  ctx: GameContext,
  controllerId: string,
  predicate: (typeLineLower: string) => boolean
): number {
  const battlefield = (ctx as any).state?.battlefield || [];
  let count = 0;
  for (const perm of battlefield) {
    if (!perm || perm.controller !== controllerId) continue;
    const tl = String(perm.card?.type_line || "").toLowerCase();
    if (predicate(tl)) count++;
  }
  return count;
}

function countBasicLands(ctx: GameContext, controllerId: string): number {
  return countControlledPermanents(ctx, controllerId, (tl) => tl.includes("basic") && tl.includes("land"));
}

function countLandsWithSubtype(ctx: GameContext, controllerId: string, subtypeLower: string): number {
  const normalizedSubtype = String(subtypeLower || '').toLowerCase();
  if (['plains', 'island', 'swamp', 'mountain', 'forest'].includes(normalizedSubtype)) {
    const battlefield = (ctx as any).state?.battlefield || [];
    let count = 0;
    for (const perm of battlefield) {
      if (!perm || perm.controller !== controllerId) continue;
      const tl = String(perm.card?.type_line || '').toLowerCase();
      if (!tl.includes('land')) continue;
      if (getEffectiveBasicLandTypes((ctx as any).state, perm).includes(normalizedSubtype as any)) {
        count++;
      }
    }
    return count;
  }
  return countControlledPermanents(ctx, controllerId, (tl) => tl.includes("land") && tl.includes(subtypeLower));
}

function countByPermanentType(ctx: GameContext, controllerId: string, typeLower: string): number {
  return countControlledPermanents(ctx, controllerId, (tl) => tl.includes(typeLower));
}

function didPlayerAttackThisTurn(ctx: GameContext, playerId: string): boolean {
  const battlefield = (ctx as any).state?.battlefield || [];
  return battlefield.some((p: any) => p && p.controller === playerId && p.attackedThisTurn);
}

function getCreaturesAttackedThisTurnCount(ctx: GameContext, playerId: string): number {
  const tracked = (ctx as any).state?.creaturesAttackedThisTurn;
  const v = tracked?.[playerId];
  if (typeof v === "number") return v;

  const battlefield = (ctx as any).state?.battlefield || [];
  return battlefield.filter((p: any) => p && p.controller === playerId && p.attackedThisTurn).length;
}

function getSpellsCastThisTurnCount(ctx: GameContext): number {
  const spells = (ctx as any).state?.spellsCastThisTurn;
  if (Array.isArray(spells)) return spells.length;
  return 0;
}

function getSpellsCastFromHandThisTurnCount(ctx: GameContext, playerId: string): number {
  const map = (ctx as any).state?.spellsCastFromHandThisTurn;
  const v = map?.[playerId];
  return typeof v === "number" ? v : 0;
}

function getNoncreatureSpellsCastThisTurnCount(ctx: GameContext, playerId: string): number {
  const map = (ctx as any).state?.noncreatureSpellsCastThisTurn;
  const v = map?.[playerId];
  return typeof v === "number" ? v : 0;
}

function getCardsDrawnThisTurn(ctx: GameContext, playerId: string): number {
  const map = (ctx as any).state?.cardsDrawnThisTurn;
  const v = map?.[playerId];
  return typeof v === 'number' ? v : 0;
}

function getExplicitColorSetFromObject(obj: any): Set<string> | null {
  if (!obj) return null;

  const colors =
    (obj as any)?.colors ??
    (obj as any)?.color_identity ??
    (obj as any)?.card?.colors ??
    (obj as any)?.card?.color_identity;

  if (Array.isArray(colors)) {
    const set = new Set<string>();
    for (const color of colors) {
      const normalized = normalizeColorToken(String(color ?? ''));
      if (normalized) set.add(normalized);
    }
    return set;
  }

  const color = (obj as any)?.color ?? (obj as any)?.card?.color;
  if (typeof color === 'string' && color.trim()) {
    const normalized = normalizeColorToken(color);
    return normalized ? new Set<string>([normalized]) : new Set<string>();
  }

  return null;
}

function getLifeGainedThisTurn(ctx: GameContext, playerId: string): number {
  const map = (ctx as any).state?.lifeGainedThisTurn;
  const v = map?.[playerId];
  return typeof v === 'number' ? v : 0;
}

function getLifeLostThisTurn(ctx: GameContext, playerId: string): number {
  const map = (ctx as any).state?.lifeLostThisTurn;
  const v = map?.[playerId];
  return typeof v === 'number' ? v : 0;
}

function getLandsPlayedThisTurn(ctx: GameContext, playerId: string): number {
  const map = (ctx as any).state?.landsPlayedThisTurn;
  const v = map && typeof map === 'object' ? (map as any)[playerId] : undefined;
  return typeof v === 'number' ? v : 0;
}

function getStartingLifeTotal(ctx: GameContext): number {
  const v = (ctx as any).state?.startingLife;
  return typeof v === 'number' ? v : 40;
}

function getPlayerLifeMaybe(ctx: GameContext, playerId: string): number | null {
  const life = (ctx as any).state?.life || (ctx as any).life;
  if (life && typeof life === 'object' && typeof (life as any)[playerId] === 'number') return (life as any)[playerId];
  const players = Array.isArray((ctx as any).state?.players) ? (ctx as any).state.players : [];
  const p = players.find((pp: any) => String(pp?.id || '') === String(playerId));
  if (p && typeof p.life === 'number') return p.life;
  return null;
}

function getLibraryCountMaybe(ctx: GameContext, playerId: string): number | null {
  const zones = (ctx as any).state?.zones || {};
  const z = zones?.[playerId];
  if (typeof z?.libraryCount === 'number') return z.libraryCount;
  const lib = (ctx as any).libraries?.get?.(playerId);
  if (Array.isArray(lib)) return lib.length;
  return null;
}

function getLandsEnteredBattlefieldThisTurn(ctx: GameContext, playerId: string): number {
  const map = (ctx as any).state?.landsEnteredBattlefieldThisTurn;
  const v = map && typeof map === 'object' ? (map as any)?.[playerId] : undefined;
  return typeof v === 'number' ? v : 0;
}

function getArtifactsEnteredBattlefieldThisTurn(ctx: GameContext, playerId: string): number {
  const map = (ctx as any).state?.artifactsEnteredBattlefieldThisTurnByController;
  const v = map && typeof map === 'object' ? (map as any)[playerId] : undefined;
  return typeof v === 'number' ? v : 0;
}

function getEnchantmentsEnteredBattlefieldThisTurn(ctx: GameContext, playerId: string): number {
  const map = (ctx as any).state?.enchantmentsEnteredBattlefieldThisTurnByController;
  const v = map && typeof map === 'object' ? (map as any)[playerId] : undefined;
  return typeof v === 'number' ? v : 0;
}

function getPlaneswalkersEnteredBattlefieldThisTurn(ctx: GameContext, playerId: string): number {
  const map = (ctx as any).state?.planeswalkersEnteredBattlefieldThisTurnByController;
  const v = map && typeof map === 'object' ? (map as any)[playerId] : undefined;
  return typeof v === 'number' ? v : 0;
}

function getBattlesEnteredBattlefieldThisTurn(ctx: GameContext, playerId: string): number {
  const map = (ctx as any).state?.battlesEnteredBattlefieldThisTurnByController;
  const v = map && typeof map === 'object' ? (map as any)[playerId] : undefined;
  return typeof v === 'number' ? v : 0;
}

function getNonlandPermanentsEnteredBattlefieldThisTurn(ctx: GameContext, playerId: string): number {
  const map = (ctx as any).state?.nonlandPermanentsEnteredBattlefieldThisTurn;
  const v = map && typeof map === 'object' ? (map as any)[playerId] : undefined;
  return typeof v === 'number' ? v : 0;
}

function getCreaturesEnteredBattlefieldThisTurn(ctx: GameContext, playerId: string): number {
  const map = (ctx as any).state?.creaturesEnteredBattlefieldThisTurnByController;
  const v = map && typeof map === 'object' ? (map as any)[playerId] : undefined;
  return typeof v === 'number' ? v : 0;
}

function getCreaturesDiedThisTurnByController(ctx: GameContext, playerId: string): number {
  const map = (ctx as any).state?.creaturesDiedThisTurnByController;
  const v = map && typeof map === 'object' ? (map as any)[playerId] : undefined;
  return typeof v === 'number' ? v : 0;
}

function getCreaturesDiedThisTurnTotal(ctx: GameContext): number {
  const map = (ctx as any).state?.creaturesDiedThisTurnByController;
  if (!map || typeof map !== 'object') return 0;
  return (Object.values(map as any) as any[]).reduce((sum: number, v: any) => sum + (typeof v === 'number' ? v : 0), 0);
}

function getCreatureSubtypeDiedThisTurnCount(ctx: GameContext, controllerId: string, subtypeLower: string): number {
  const map = (ctx as any).state?.creaturesDiedThisTurnByControllerSubtype;
  if (!map || typeof map !== 'object') return 0;
  const byController = (map as any)[String(controllerId)];
  if (!byController || typeof byController !== 'object') return 0;
  const v = (byController as any)[String(subtypeLower)];
  return typeof v === 'number' ? v : 0;
}

function getCreatureSubtypeDiedThisTurnSum(ctx: GameContext, controllerIds: string[], subtypeLower: string): number {
  const map = (ctx as any).state?.creaturesDiedThisTurnByControllerSubtype;
  if (!map || typeof map !== 'object') return 0;
  let total = 0;
  for (const id of controllerIds) {
    const byController = (map as any)[String(id)];
    if (!byController || typeof byController !== 'object') continue;
    const v = (byController as any)[String(subtypeLower)];
    if (typeof v === 'number') total += v;
  }
  return total;
}

function getCreatureSubtypeEnteredThisTurnCount(ctx: GameContext, controllerId: string, subtypeLower: string): number {
  const map = (ctx as any).state?.creaturesEnteredBattlefieldThisTurnByControllerSubtype;
  if (!map || typeof map !== 'object') return 0;
  const byController = (map as any)[String(controllerId)];
  if (!byController || typeof byController !== 'object') return 0;
  const v = (byController as any)[String(subtypeLower)];
  return typeof v === 'number' ? v : 0;
}

function getCreatureSubtypeEnteredThisTurnSum(ctx: GameContext, controllerIds: string[], subtypeLower: string): number {
  const map = (ctx as any).state?.creaturesEnteredBattlefieldThisTurnByControllerSubtype;
  if (!map || typeof map !== 'object') return 0;
  let total = 0;
  for (const id of controllerIds) {
    const byController = (map as any)[String(id)];
    if (!byController || typeof byController !== 'object') continue;
    const v = (byController as any)[String(subtypeLower)];
    if (typeof v === 'number') total += v;
  }
  return total;
}

function isLikelyCreatureSubtypeToken(tokenLower: string): boolean {
  const t = String(tokenLower || '').toLowerCase();
  if (!t) return false;
  // Avoid matching card types/supertypes that could appear in strange or future templates.
  // If we matched these and returned 0, we'd risk false negatives.
  const forbidden = new Set([
    'creature',
    'artifact',
    'enchantment',
    'land',
    'planeswalker',
    'instant',
    'sorcery',
    'battle',
    'legendary',
    'basic',
    'snow',
    'permanent',
    'card',
    'token',
  ]);
  return !forbidden.has(t);
}

function getPoisonCounters(ctx: GameContext, playerId: string): number {
  const state: any = (ctx as any).state || {};
  const direct = state?.poisonCounters?.[playerId];
  if (typeof direct === 'number') return direct;

  const ctxPoison = (ctx as any)?.poison?.[playerId];
  if (typeof ctxPoison === 'number') return ctxPoison;

  const players = Array.isArray(state.players) ? state.players : [];
  const p = players.find((pp: any) => String(pp?.id || '') === playerId);
  const fromPlayer = p?.poisonCounters;
  return typeof fromPlayer === 'number' ? fromPlayer : 0;
}

function countControlledCreaturesWithSubtype(ctx: GameContext, controllerId: string, subtypeLower: string): number {
  const creatures = getControlledCreatures(ctx, controllerId);
  const re = new RegExp(`\\b${subtypeLower.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i');
  return creatures.filter((c: any) => re.test(String(c?.card?.type_line || ''))).length;
}

function hasFullParty(ctx: GameContext, controllerId: string): boolean {
  const roles = ['cleric', 'rogue', 'warrior', 'wizard'];
  return roles.every((r) => countControlledCreaturesWithSubtype(ctx, controllerId, r) > 0);
}

function hasLandsOfAllBasicTypes(ctx: GameContext, controllerId: string): boolean {
  const basics = ['plains', 'island', 'swamp', 'mountain', 'forest'];
  return basics.every((b) => countLandsWithSubtype(ctx, controllerId, b) > 0);
}

function countCreatureCardsInGraveyard(ctx: GameContext, playerId: string): number {
  return getGraveyard(ctx, playerId).filter((c: any) => String(c?.type_line || '').toLowerCase().includes('creature')).length;
}

function isPermanentCard(card: any): boolean {
  const tl = String(card?.type_line || '').toLowerCase();
  if (!tl) return false;
  // Permanent cards are everything except instants/sorceries.
  return !tl.includes('instant') && !tl.includes('sorcery');
}


export {
  parseCountToken,
  countControlledPermanents,
  countBasicLands,
  countLandsWithSubtype,
  countByPermanentType,
  didPlayerAttackThisTurn,
  getCreaturesAttackedThisTurnCount,
  getSpellsCastThisTurnCount,
  getSpellsCastFromHandThisTurnCount,
  getNoncreatureSpellsCastThisTurnCount,
  getCardsDrawnThisTurn,
  getExplicitColorSetFromObject,
  getLifeGainedThisTurn,
  getLifeLostThisTurn,
  getStartingLifeTotal,
  getPlayerLifeMaybe,
  getLibraryCountMaybe,
  getLandsEnteredBattlefieldThisTurn,
  getArtifactsEnteredBattlefieldThisTurn,
  getEnchantmentsEnteredBattlefieldThisTurn,
  getPlaneswalkersEnteredBattlefieldThisTurn,
  getBattlesEnteredBattlefieldThisTurn,
  getNonlandPermanentsEnteredBattlefieldThisTurn,
  getCreaturesEnteredBattlefieldThisTurn,
  getCreaturesDiedThisTurnByController,
  getCreaturesDiedThisTurnTotal,
  getCreatureSubtypeDiedThisTurnCount,
  getCreatureSubtypeDiedThisTurnSum,
  getCreatureSubtypeEnteredThisTurnCount,
  getCreatureSubtypeEnteredThisTurnSum,
  isLikelyCreatureSubtypeToken,
  getPoisonCounters,
  hasFullParty,
  hasLandsOfAllBasicTypes,
  countCreatureCardsInGraveyard,
  isPermanentCard,
};
