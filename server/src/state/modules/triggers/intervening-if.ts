import type { GameContext } from "../context.js";
import { detectLinkedExileEffect } from "./linked-exile.js";
import { calculateAllPTBonuses } from "../../utils.js";

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

function getLandsPlayedThisTurn(ctx: GameContext, playerId: string): number | null {
  const map = (ctx as any).state?.landsPlayedThisTurn;
  if (!map || typeof map !== 'object') return null;
  const v = (map as any)[playerId];
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
  const v = map?.[playerId];
  return typeof v === 'number' ? v : 0;
}

function getArtifactsEnteredBattlefieldThisTurn(ctx: GameContext, playerId: string): number | null {
  const map = (ctx as any).state?.artifactsEnteredBattlefieldThisTurnByController;
  if (!map || typeof map !== 'object') return null;
  const v = (map as any)[playerId];
  return typeof v === 'number' ? v : 0;
}

function getPlaneswalkersEnteredBattlefieldThisTurn(ctx: GameContext, playerId: string): number | null {
  const map = (ctx as any).state?.planeswalkersEnteredBattlefieldThisTurnByController;
  if (!map || typeof map !== 'object') return null;
  const v = (map as any)[playerId];
  return typeof v === 'number' ? v : 0;
}

function getCreaturesEnteredBattlefieldThisTurn(ctx: GameContext, playerId: string): number | null {
  const map = (ctx as any).state?.creaturesEnteredBattlefieldThisTurnByController;
  if (!map || typeof map !== 'object') return null;
  const v = (map as any)[playerId];
  return typeof v === 'number' ? v : 0;
}

function getCreaturesDiedThisTurnByController(ctx: GameContext, playerId: string): number | null {
  const map = (ctx as any).state?.creaturesDiedThisTurnByController;
  if (!map || typeof map !== 'object') return null;
  const v = (map as any)[playerId];
  return typeof v === 'number' ? v : 0;
}

function getCreaturesDiedThisTurnTotal(ctx: GameContext): number | null {
  const map = (ctx as any).state?.creaturesDiedThisTurnByController;
  if (!map || typeof map !== 'object') return null;
  return (Object.values(map as any) as any[]).reduce((sum: number, v: any) => sum + (typeof v === 'number' ? v : 0), 0);
}

function getCreatureSubtypeDiedThisTurnCount(ctx: GameContext, controllerId: string, subtypeLower: string): number | null {
  const map = (ctx as any).state?.creaturesDiedThisTurnByControllerSubtype;
  if (!map || typeof map !== 'object') return null;
  const byController = (map as any)[String(controllerId)];
  if (!byController || typeof byController !== 'object') return 0;
  const v = (byController as any)[String(subtypeLower)];
  return typeof v === 'number' ? v : 0;
}

function getCreatureSubtypeDiedThisTurnSum(ctx: GameContext, controllerIds: string[], subtypeLower: string): number | null {
  const map = (ctx as any).state?.creaturesDiedThisTurnByControllerSubtype;
  if (!map || typeof map !== 'object') return null;
  let total = 0;
  for (const id of controllerIds) {
    const byController = (map as any)[String(id)];
    if (!byController || typeof byController !== 'object') continue;
    const v = (byController as any)[String(subtypeLower)];
    if (typeof v === 'number') total += v;
  }
  return total;
}

function getCreatureSubtypeEnteredThisTurnCount(ctx: GameContext, controllerId: string, subtypeLower: string): number | null {
  const map = (ctx as any).state?.creaturesEnteredBattlefieldThisTurnByControllerSubtype;
  if (!map || typeof map !== 'object') return null;
  const byController = (map as any)[String(controllerId)];
  if (!byController || typeof byController !== 'object') return 0;
  const v = (byController as any)[String(subtypeLower)];
  return typeof v === 'number' ? v : 0;
}

function getCreatureSubtypeEnteredThisTurnSum(ctx: GameContext, controllerIds: string[], subtypeLower: string): number | null {
  const map = (ctx as any).state?.creaturesEnteredBattlefieldThisTurnByControllerSubtype;
  if (!map || typeof map !== 'object') return null;
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

  const playerStatus = state?.playerStatus?.[playerId]?.poison;
  if (typeof playerStatus === 'number') return playerStatus;

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

function countPermanentCardsInGraveyard(ctx: GameContext, playerId: string): number {
  return getGraveyard(ctx, playerId).filter((c: any) => isPermanentCard(c)).length;
}

function isPermanentModified(ctx: GameContext, perm: any): boolean {
  if (!perm) return false;
  const counters = perm?.counters;
  if (counters && typeof counters === 'object') {
    for (const v of Object.values(counters)) {
      if (typeof v === 'number' && v > 0) return true;
    }
  }
  if (isPermanentEquipped(ctx, perm)) return true;
  if (isPermanentEnchanted(ctx, perm)) return true;
  return false;
}

function getManaValue(cardOrPerm: any): number | null {
  const candidates = [cardOrPerm?.manaValue, cardOrPerm?.cmc, cardOrPerm?.card?.cmc, cardOrPerm?.card?.manaValue];
  for (const c of candidates) {
    const n = parseMaybeNumber(c);
    if (n !== null) return n;
  }
  return null;
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

function getManaColorsSpentFromSource(source: any): string[] | null {
  if (!source) return null;
  const v = source?.manaColorsSpent ?? source?.card?.manaColorsSpent ?? source?.manaSpentColors ?? source?.card?.manaSpentColors;
  if (!Array.isArray(v)) return null;
  const out = v
    .map((x: any) => normalizeColorToken(String(x)))
    .filter((x: any) => typeof x === 'string' && x.length > 0);
  return out;
}

function getChosenColorFromSource(source: any): string | null {
  if (!source) return null;
  const v = source?.chosenColor ?? source?.card?.chosenColor;
  const c = normalizeColorToken(String(v || ''));
  return c;
}

function getDieRollResultsThisTurn(ctx: GameContext, playerId: string): Array<{ sides: number; result: number; timestamp?: number }> {
  const map = (ctx as any).state?.dieRollsThisTurn;
  const rolls = map?.[playerId];
  if (!Array.isArray(rolls) || rolls.length === 0) return [];

  const normalized: Array<{ sides: number; result: number; timestamp?: number }> = [];
  for (const r of rolls) {
    const sides = parseMaybeNumber((r as any)?.sides);
    const result = parseMaybeNumber((r as any)?.result);
    if (sides === null || result === null) continue;
    normalized.push({ sides, result, timestamp: (r as any)?.timestamp });
  }
  return normalized;
}

function isCastFromForetell(source: any): boolean | null {
  if (!source) return null;
  const v = source?.castFromForetell ?? source?.card?.castFromForetell ?? source?.foretold ?? source?.card?.foretold;
  if (typeof v === 'boolean') return v;
  return null;
}

function didCastDuringOwnMainPhase(source: any): boolean | null {
  if (!source) return null;
  const v = source?.castDuringOwnMainPhase ?? source?.card?.castDuringOwnMainPhase;
  if (typeof v === 'boolean') return v;
  return null;
}

function countControlledPermanentsBySubtype(ctx: GameContext, controllerId: string, subtypeLower: string): number {
  return countControlledPermanents(ctx, controllerId, (tl) => tl.includes(subtypeLower));
}

function didSourceDealDamageToOpponentThisTurn(ctx: GameContext, controllerId: string, sourcePermanentId: string): boolean | null {
  const opponents = getOpponentIds(ctx, controllerId);
  if (!opponents.length) return false;

  const tracker = (ctx as any).state?.creaturesThatDealtDamageToPlayer;
  if (tracker && typeof tracker === 'object') {
    return opponents.some((oppId) => {
      const entry = tracker?.[oppId];
      return !!(entry && typeof entry === 'object' && entry[sourcePermanentId]);
    });
  }

  return null;
}

function didSourceDealDamageToAnyPlayerThisTurn(ctx: GameContext, sourcePermanentId: string): boolean | null {
  const tracker = (ctx as any).state?.creaturesThatDealtDamageToPlayer;
  if (!tracker || typeof tracker !== 'object') return null;
  const sid = String(sourcePermanentId || '');
  if (!sid) return null;
  return Object.values(tracker).some((entry: any) => entry && typeof entry === 'object' && !!entry[sid]);
}

function getPlayerLife(ctx: GameContext, playerId: string): number {
  const life = (ctx as any).state?.life || (ctx as any).life || {};
  const v = life[playerId];
  return typeof v === "number" ? v : 40;
}

function getHandCount(ctx: GameContext, playerId: string): number {
  const zones = (ctx as any).state?.zones || {};
  const z = zones[playerId];
  const hc = z?.handCount;
  if (typeof hc === "number") return hc;
  const hand = z?.hand;
  if (Array.isArray(hand)) return hand.length;
  return 0;
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

function getGraveyardCount(ctx: GameContext, playerId: string): number {
  const zones = getZones(ctx);
  const z = zones?.[playerId];
  const gc = z?.graveyardCount;
  if (typeof gc === 'number') return gc;
  return getGraveyard(ctx, playerId).length;
}

function getLibraryCount(ctx: GameContext, playerId: string): number {
  const zones = getZones(ctx);
  const z = zones?.[playerId];
  if (typeof z?.libraryCount === "number") return z.libraryCount;
  const lib = (ctx as any).libraries?.get?.(playerId);
  if (Array.isArray(lib)) return lib.length;
  return 0;
}

function parseMaybeNumber(v: any): number | null {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function sumManaSpentTotal(source: any): number | null {
  if (!source) return null;
  const direct = parseMaybeNumber(source?.manaSpentTotal ?? source?.card?.manaSpentTotal);
  if (direct !== null) return direct;

  const breakdown = source?.manaSpentBreakdown ?? source?.card?.manaSpentBreakdown;
  if (!breakdown || typeof breakdown !== "object") return null;

  let total = 0;
  for (const v of Object.values(breakdown)) {
    const n = parseMaybeNumber(v);
    if (n === null) return null;
    total += n;
  }
  return total;
}

function hasAnyCounters(permOrCard: any): boolean | null {
  if (!permOrCard) return null;
  const counters = (permOrCard as any).counters ?? (permOrCard as any).card?.counters;
  if (!counters || typeof counters !== "object") return false;
  return Object.values(counters).some((v: any) => typeof v === "number" && v > 0);
}

function getCounterCount(permOrCard: any, counterKey: string): number | null {
  if (!permOrCard) return null;
  const counters = (permOrCard as any).counters ?? (permOrCard as any).card?.counters;
  if (!counters || typeof counters !== "object") return 0;
  const v = (counters as any)[counterKey];
  const n = parseMaybeNumber(v);
  return n ?? 0;
}

function sumAllCounters(permOrCard: any): number | null {
  if (!permOrCard) return null;
  const counters = (permOrCard as any).counters ?? (permOrCard as any).card?.counters;
  if (!counters || typeof counters !== 'object') return 0;
  let total = 0;
  for (const v of Object.values(counters)) {
    const n = parseMaybeNumber(v);
    if (n === null) continue;
    if (n > 0) total += n;
  }
  return total;
}

function escapeRegexLiteral(text: string): string {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getCommandZoneInfo(ctx: GameContext, playerId: string): any | null {
  const cz = (ctx as any).state?.commandZone ?? (ctx as any).commandZone;
  if (!cz || typeof cz !== 'object') return null;
  return (cz as any)[String(playerId)] ?? null;
}

function nameMatchesClauseName(actualNameLower: string, clauseNameLower: string): boolean {
  const actual = String(actualNameLower || '').toLowerCase();
  const clause = String(clauseNameLower || '').toLowerCase();
  if (!actual || !clause) return false;
  if (actual === clause) return true;

  // Many cards reference themselves by a shortened name in Oracle text (e.g., "Kalamax"),
  // while the card name is the full printed name (e.g., "Kalamax, the Stormsire").
  // Treat a leading full-word match as sufficient.
  if (!actual.startsWith(clause)) return false;
  const next = actual.slice(clause.length, clause.length + 1);
  return next === ',' || next === ' ';
}

function findBattlefieldPermanentsByName(ctx: GameContext, nameLower: string): any[] {
  const battlefield = (ctx as any).state?.battlefield;
  if (!Array.isArray(battlefield)) return [];
  const target = String(nameLower || '').toLowerCase();
  if (!target) return [];
  return battlefield.filter((p: any) => p && nameMatchesClauseName(toLower(p?.card?.name || p?.name || ''), target));
}

function getCounterCountCaseInsensitiveFromPerm(perm: any, counterNameLower: string): number | null {
  if (!perm) return null;
  const counters = (perm as any).counters;
  if (!counters || typeof counters !== 'object') return null;
  const keyLower = String(counterNameLower || '').toLowerCase();
  if (!keyLower) return null;

  for (const [k, v] of Object.entries(counters)) {
    if (String(k || '').toLowerCase() !== keyLower) continue;
    const n = parseMaybeNumber(v);
    return n ?? 0;
  }

  return 0;
}

function hasAnyCountersOnPermanent(perm: any): boolean | null {
  if (!perm) return null;
  const counters = (perm as any).counters;
  if (!counters || typeof counters !== 'object') return null;
  return Object.values(counters).some((v: any) => typeof v === 'number' && v > 0);
}

function typeLineHasWord(typeLine: string, word: string): boolean {
  const tl = String(typeLine || '').toLowerCase();
  const w = String(word || '').toLowerCase();
  if (!tl || !w) return false;
  return new RegExp(`\\b${escapeRegexLiteral(w)}\\b`, 'i').test(tl);
}

function countControlledCreatureSubtype(ctx: GameContext, controllerId: string, subtypeLower: string): number {
  const battlefield = (ctx as any).state?.battlefield || [];
  if (!Array.isArray(battlefield)) return 0;
  return battlefield.filter((p: any) => {
    if (!p) return false;
    if (String(p.controller || '') !== String(controllerId)) return false;
    const tl = String(p.card?.type_line || '').toLowerCase();
    if (!tl.includes('creature')) return false;
    return typeLineHasWord(tl, subtypeLower);
  }).length;
}

function isPrimeNumber(n: number): boolean {
  if (!Number.isFinite(n)) return false;
  if (n <= 1) return false;
  if (n <= 3) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

function findBattlefieldPermanent(ctx: GameContext, id: string): any | null {
  const battlefield = (ctx as any).state?.battlefield || [];
  if (!Array.isArray(battlefield)) return null;
  return battlefield.find((p: any) => p && String(p.id || '') === String(id || '')) || null;
}

function countControlledEnteredThisTurn(ctx: GameContext, controllerId: string, typeLower: string, excludeId?: string): number | null {
  // Deterministic tracking when available.
  if (typeLower === 'land') {
    // Land entries are tracked via a per-turn counter map.
    const n = getLandsEnteredBattlefieldThisTurn(ctx, controllerId);

    // For "another land" templates, exclude the source permanent if it is itself a land that entered this turn.
    if (excludeId) {
      const source = findBattlefieldPermanent(ctx, excludeId);
      if (source && String(source.controller || '') === String(controllerId)) {
        const tl = String(source.card?.type_line || '').toLowerCase();
        if (tl.includes('land') && source.enteredThisTurn === true) {
          return Math.max(0, n - 1);
        }
      }
    }

    return n;
  }
  if (typeLower === 'creature') {
    // Creature entries are tracked via a per-turn counter map.
    const n = getCreaturesEnteredBattlefieldThisTurn(ctx, controllerId);
    if (n === null) return null;

    // For "another creature" templates, exclude the source permanent if it is itself a creature that entered this turn.
    if (excludeId) {
      // Prefer deterministic id-tracking if available.
      const idsByController = (ctx as any).state?.creaturesEnteredBattlefieldThisTurnIdsByController;
      const key = String(controllerId);
      const idsForController = idsByController && typeof idsByController === 'object' ? idsByController[key] : null;
      if (idsForController && typeof idsForController === 'object') {
        if ((idsForController as any)[String(excludeId)] === true) {
          return Math.max(0, n - 1);
        }
        return n;
      }

      const source = findBattlefieldPermanent(ctx, excludeId);
      if (source && String(source.controller || '') === String(controllerId)) {
        const tl = String(source.card?.type_line || '').toLowerCase();
        if (tl.includes('creature') && source.enteredThisTurn === true) {
          return Math.max(0, n - 1);
        }
      }
    }

    return n;
  }

  if (typeLower === 'artifact') {
    const n = getArtifactsEnteredBattlefieldThisTurn(ctx, controllerId);
    if (n === null) return null;
    if (!excludeId) return n;
    if (n === 0) return 0;
    if (n >= 2) return 1;
    return null;
  }

  if (typeLower === 'planeswalker') {
    const n = getPlaneswalkersEnteredBattlefieldThisTurn(ctx, controllerId);
    if (n === null) return null;
    if (!excludeId) return n;
    if (n === 0) return 0;
    if (n >= 2) return 1;
    return null;
  }

  // Best-effort battlefield scan. If we have no evidence of entered-this-turn tracking,
  // return null to avoid false negatives that would suppress triggers.
  const battlefield = (ctx as any).state?.battlefield || [];
  if (!Array.isArray(battlefield)) return null;
  const hasEnteredTracking = battlefield.some((p: any) => p?.enteredThisTurn === true);
  if (!hasEnteredTracking) return null;

  return battlefield.filter((p: any) => {
    if (!p) return false;
    if (excludeId && String(p.id || '') === String(excludeId)) return false;
    if (String(p.controller || '') !== String(controllerId)) return false;
    if (p.enteredThisTurn !== true) return false;
    const tl = String(p.card?.type_line || '').toLowerCase();
    return tl.includes(typeLower);
  }).length;
}

function anyCreatureAttackedThisTurn(ctx: GameContext): boolean {
  const tracked = (ctx as any).state?.creaturesAttackedThisTurn;
  if (tracked && typeof tracked === 'object') {
    return Object.values(tracked).some((v: any) => typeof v === 'number' && v > 0);
  }
  const battlefield = (ctx as any).state?.battlefield || [];
  if (!Array.isArray(battlefield)) return false;
  return battlefield.some((p: any) => {
    if (!p) return false;
    const tl = String(p.card?.type_line || '').toLowerCase();
    if (!tl.includes('creature')) return false;
    return p.attackedThisTurn === true || !!p.attacking || p.isAttacking === true;
  });
}

function getPermanentPower(perm: any, ctx?: GameContext): number {
  const candidates = [perm?.effectivePower, perm?.power];
  for (const c of candidates) {
    const n = parseMaybeNumber(c);
    if (n !== null) return n;
  }

  const base = parseMaybeNumber(perm?.basePower) ?? parseMaybeNumber(perm?.card?.power) ?? 0;
  if (!ctx) return base;

  try {
    const bonus = calculateAllPTBonuses(perm, (ctx as any).state);
    if (bonus && typeof bonus.power === 'number') {
      return base + bonus.power;
    }
  } catch {
    // best-effort; fall back to base
  }

  return base;
}

function getPermanentPowerMaybe(perm: any, ctx?: GameContext): number | null {
  const candidates = [perm?.effectivePower, perm?.power];
  for (const c of candidates) {
    const n = parseMaybeNumber(c);
    if (n !== null) return n;
  }

  const baseRaw = parseMaybeNumber(perm?.basePower) ?? parseMaybeNumber(perm?.card?.power);
  if (baseRaw === null) return null;
  if (!ctx) return baseRaw;

  try {
    const bonus = calculateAllPTBonuses(perm, (ctx as any).state);
    if (bonus && typeof bonus.power === 'number') {
      return baseRaw + bonus.power;
    }
  } catch {
    // best-effort; fall back to base
  }

  return baseRaw;
}

function getPermanentToughness(perm: any, ctx?: GameContext): number {
  const candidates = [perm?.effectiveToughness, perm?.toughness];
  for (const c of candidates) {
    const n = parseMaybeNumber(c);
    if (n !== null) return n;
  }

  const base = parseMaybeNumber(perm?.baseToughness) ?? parseMaybeNumber(perm?.card?.toughness) ?? 0;
  if (!ctx) return base;

  try {
    const bonus = calculateAllPTBonuses(perm, (ctx as any).state);
    if (bonus && typeof bonus.toughness === 'number') {
      return base + bonus.toughness;
    }
  } catch {
    // best-effort; fall back to base
  }

  return base;
}

function getPermanentToughnessMaybe(perm: any, ctx?: GameContext): number | null {
  const candidates = [perm?.effectiveToughness, perm?.toughness];
  for (const c of candidates) {
    const n = parseMaybeNumber(c);
    if (n !== null) return n;
  }

  const baseRaw = parseMaybeNumber(perm?.baseToughness) ?? parseMaybeNumber(perm?.card?.toughness);
  if (baseRaw === null) return null;
  if (!ctx) return baseRaw;

  try {
    const bonus = calculateAllPTBonuses(perm, (ctx as any).state);
    if (bonus && typeof bonus.toughness === 'number') {
      return baseRaw + bonus.toughness;
    }
  } catch {
    // best-effort; fall back to base
  }

  return baseRaw;
}

function getControlledCreatures(ctx: GameContext, controllerId: string): any[] {
  const battlefield = (ctx as any).state?.battlefield || [];
  return (Array.isArray(battlefield) ? battlefield : []).filter((p: any) => {
    if (!p || p.controller !== controllerId) return false;
    const tl = String(p.card?.type_line || "").toLowerCase();
    return tl.includes("creature");
  });
}

function getAttackingCreatures(ctx: GameContext, controllerId: string): any[] {
  return getControlledCreatures(ctx, controllerId).filter((p: any) => !!p.attacking || p.isAttacking === true);
}

function getAttackingTotalPower(ctx: GameContext, controllerId: string): number {
  return getAttackingCreatures(ctx, controllerId).reduce((sum: number, p: any) => sum + getPermanentPower(p), 0);
}

function countCardTypesInGraveyard(ctx: GameContext, playerId: string): number {
  const types = new Set<string>();
  for (const c of getGraveyard(ctx, playerId)) {
    const tl = String(c?.type_line || "").toLowerCase();
    if (!tl) continue;
    if (tl.includes("artifact")) types.add("artifact");
    if (tl.includes("creature")) types.add("creature");
    if (tl.includes("enchantment")) types.add("enchantment");
    if (tl.includes("instant")) types.add("instant");
    if (tl.includes("sorcery")) types.add("sorcery");
    if (tl.includes("land")) types.add("land");
    if (tl.includes("planeswalker")) types.add("planeswalker");
    if (tl.includes("battle")) types.add("battle");
    if (tl.includes("tribal")) types.add("tribal");
  }
  return types.size;
}

function getSpellsCastThisTurn(ctx: GameContext): any[] {
  const spells = (ctx as any).state?.spellsCastThisTurn;
  return Array.isArray(spells) ? spells : [];
}

function getSpellColorsThisTurnEntry(spell: any): string[] | null {
  const raw =
    (spell as any)?.card?.colors ??
    (spell as any)?.colors ??
    (spell as any)?.card?.color_identity ??
    (spell as any)?.color_identity;
  if (!Array.isArray(raw)) return null;
  return raw
    .map((c: any) => String(c || '').trim().toUpperCase())
    .filter((c: string) => c.length > 0);
}

function getSpellsCastThisTurnByPlayerCount(ctx: GameContext, playerId: string): number {
  return getSpellsCastThisTurn(ctx).filter((s: any) => String(s?.casterId || "") === playerId).length;
}

function getSpellsCastLastTurnCount(ctx: GameContext): number | null {
  const v = (ctx as any).state?.spellsCastLastTurnCount;
  return typeof v === "number" ? v : null;
}

function getSpellsCastLastTurnByPlayerCounts(ctx: GameContext): Record<string, number> | null {
  const v = (ctx as any).state?.spellsCastLastTurnByPlayerCounts;
  if (!v || typeof v !== 'object') return null;
  return v as Record<string, number>;
}

function isPermanentEquipped(ctx: GameContext, perm: any): boolean {
  if (!perm) return false;
  if (perm.isEquipped === true) return true;
  if (Array.isArray(perm.attachedEquipment) && perm.attachedEquipment.length > 0) return true;
  const attachments = Array.isArray(perm.attachments) ? perm.attachments : [];
  if (!attachments.length) return false;
  const battlefield = (ctx as any).state?.battlefield || [];
  return attachments.some((id: any) => {
    const a = (Array.isArray(battlefield) ? battlefield : []).find((p: any) => p?.id === id);
    const tl = String(a?.card?.type_line || '').toLowerCase();
    return tl.includes('equipment');
  });
}

function isPermanentEnchanted(ctx: GameContext, perm: any): boolean {
  if (!perm) return false;
  const attachments = Array.isArray(perm.attachments) ? perm.attachments : [];
  if (!attachments.length) return false;
  const battlefield = (ctx as any).state?.battlefield || [];
  return attachments.some((id: any) => {
    const a = (Array.isArray(battlefield) ? battlefield : []).find((p: any) => p?.id === id);
    const tl = String(a?.card?.type_line || '').toLowerCase();
    return tl.includes('aura');
  });
}

function countBattlefieldAttachmentsByType(
  ctx: GameContext,
  perm: any,
  typeWordLower: 'aura' | 'equipment'
): { count: number; unknown: boolean } | null {
  if (!perm) return null;

  const attachments = Array.isArray((perm as any).attachments) ? (perm as any).attachments : null;
  const attachedEquipment = Array.isArray((perm as any).attachedEquipment) ? (perm as any).attachedEquipment : null;

  // If we have no attachment id lists, we can't safely conclude anything.
  if (!attachments && !attachedEquipment) return null;

  const ids = new Set<string>();
  for (const id of attachments ?? []) ids.add(String(id));
  for (const id of attachedEquipment ?? []) ids.add(String(id));
  if (ids.size === 0) return { count: 0, unknown: false };

  const battlefield = (ctx as any).state?.battlefield;
  if (!Array.isArray(battlefield)) return null;

  let count = 0;
  let unknown = false;
  for (const id of ids) {
    const a = battlefield.find((p: any) => p && String(p.id || '') === id);
    if (!a) {
      unknown = true;
      continue;
    }
    const tl = String(a?.card?.type_line || '').toLowerCase();
    if (tl.includes(typeWordLower)) count++;
  }

  return { count, unknown };
}

function isEquippedConservative(ctx: GameContext, perm: any): boolean | null {
  if (!perm) return null;
  if (typeof (perm as any).isEquipped === 'boolean') return (perm as any).isEquipped;
  if (Array.isArray((perm as any).attachedEquipment)) return (perm as any).attachedEquipment.length > 0;
  const info = countBattlefieldAttachmentsByType(ctx, perm, 'equipment');
  if (!info) return null;
  if (info.count > 0) return true;
  return info.unknown ? null : false;
}

function getAuraCountConservative(ctx: GameContext, perm: any): { count: number; unknown: boolean } | null {
  return countBattlefieldAttachmentsByType(ctx, perm, 'aura');
}

function permanentHasKeyword(perm: any, keywordLower: string): boolean | null {
  if (!perm) return null;
  const keyword = String(keywordLower || '').toLowerCase();
  if (!keyword) return null;

  const oracleTextLower = String(perm?.card?.oracle_text || '').toLowerCase();
  const granted = Array.isArray((perm as any).grantedAbilities) ? (perm as any).grantedAbilities : [];
  const grantedLower = granted.map((a: any) => String(a || '').toLowerCase());

  // Keyword counters exist in some implementations (e.g., flying counters).
  const counters = (perm as any).counters;
  const hasKeywordCounter =
    counters && typeof counters === 'object' ? Object.keys(counters).some((k) => String(k || '').toLowerCase() === keyword) : false;

  // If we have no ability info at all, be conservative.
  const hasAnyInfo = Boolean(oracleTextLower) || grantedLower.length > 0 || Boolean(counters);
  if (!hasAnyInfo) return null;

  if (hasKeywordCounter) return true;
  if (oracleTextLower.includes(keyword)) return true;
  if (grantedLower.some((a: string) => a.includes(keyword))) return true;

  return false;
}

function isPermanentRed(perm: any): boolean | null {
  if (!perm) return null;
  const colors = (perm as any)?.card?.colors ?? (perm as any)?.card?.color_identity;
  if (Array.isArray(colors)) {
    const set = new Set(colors.map((c: any) => String(c || '').toUpperCase()));
    return set.has('R');
  }

  const color = (perm as any)?.card?.color;
  if (typeof color === 'string' && color) return color.toUpperCase() === 'R' || color.toLowerCase() === 'red';

  return null;
}

function isPermanentWhite(perm: any): boolean | null {
  if (!perm) return null;
  const colors = (perm as any)?.card?.colors ?? (perm as any)?.card?.color_identity;
  if (Array.isArray(colors)) {
    const set = new Set(colors.map((c: any) => String(c || '').toUpperCase()));
    return set.has('W');
  }

  const color = (perm as any)?.card?.color;
  if (typeof color === 'string' && color) return color.toUpperCase() === 'W' || color.toLowerCase() === 'white';

  return null;
}

function isPermanentBlack(perm: any): boolean | null {
  if (!perm) return null;
  const colors = (perm as any)?.card?.colors ?? (perm as any)?.card?.color_identity;
  if (Array.isArray(colors)) {
    const set = new Set(colors.map((c: any) => String(c || '').toUpperCase()));
    return set.has('B');
  }

  const color = (perm as any)?.card?.color;
  if (typeof color === 'string' && color) return color.toUpperCase() === 'B' || color.toLowerCase() === 'black';

  return null;
}

function isEnchantingTalePermanent(perm: any): boolean | null {
  if (!perm) return null;
  // "Enchanting Tales have the expansion code WOT" (Scryfall reminder text).
  const c: any = (perm as any).card || {};
  const set = c.set ?? c.set_code ?? c.expansion ?? c.expansion_code ?? c.expansionCode;
  if (typeof set === 'string' && set) return String(set).toLowerCase() === 'wot';

  // Some card payloads may store printing metadata differently; if present and non-WOT, treat as false.
  const printingSet = c.printingSet ?? c.printing_set;
  if (typeof printingSet === 'string' && printingSet) return String(printingSet).toLowerCase() === 'wot';

  return null;
}

function isPermanentAttacking(perm: any): boolean {
  return !!perm?.attacking || perm?.isAttacking === true;
}

function isPermanentBlocking(perm: any): boolean {
  const blocking = perm?.blocking;
  return Array.isArray(blocking) ? blocking.length > 0 : !!blocking;
}

function isPermanentBlocked(perm: any): boolean {
  const blockedBy = perm?.blockedBy;
  return Array.isArray(blockedBy) ? blockedBy.length > 0 : !!blockedBy;
}

function isCreatureDiedThisTurn(ctx: GameContext): boolean | null {
  const v = (ctx as any).state?.creatureDiedThisTurn;
  return typeof v === "boolean" ? v : null;
}

function didPermanentLeaveBattlefieldThisTurn(ctx: GameContext, playerId: string): boolean | null {
  const map = (ctx as any).state?.permanentLeftBattlefieldThisTurn;
  if (!map || typeof map !== "object") return null;
  const v = map[playerId];
  return typeof v === "boolean" ? v : null;
}

function getTurnPlayerId(ctx: GameContext): string | null {
  const state: any = (ctx as any).state || {};
  return (state.turnPlayer || state.activePlayer || null) as string | null;
}

function getActivePlayerId(ctx: GameContext): string | null {
  const state: any = (ctx as any).state || {};
  return (state.activePlayer || state.turnPlayer || null) as string | null;
}

function getOpponentIds(ctx: GameContext, controllerId: string): string[] {
  const state: any = (ctx as any).state || {};
  const players = Array.isArray(state.players) ? state.players : [];
  return players
    .map((p: any) => String(p?.id || ""))
    .filter((id: string) => id && id !== controllerId);
}

function getPlayerTeamId(ctx: GameContext, playerId: string): string | null {
  const stateAny: any = (ctx as any).state || {};
  const direct = stateAny?.team?.[playerId] ?? stateAny?.teams?.[playerId] ?? stateAny?.playerTeam?.[playerId];
  if (typeof direct === 'string' && direct) return direct;

  const players = Array.isArray(stateAny.players) ? stateAny.players : [];
  const p = players.find((pp: any) => String(pp?.id || '') === String(playerId));
  const fromPlayer = p?.team ?? p?.teamId ?? p?.playerTeam;
  return typeof fromPlayer === 'string' && fromPlayer ? fromPlayer : null;
}

function getTeamMemberIds(ctx: GameContext, controllerId: string): string[] {
  const teamId = getPlayerTeamId(ctx, controllerId);
  if (!teamId) return [String(controllerId)];

  const stateAny: any = (ctx as any).state || {};
  const players = Array.isArray(stateAny.players) ? stateAny.players : [];
  const ids = players
    .map((p: any) => String(p?.id || ''))
    .filter((id: string) => Boolean(id));

  const members = ids.filter((pid) => {
    const t = getPlayerTeamId(ctx, pid);
    return typeof t === 'string' && String(t) === String(teamId);
  });

  // Safety: ensure controller is included.
  if (!members.includes(String(controllerId))) members.push(String(controllerId));
  return Array.from(new Set(members));
}

function getAllPlayerIds(ctx: GameContext, controllerId: string): string[] {
  const state: any = (ctx as any).state || {};
  const players = Array.isArray(state.players) ? state.players : [];
  const ids = players
    .map((p: any) => String(p?.id || ''))
    .filter((id: string) => Boolean(id));
  if (controllerId && !ids.includes(controllerId)) ids.push(controllerId);
  return Array.from(new Set(ids));
}

function isTiedForExtreme(
  allIds: string[],
  controllerId: string,
  getValue: (pid: string) => number,
  extreme: 'most' | 'least'
): boolean {
  if (!allIds.length) return false;

  const yourValue = getValue(controllerId);
  const values = allIds.map((pid) => getValue(pid));
  const extremeValue = extreme === 'most' ? Math.max(...values) : Math.min(...values);
  if (yourValue !== extremeValue) return false;

  const tiedCount = values.filter((v) => v === extremeValue).length;
  return tiedCount >= 2;
}

/**
 * Extract an intervening-if clause (the leading "if ...") from a triggered ability's
 * description/effect text.
 *
 * Examples:
 * - "If you control seven or more Plains, you may ..." => "if you control seven or more plains"
 */
export function extractLeadingInterveningIfClause(text: string): string | null {
  const normalized = normalizeText(text);
  if (!/^if\s+/i.test(normalized)) return null;

  // Capture up to the first comma (most oracle templates use a comma after the condition).
  const m = normalized.match(/^if\s+(.+?)(?:,|$)/i);
  if (!m) return null;
  return `if ${m[1]}`;
}

/**
 * Extract an intervening-if clause from a triggered ability description.
 *
 * Supports both common oracle templates:
 * - "If <cond>, ..." (leading)
 * - "When/Whenever/At <event>, if <cond>, ..." (comma-delimited)
 *
 * Returns the normalized leading clause (e.g. "if you control another knight").
 */
export function extractInterveningIfClause(text: string): string | null {
  const normalized = normalizeText(text);

  // Leading "If ..."
  const leading = extractLeadingInterveningIfClause(normalized);
  if (leading) return leading;

  // Only treat comma-delimited ", if ..." as intervening-if when the text looks like a trigger template.
  // This avoids false positives for effect text like "... . If you do, ...".
  if (!/^(when|whenever|at)\b/i.test(normalized)) return null;

  const m = normalized.match(/,\s*(if\s+.+?)(?:,|$)/i);
  if (!m) return null;

  // Normalize to a leading-if clause and trim trailing punctuation.
  const clause = normalizeText(m[1]).replace(/[.\s]+$/, "").trim();
  return clause;
}

/**
 * Evaluates a subset of common intervening-if conditions.
 *
 * Returns:
 * - `true`  => condition recognized and satisfied
 * - `false` => condition recognized and NOT satisfied
 * - `null`  => condition recognized but cannot be evaluated from current tracked state
 */
const UNMATCHED_INTERVENING_IF = Symbol('intervening-if:unmatched');
const FALLBACK_INTERVENING_IF = Symbol('intervening-if:fallback');
type InterveningIfInternalResult =
  | boolean
  | null
  | typeof UNMATCHED_INTERVENING_IF
  | typeof FALLBACK_INTERVENING_IF;

export type InterveningIfEvaluation = {
  matched: boolean;
  value: boolean | null;
  fallback?: boolean;
};

export type InterveningIfRefs = {
  thatPlayerId?: string;
  referencedPlayerId?: string;
  theirPlayerId?: string;

  // Combat context (e.g., for "if you're the defending player" / "if defending player ...")
  defendingPlayerId?: string;

  // Event-group context for templates like "...of those creatures...".
  // For declare-attackers-trigger evaluation, this should be the list of attacker permanent ids involved in the event.
  thoseCreatureIds?: string[];

  // Optional context for clauses that refer to an activated ability/spell/stack item.
  // Example: "Whenever you activate an ability, if it isn't a mana ability, ..."
  activatedAbilityIsManaAbility?: boolean;
  triggeringStackItemId?: string;
  stackItem?: { type?: string; isManaAbility?: boolean; targets?: any[]; target?: any; targetId?: any };
};

function getTargetCountFromStackItemLike(stackItem: any): number | null {
  if (!stackItem) return null;
  const targets = (stackItem as any).targets;
  if (Array.isArray(targets)) return targets.length;
  if ((stackItem as any).target != null) return 1;
  if ((stackItem as any).targetId != null) return 1;
  return null;
}

function getInterveningIfTargetCount(ctx: GameContext, refs?: InterveningIfRefs, sourcePermanent?: any): number | null {
  const fromRefs = getTargetCountFromStackItemLike(refs?.stackItem);
  if (typeof fromRefs === 'number') return fromRefs;

  const stackId =
    refs?.triggeringStackItemId ??
    (sourcePermanent as any)?.triggeringStackItemId ??
    (sourcePermanent as any)?.triggeringSpellStackItemId;

  if (!stackId) return null;
  const stack: any[] = Array.isArray((ctx as any).state?.stack) ? (ctx as any).state.stack : [];
  const triggering = stack.find((it: any) => it && String(it.id) === String(stackId));
  return getTargetCountFromStackItemLike(triggering);
}

function getDefendingPlayerIdForInterveningIf(sourcePermanent: any, refs?: InterveningIfRefs): string | null {
  const fromRefs = refs?.defendingPlayerId ?? (sourcePermanent as any)?.defendingPlayerId;
  if (typeof fromRefs === 'string' && fromRefs) return String(fromRefs);

  // Many combat structures store the defending player as attacker.attacking.
  const fromAttacking = (sourcePermanent as any)?.attacking;
  if (typeof fromAttacking === 'string' && fromAttacking && !String(fromAttacking).startsWith('perm_')) return String(fromAttacking);

  return null;
}

function attachInterveningIfRefs(sourcePermanent: any, refs?: InterveningIfRefs): any {
  if (!refs) return sourcePermanent;

  const thatPlayerId = refs.thatPlayerId;
  const referencedPlayerId = refs.referencedPlayerId;
  const theirPlayerId = refs.theirPlayerId;
  const defendingPlayerId = refs.defendingPlayerId;

  if (!thatPlayerId && !referencedPlayerId && !theirPlayerId && !defendingPlayerId) return sourcePermanent;

  const existing = sourcePermanent || {};
  const next: any = { ...existing };

  if (next.thatPlayerId == null && thatPlayerId) next.thatPlayerId = thatPlayerId;
  if (next.referencedPlayerId == null && referencedPlayerId) next.referencedPlayerId = referencedPlayerId;
  if (next.theirPlayerId == null && theirPlayerId) next.theirPlayerId = theirPlayerId;
  if (next.defendingPlayerId == null && defendingPlayerId) next.defendingPlayerId = defendingPlayerId;

  return next;
}

function evaluateInterveningIfClauseInternal(
  ctx: GameContext,
  controllerId: string,
  clauseText: string,
  sourcePermanent?: any,
  refs?: InterveningIfRefs
): InterveningIfInternalResult {
  sourcePermanent = attachInterveningIfRefs(sourcePermanent, refs);
  const clause = toLower(clauseText);

  // ===== Day / Night (when state provides it) =====
  // Most of the pre-day/night werewolf templates are handled via spells-cast-last-turn checks.
  // For explicit day/night templates, this is best-effort because not all game states track it yet.
  if (/^if\s+(?:it'?s|it\s+is)\s+day$/i.test(clause)) {
    const dn = (ctx as any).state?.dayNight ?? (ctx as any).state?.day_night ?? (ctx as any).state?.dayNightState;
    if (typeof dn === 'string') return String(dn).toLowerCase() === 'day';
    const isDay = (ctx as any).state?.isDay;
    if (typeof isDay === 'boolean') return isDay;
    return null;
  }

  if (/^if\s+(?:it'?s|it\s+is)\s+night$/i.test(clause)) {
    const dn = (ctx as any).state?.dayNight ?? (ctx as any).state?.day_night ?? (ctx as any).state?.dayNightState;
    if (typeof dn === 'string') return String(dn).toLowerCase() === 'night';
    const isNight = (ctx as any).state?.isNight;
    if (typeof isNight === 'boolean') return isNight;
    return null;
  }

  // "If it's neither day nor night" (common on cards that start the designation).
  if (/^if\s+(?:it'?s|it\s+is)\s+neither\s+day\s+nor\s+night$/i.test(clause)) {
    const dn = (ctx as any).state?.dayNight ?? (ctx as any).state?.day_night ?? (ctx as any).state?.dayNightState;
    if (typeof dn === 'string') {
      const v = String(dn).toLowerCase();
      return v !== 'day' && v !== 'night';
    }
    // If the state uses boolean flags, "neither" is when both are false.
    const isDay = (ctx as any).state?.isDay;
    const isNight = (ctx as any).state?.isNight;
    if (typeof isDay === 'boolean' && typeof isNight === 'boolean') return !isDay && !isNight;
    return null;
  }

  // "If it's neither day nor night and ..."
  {
    const m = clause.match(/^if\s+(it'?s|it\s+is)\s+neither\s+day\s+nor\s+night\s+and\s+(.+)$/i);
    if (m) {
      const rest = String(m[2] || '').trim();
      const dn = (ctx as any).state?.dayNight ?? (ctx as any).state?.day_night ?? (ctx as any).state?.dayNightState;
      let neither: boolean | null = null;
      if (typeof dn === 'string') {
        const v = String(dn).toLowerCase();
        neither = v !== 'day' && v !== 'night';
      } else {
        const isDay = (ctx as any).state?.isDay;
        const isNight = (ctx as any).state?.isNight;
        if (typeof isDay === 'boolean' && typeof isNight === 'boolean') neither = !isDay && !isNight;
      }
      if (typeof neither !== 'boolean') return null;
      if (!neither) return false;
      return evaluateInterveningIfClauseInternal(ctx, controllerId, `if ${rest}`, sourcePermanent);
    }
  }

  // "If it's day and ..." / "If it's night and ..." (common for daybound/nightbound templates)
  {
    const m = clause.match(/^if\s+(it'?s|it\s+is)\s+(day|night)\s+and\s+(.+)$/i);
    if (m) {
      const which = String(m[2] || '').toLowerCase();
      const rest = String(m[3] || '').trim();
      const dn = (ctx as any).state?.dayNight ?? (ctx as any).state?.day_night ?? (ctx as any).state?.dayNightState;
      const isDay = typeof dn === 'string' ? String(dn).toLowerCase() === 'day' : (ctx as any).state?.isDay;
      const isNight = typeof dn === 'string' ? String(dn).toLowerCase() === 'night' : (ctx as any).state?.isNight;

      if (which === 'day') {
        if (typeof isDay !== 'boolean') return null;
        if (!isDay) return false;
      } else {
        if (typeof isNight !== 'boolean') return null;
        if (!isNight) return false;
      }

      // Evaluate the remainder as another intervening-if clause.
      return evaluateInterveningIfClauseInternal(ctx, controllerId, `if ${rest}`, sourcePermanent);
    }
  }

  // "If it became day/night this turn" (and the common "day became night" phrasing)
  {
    const m = clause.match(/^if\s+(?:it\s+)?became\s+(day|night)\s+this\s+turn(?:\s+and\s+(.+))?$/i);
    if (m) {
      const which = String(m[1] || '').toLowerCase();
      const rest = String(m[2] || '').trim();
      const stateAny = (ctx as any).state as any;
      if (!stateAny || !("dayNightChangedThisTurn" in stateAny)) return null;
      const changedThisTurn = Boolean(stateAny.dayNightChangedThisTurn);
      const changedTo = stateAny.dayNightChangedTo;
      if (!changedThisTurn) return false;
      if (typeof changedTo !== 'string') return null;
      const ok = String(changedTo).toLowerCase() === which;
      if (!rest) return ok;
      if (!ok) return false;
      return evaluateInterveningIfClauseInternal(ctx, controllerId, `if ${rest}`, sourcePermanent);
    }
  }
  {
    const m = clause.match(/^if\s+(day\s+became\s+night|night\s+became\s+day)\s+this\s+turn(?:\s+and\s+(.+))?$/i);
    if (m) {
      const phrase = String(m[1] || '').toLowerCase();
      const which = phrase.startsWith('day became night') ? 'night' : 'day';
      const rest = String(m[2] || '').trim();
      const stateAny = (ctx as any).state as any;
      if (!stateAny || !("dayNightChangedThisTurn" in stateAny)) return null;
      const changedThisTurn = Boolean(stateAny.dayNightChangedThisTurn);
      const changedTo = stateAny.dayNightChangedTo;
      if (!changedThisTurn) return false;
      if (typeof changedTo !== 'string') return null;
      const ok = String(changedTo).toLowerCase() === which;
      if (!rest) return ok;
      if (!ok) return false;
      return evaluateInterveningIfClauseInternal(ctx, controllerId, `if ${rest}`, sourcePermanent);
    }
  }

  // ===== Die roll history (best-effort, uses state.dieRollsThisTurn) =====
  // "If you rolled a 1" / "If you rolled a 10 or higher this turn" etc.
  if (/^if\s+you\s+rolled\s+a\s+die\s+this\s+turn$/i.test(clause) || /^if\s+you\s+rolled\s+one\s+or\s+more\s+dice\s+this\s+turn$/i.test(clause)) {
    const rolls = getDieRollResultsThisTurn(ctx, controllerId);
    return rolls.length > 0;
  }
  {
    const m = clause.match(/^if\s+you\s+rolled\s+a\s+([a-z0-9]+)(?:\s+this\s+turn)?$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const rolls = getDieRollResultsThisTurn(ctx, controllerId);
      if (rolls.length === 0) return null;
      return rolls.some((r) => r.result === n);
    }
  }
  {
    const m = clause.match(/^if\s+you\s+rolled\s+([a-z0-9]+)\s+or\s+higher\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const rolls = getDieRollResultsThisTurn(ctx, controllerId);
      if (rolls.length === 0) return null;
      return rolls.some((r) => r.result >= n);
    }
  }
  {
    const m = clause.match(/^if\s+you\s+rolled\s+([a-z0-9]+)\s+or\s+less\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const rolls = getDieRollResultsThisTurn(ctx, controllerId);
      if (rolls.length === 0) return null;
      return rolls.some((r) => r.result <= n);
    }
  }

  // ===== Cast timing / metadata =====
  // "...if you cast it during your main phase..." (requires cast-time metadata to be stored on the spell/permanent)
  if (/^if\s+you\s+cast\s+it\s+during\s+your\s+main\s+phase$/i.test(clause)) {
    return didCastDuringOwnMainPhase(sourcePermanent);
  }

  // ===== Turn-history thresholds =====
  // "...if you gained N or more life this turn..." (Resplendent Angel, Griffin Aerie, Valkyrie Harbinger)
  {
    const m = clause.match(/^if\s+you(?:'ve|\s+have)?\s+gained\s+([a-z0-9]+)\s+or\s+more\s+life\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getLifeGainedThisTurn(ctx, controllerId) >= n;
    }
  }

  // "...if you gained life this turn..."
  if (/^if\s+you(?:'ve|\s+have)?\s+gained\s+life\s+this\s+turn$/i.test(clause)) {
    return getLifeGainedThisTurn(ctx, controllerId) > 0;
  }

  // "...if your team gained life this turn..." (team formats; best-effort when per-turn tracking exists)
  if (/^if\s+your\s+team\s+gained\s+life\s+this\s+turn$/i.test(clause)) {
    const map = (ctx as any).state?.lifeGainedThisTurn;
    if (!map || typeof map !== 'object') return null;

    const teamIds = getTeamMemberIds(ctx, controllerId);
    const any = teamIds.some((pid) => {
      const v = (map as any)[String(pid)];
      return typeof v === 'number' ? v > 0 : false;
    });
    if (any) return true;

    // If the map exists but some entries are missing/non-numeric, we can't safely say false.
    const allNumeric = teamIds.every((pid) => typeof (map as any)[String(pid)] === 'number');
    return allNumeric ? false : null;
  }

  // "...if you lost life this turn..."
  if (/^if\s+you(?:'ve|\s+have)?\s+lost\s+life\s+this\s+turn$/i.test(clause)) {
    return getLifeLostThisTurn(ctx, controllerId) > 0;
  }

  // "...if you didn't lose life this turn..." (Luminarch Ascension)
  if (/^if\s+you\s+(?:did\s+not|didn't)\s+lose\s+life\s+this\s+turn$/i.test(clause)) {
    return getLifeLostThisTurn(ctx, controllerId) === 0;
  }

  // "...if you lost N or more life this turn..." (best-effort)
  {
    const m = clause.match(/^if\s+you\s+lost\s+([a-z0-9]+)\s+or\s+more\s+life\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getLifeLostThisTurn(ctx, controllerId) >= n;
    }
  }

  // "...if you gained or lost life this turn..."
  if (/^if\s+you\s+gained\s+or\s+lost\s+life\s+this\s+turn$/i.test(clause)) {
    return getLifeGainedThisTurn(ctx, controllerId) > 0 || getLifeLostThisTurn(ctx, controllerId) > 0;
  }

  // "...if you gained and lost life this turn..." (Lunar Convocation)
  if (/^if\s+you\s+gained\s+and\s+lost\s+life\s+this\s+turn$/i.test(clause)) {
    return getLifeGainedThisTurn(ctx, controllerId) > 0 && getLifeLostThisTurn(ctx, controllerId) > 0;
  }

  // "...if an opponent lost life this turn..." (Theater of Horrors/Florian-style)
  if (/^if\s+an\s+opponent\s+(?:has\s+)?lost\s+life\s+this\s+turn$/i.test(clause)) {
    const opps = getOpponentIds(ctx, controllerId);
    if (!opps.length) return false;
    const anyLossTracked = opps.some((oid) => getLifeLostThisTurn(ctx, oid) > 0);
    if (anyLossTracked) return true;

    // Fallback: creature-damage tracking counts as life lost for many cards.
    const damageTracker = (ctx as any).state?.creaturesThatDealtDamageToPlayer;
    if (damageTracker && typeof damageTracker === 'object') {
      return opps.some((oid) => {
        const entry = damageTracker?.[oid];
        return entry && typeof entry === 'object' && Object.keys(entry).length > 0;
      });
    }

    return false;
  }

  // "...if you've drawn two or more cards this turn..." (Improbable Alliance, Faerie Vandal)
  {
    const m = clause.match(/^if\s+you(?:'ve|\s+have)?\s+drawn\s+([a-z0-9]+)\s+or\s+more\s+cards\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getCardsDrawnThisTurn(ctx, controllerId) >= n;
    }
  }

  // "...if you drew two or more cards this turn..." (Archmage Ascension oracle wording variant)
  {
    const m = clause.match(/^if\s+you\s+drew\s+([a-z0-9]+)\s+or\s+more\s+cards\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getCardsDrawnThisTurn(ctx, controllerId) >= n;
    }
  }

  // "...if you've cast two or more spells this turn..." is already covered elsewhere; keep it below.

  // "...if a land entered the battlefield under your control this turn..." (landfall-adjacent)
  if (/^if\s+a\s+land\s+(?:you\s+control\s+)?entered(?:\s+the\s+battlefield)?\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {
    return getLandsEnteredBattlefieldThisTurn(ctx, controllerId) > 0;
  }

  // "if you had a land enter the battlefield under your control this turn" (Wandering Troubadour)
  if (/^if\s+you\s+had\s+a\s+land\s+enter\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {
    return getLandsEnteredBattlefieldThisTurn(ctx, controllerId) > 0;
  }

  // "if a land entered the battlefield under your control this turn and you control a prime number of lands"
  if (/^if\s+a\s+land\s+entered\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn\s+and\s+you\s+control\s+a\s+prime\s+number\s+of\s+lands$/i.test(clause)) {
    if (getLandsEnteredBattlefieldThisTurn(ctx, controllerId) <= 0) return false;
    return isPrimeNumber(countByPermanentType(ctx, controllerId, 'land'));
  }

  // "if N or more nonland permanents entered the battlefield under your control this turn" (best-effort)
  {
    const m = clause.match(
      /^if\s+([a-z0-9]+)\s+or\s+more\s+nonland\s+permanents\s+entered\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn$/i
    );
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const map = (ctx as any).state?.nonlandPermanentsEnteredBattlefieldThisTurn;
      const v = map?.[controllerId];
      if (typeof v === "number") return v >= n;
      return null;
    }
  }

  // "if N or more <type> entered (the battlefield) under your control this turn" (best-effort)
  {
    const m = clause.match(
      /^if\s+([a-z0-9]+)\s+or\s+more\s+(artifacts|creatures|enchantments|lands|planeswalkers|battles)\s+entered(?:\s+the\s+battlefield)?\s+under\s+your\s+control\s+this\s+turn$/i
    );
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const plural = String(m[2] || '').toLowerCase();
      const typeLower = plural.endsWith('s') ? plural.slice(0, -1) : plural;

      // Deterministic per-turn tracking when available (avoid false negatives).
      if (typeLower === 'land' || typeLower === 'creature' || typeLower === 'artifact' || typeLower === 'planeswalker') {
        const c = countControlledEnteredThisTurn(ctx, controllerId, typeLower);
        if (c === null) return null;
        return c >= n;
      }

      // Otherwise fall back to battlefield scan, but only when we have explicit "entered this turn" evidence.
      const battlefield = (ctx as any).state?.battlefield || [];
      const hasEnteredTracking = Array.isArray(battlefield) && battlefield.some((p: any) => p?.enteredThisTurn === true);
      if (!hasEnteredTracking) return null;

      const c = countControlledEnteredThisTurn(ctx, controllerId, typeLower);
      if (c === null) return null;
      return c >= n;
    }
  }

  // "if two or more of those creatures are attacking you and/or planeswalkers you control" (needs attack declaration context)
  {
    const m = clause.match(
      /^if\s+([a-z0-9]+)\s+or\s+more\s+of\s+those\s+creatures\s+are\s+attacking\s+you\s+and\/or\s+planeswalkers\s+you\s+control$/i
    );
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const thoseCreatureIds = refs?.thoseCreatureIds;
      if (!Array.isArray(thoseCreatureIds) || thoseCreatureIds.length === 0) return null;

      const battlefield = Array.isArray((ctx as any).state?.battlefield) ? (ctx as any).state.battlefield : [];
      const planeswalkerIds = new Set(
        battlefield
          .filter(
            (p: any) =>
              p &&
              String(p.controller) === String(controllerId) &&
              String(p.card?.type_line || '').toLowerCase().includes('planeswalker')
          )
          .map((p: any) => String(p.id))
      );

      let knownMatches = 0;
      let unknown = 0;

      for (const cid of thoseCreatureIds) {
        const attacker = battlefield.find((p: any) => p && String(p.id) === String(cid));
        if (!attacker) {
          unknown++;
          continue;
        }

        const attacking = (attacker as any).attacking ?? (attacker as any).attackTarget ?? (attacker as any).defending;
        if (attacking == null) {
          unknown++;
          continue;
        }

        const targetId = String(attacking);
        const isMatch = targetId === String(controllerId) || planeswalkerIds.has(targetId);
        if (isMatch) knownMatches++;
      }

      if (knownMatches >= n) return true;
      if (knownMatches + unknown < n) return false;
      return null;
    }
  }

  // "...if it/this source dealt damage to an opponent this turn..."
  if (/^if\s+(?:it|this\s+(?:creature|permanent|source))\s+dealt\s+damage\s+to\s+an\s+opponent\s+this\s+turn$/i.test(clause)) {
    if (!sourcePermanent?.id) return null;
    return didSourceDealDamageToOpponentThisTurn(ctx, controllerId, String(sourcePermanent.id));
  }

  // "if it dealt combat damage to a player this turn" (Wave of Rats; best-effort)
  if (/^if\s+it\s+dealt\s+combat\s+damage\s+to\s+a\s+player\s+this\s+turn$/i.test(clause)) {
    if (!sourcePermanent?.id) return null;
    return didSourceDealDamageToAnyPlayerThisTurn(ctx, String(sourcePermanent.id));
  }

  // "if N or more damage was dealt to it this turn" (best-effort)
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+damage\s+was\s+dealt\s+to\s+it\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      if (!sourcePermanent) return null;

      const dmg =
        parseMaybeNumber((sourcePermanent as any)?.damageThisTurn) ??
        parseMaybeNumber((sourcePermanent as any)?.combatDamageThisTurn) ??
        parseMaybeNumber((sourcePermanent as any)?.card?.damageThisTurn) ??
        parseMaybeNumber((sourcePermanent as any)?.card?.combatDamageThisTurn);

      if (dmg === null) return null;
      return dmg >= n;
    }
  }

  // "if any of those creatures have power or toughness equal to the chosen number" (best-effort)
  if (/^if\s+any\s+of\s+those\s+creatures\s+have\s+power\s+or\s+toughness\s+equal\s+to\s+the\s+chosen\s+number$/i.test(clause)) {
    const thoseCreatureIds = refs?.thoseCreatureIds;
    if (!Array.isArray(thoseCreatureIds) || thoseCreatureIds.length === 0) return null;
    if (!sourcePermanent) return null;

    const chosenRaw =
      (sourcePermanent as any)?.chosenNumber ??
      (sourcePermanent as any)?.chosen_number ??
      (sourcePermanent as any)?.card?.chosenNumber ??
      (sourcePermanent as any)?.card?.chosen_number;
    const chosen = parseMaybeNumber(chosenRaw);
    if (chosen === null) return null;

    const battlefield = (ctx as any).state?.battlefield || [];
    if (!Array.isArray(battlefield)) return null;

    let sawUnknown = false;
    for (const cid of thoseCreatureIds) {
      const creature = battlefield.find((p: any) => p && String(p.id || '') === String(cid));
      if (!creature) {
        sawUnknown = true;
        continue;
      }

      const p = parseMaybeNumber(
        (creature as any)?.effectivePower ?? (creature as any)?.power ?? (creature as any)?.basePower ?? (creature as any)?.card?.power
      );
      const t = parseMaybeNumber(
        (creature as any)?.effectiveToughness ??
          (creature as any)?.toughness ??
          (creature as any)?.baseToughness ??
          (creature as any)?.card?.toughness
      );

      if (p === chosen || t === chosen) return true;
      if (p === null || t === null) sawUnknown = true;
    }

    return sawUnknown ? null : false;
  }

  // "if this creature was dealt damage this turn" (best-effort)
  if (/^if\s+this\s+creature\s+was\s+dealt\s+damage\s+this\s+turn$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const dmg =
      parseMaybeNumber((sourcePermanent as any)?.damageThisTurn) ??
      parseMaybeNumber((sourcePermanent as any)?.combatDamageThisTurn) ??
      parseMaybeNumber((sourcePermanent as any)?.card?.damageThisTurn) ??
      parseMaybeNumber((sourcePermanent as any)?.card?.combatDamageThisTurn);
    if (dmg === null) return false;
    return dmg > 0;
  }

  // Common creature/aura/equipment templates should be checked early (generic "control a/an X" won't match these).
  if (/^if\s+you\s+control\s+an\s+enchanted\s+creature$/i.test(clause)) {
    return getControlledCreatures(ctx, controllerId).some((c: any) => isPermanentEnchanted(ctx, c));
  }

  if (/^if\s+you\s+control\s+an\s+equipped\s+creature$/i.test(clause)) {
    return getControlledCreatures(ctx, controllerId).some((c: any) => isPermanentEquipped(ctx, c));
  }

  // Monarch / Initiative / City's Blessing
  if (/^if\s+you\s+are\s+the\s+monarch$/i.test(clause)) {
    const monarch = (ctx as any).state?.monarch;
    return monarch ? String(monarch) === controllerId : null;
  }

  if (/^if\s+you'?re\s+the\s+monarch$/i.test(clause)) {
    const monarch = (ctx as any).state?.monarch;
    return monarch ? String(monarch) === controllerId : null;
  }

  if (/^if\s+there\s+is\s+no\s+monarch$/i.test(clause)) {
    const monarch = (ctx as any).state?.monarch;
    return !monarch;
  }

  if (/^if\s+you\s+have\s+the\s+initiative$/i.test(clause)) {
    const initiative = (ctx as any).state?.initiative;
    return initiative ? String(initiative) === controllerId : null;
  }

  if (/^if\s+you\s+have\s+the\s+city'?s\s+blessing$/i.test(clause)) {
    const cb = (ctx as any).state?.cityBlessing;
    if (cb && typeof cb === "object") {
      const v = cb[controllerId];
      return typeof v === "boolean" ? v : false;
    }
    return null;
  }

  // "if you have the Windy City's blessing" (alias; Alchemy)
  if (/^if\s+you\s+have\s+the\s+windy\s+city['’]?s\s+blessing$/i.test(clause)) {
    const cb = (ctx as any).state?.cityBlessing;
    if (cb && typeof cb === "object") {
      const v = cb[controllerId];
      return typeof v === "boolean" ? v : false;
    }
    return null;
  }

  // "if it isn't renowned" / "if it's not renowned" (Renown)
  // This refers to the source permanent.
  if (/^if\s+(?:it\s+is\s+not|it\s+isn'?t|it'?s\s+not)\s+renowned$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return sourcePermanent.renowned !== true;
  }

  // "if it is renowned"
  if (/^if\s+(?:it\s+is|it'?s)\s+renowned$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return sourcePermanent.renowned === true;
  }

  // "if it was historic" (artifact, legendary, or Saga)
  if (/^if\s+it\s+was\s+historic$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const tl = String((sourcePermanent as any)?.card?.type_line ?? (sourcePermanent as any)?.type_line ?? '').toLowerCase();
    if (!tl) return null;
    return tl.includes('artifact') || tl.includes('legendary') || tl.includes('saga');
  }

  // "if it was a creature" / "if it's a creature" (best-effort via type line)
  if (
    /^if\s+it\s+was\s+a\s+creature$/i.test(clause) ||
    /^if\s+it'?s\s+a\s+creature$/i.test(clause) ||
    /^if\s+it\s+is\s+a\s+creature$/i.test(clause)
  ) {
    if (!sourcePermanent) return null;
    const tl = String(sourcePermanent?.card?.type_line || sourcePermanent?.type_line || "").toLowerCase();
    if (!tl) return null;
    return tl.includes("creature");
  }

  // "if it's on the battlefield" (best-effort via zone)
  if (/^if\s+it'?s\s+on\s+the\s+battlefield$/i.test(clause) || /^if\s+it\s+is\s+on\s+the\s+battlefield$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const zone = String((sourcePermanent as any)?.zone ?? (sourcePermanent as any)?.card?.zone ?? "");
    if (!zone) return null;
    return zone.toLowerCase() === "battlefield";
  }

  // "if no creatures are on the battlefield"
  if (/^if\s+no\s+creatures\s+are\s+on\s+the\s+battlefield$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield || [];
    const anyCreature = (Array.isArray(battlefield) ? battlefield : []).some((p: any) => {
      const tl = String(p?.card?.type_line || "").toLowerCase();
      return tl.includes("creature");
    });
    return !anyCreature;
  }

  // "if this card is suspended" (best-effort: looks for isSuspended)
  if (/^if\s+this\s+card\s+is\s+suspended$/i.test(clause)) {
    const v = (sourcePermanent as any)?.isSuspended ?? (sourcePermanent as any)?.card?.isSuspended;
    return typeof v === "boolean" ? v : null;
  }

  // "if a card is exiled with it" (best-effort)
  if (
    /^if\s+(?:a\s+card\s+is\s+exiled|there\s+are\s+cards\s+exiled)\s+with\s+(?:it|this\s+artifact|this\s+enchantment)$/i.test(
      clause
    )
  ) {
    if (!sourcePermanent) return null;
    const candidates = [
      (sourcePermanent as any).exiledCards,
      (sourcePermanent as any).cardsExiledWith,
      (sourcePermanent as any).exiledWith,
      (sourcePermanent as any).exiledCardIds,
      (sourcePermanent as any).card?.exiledCards,
      (sourcePermanent as any).card?.cardsExiledWith,
      (sourcePermanent as any).card?.exiledWith,
      (sourcePermanent as any).card?.exiledCardIds,
    ];
    for (const c of candidates) {
      if (Array.isArray(c)) return c.length > 0;
      if (c && typeof c === "object") return Object.keys(c).length > 0;
      if (typeof c === "string") return c.length > 0;
    }

    // Evidence path 1: exile-zone tags written by `movePermanentToExile` (or similar helpers).
    // These tags are intentionally stored on the exiled card objects.
    const srcId = String((sourcePermanent as any)?.id ?? (sourcePermanent as any)?.permanentId ?? "");
    if (srcId) {
      const zones = (ctx as any).state?.zones;
      if (zones && typeof zones === 'object') {
        for (const z of Object.values(zones as any)) {
          const exile = (z as any)?.exile;
          if (!Array.isArray(exile)) continue;
          if (exile.some((c: any) => String(c?.exiledWithSourceId ?? '') === srcId)) return true;
        }
      }
    }

    // Evidence path 2: linked-exile system bookkeeping (Oblivion Ring, Banisher Priest, etc.)
    // When present, this implies a card is currently exiled with the permanent.
    const linked = (ctx as any).state?.linkedExiles;
    if (Array.isArray(linked) && srcId) {
      if (linked.some((le: any) => String(le?.exilingPermanentId ?? '') === srcId)) return true;
    }

    // Negative evidence (safe only for linked-exile permanents): if we can positively identify this
    // permanent as a linked-exile source AND we track that system, then "none found" => false.
    try {
      const det = detectLinkedExileEffect((sourcePermanent as any)?.card);
      if (det?.hasLinkedExile) return false;
    } catch {
      // best-effort only
    }

    return null;
  }

  // "if N or more cards have been exiled with this artifact" (best-effort)
  {
    const m = clause.match(
      /^if\s+(?:there\s+are\s+)?([a-z0-9]+)\s+or\s+more\s+cards\s+(?:have\s+been\s+)?exiled\s+with\s+(?:this\s+artifact|the\s+mysterious\s+sphere)$/i
    );
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      if (!sourcePermanent) return null;

      // If the clause explicitly names a different permanent, ensure we only handle when it refers to this source.
      if (/the\s+mysterious\s+sphere/i.test(clause)) {
        const nm = String((sourcePermanent as any)?.card?.name || (sourcePermanent as any)?.name || '');
        if (!/^The Mysterious Sphere\b/i.test(nm)) return null;
      }

      // Evidence path 0: direct bookkeeping on the permanent.
      const list =
        (sourcePermanent as any).exiledCards ??
        (sourcePermanent as any).cardsExiledWith ??
        (sourcePermanent as any).exiledWith ??
        (sourcePermanent as any).exiledCardIds ??
        (sourcePermanent as any).card?.exiledCards ??
        (sourcePermanent as any).card?.cardsExiledWith ??
        (sourcePermanent as any).card?.exiledWith ??
        (sourcePermanent as any).card?.exiledCardIds;
      if (Array.isArray(list)) {
        return list.length >= n;
      }
      if (list && typeof list === 'object') {
        return Object.keys(list).length >= n;
      }

      // Evidence path 1: exile-zone tags written on exiled cards.
      const srcId = String((sourcePermanent as any)?.id ?? (sourcePermanent as any)?.permanentId ?? '');
      if (!srcId) return null;
      const zones = (ctx as any).state?.zones;
      if (zones && typeof zones === 'object') {
        let count = 0;
        for (const z of Object.values(zones as any)) {
          const exile = (z as any)?.exile;
          if (!Array.isArray(exile)) continue;
          for (const c of exile) {
            if (String(c?.exiledWithSourceId ?? '') === srcId) count++;
          }
        }
        if (count >= n) return true;
      }

      // Evidence path 2: linked-exile bookkeeping (best-effort).
      const linked = (ctx as any).state?.linkedExiles;
      if (Array.isArray(linked)) {
        const count = linked.filter((le: any) => String(le?.exilingPermanentId ?? '') === srcId).length;
        if (count >= n) return true;
      }

      // Conservative: without an explicit list on the permanent, we avoid returning a definitive false.
      return null;
    }
  }

  // Spellweaver Helix-style: "if it has the same name as one of the cards exiled with this artifact" (best-effort)
  if (/^if\s+it\s+has\s+the\s+same\s+name\s+as\s+one\s+of\s+the\s+cards\s+exiled\s+with\s+this\s+artifact$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const srcId = String((sourcePermanent as any)?.id ?? (sourcePermanent as any)?.permanentId ?? '');
    if (!srcId) return null;

    const itName = String(
      (refs as any)?.stackItem?.card?.name ??
        (refs as any)?.card?.name ??
        (refs as any)?.triggeringCard?.name ??
        (refs as any)?.triggeringSpellCard?.name ??
        ''
    ).trim();
    if (!itName) return null;
    const itLower = itName.toLowerCase();

    const exiledNames = new Set<string>();

    // Evidence path 0: direct bookkeeping on the permanent.
    const list =
      (sourcePermanent as any).exiledCards ??
      (sourcePermanent as any).cardsExiledWith ??
      (sourcePermanent as any).exiledWith ??
      (sourcePermanent as any).exiledCardIds ??
      (sourcePermanent as any).card?.exiledCards ??
      (sourcePermanent as any).card?.cardsExiledWith ??
      (sourcePermanent as any).card?.exiledWith ??
      (sourcePermanent as any).card?.exiledCardIds;
    if (Array.isArray(list)) {
      for (const entry of list) {
        const nm = String((entry as any)?.name ?? (entry as any)?.card?.name ?? '').trim();
        if (nm) exiledNames.add(nm.toLowerCase());
      }
    }

    // Evidence path 1: exile-zone tags written on exiled cards.
    const zones = (ctx as any).state?.zones;
    if (zones && typeof zones === 'object') {
      for (const z of Object.values(zones as any)) {
        const exile = (z as any)?.exile;
        if (!Array.isArray(exile)) continue;
        for (const c of exile) {
          if (String(c?.exiledWithSourceId ?? '') !== srcId) continue;
          const nm = String(c?.name ?? c?.card?.name ?? '').trim();
          if (nm) exiledNames.add(nm.toLowerCase());
        }
      }
    }

    // Evidence path 2: linked-exile bookkeeping (best-effort: resolve ids via zones).
    const linked = (ctx as any).state?.linkedExiles;
    if (Array.isArray(linked) && zones && typeof zones === 'object') {
      const ids = linked
        .filter((le: any) => String(le?.exilingPermanentId ?? '') === srcId)
        .map((le: any) => String(le?.exiledCardId ?? le?.exiledCard?.id ?? ''))
        .filter(Boolean);

      if (ids.length) {
        for (const z of Object.values(zones as any)) {
          const exile = (z as any)?.exile;
          if (!Array.isArray(exile)) continue;
          for (const c of exile) {
            const cid = String(c?.id ?? c?.cardId ?? '');
            if (!cid || !ids.includes(cid)) continue;
            const nm = String(c?.name ?? c?.card?.name ?? '').trim();
            if (nm) exiledNames.add(nm.toLowerCase());
          }
        }
      }
    }

    if (exiledNames.size === 0) return null;
    return exiledNames.has(itLower);
  }

  // "if this creature attacked or blocked this combat" (best-effort)
  if (/^if\s+this\s+creature\s+attacked\s+or\s+blocked\s+this\s+combat$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const attacked = !!(sourcePermanent as any).attacking || (sourcePermanent as any).isAttacking === true || (sourcePermanent as any).attackedThisTurn === true;
    const blockedOrBlocking = isPermanentBlocked(sourcePermanent) || isPermanentBlocking(sourcePermanent);
    if (attacked || blockedOrBlocking) return true;
    return null;
  }

  // "if it's your turn" / "if it is your turn"
  if (/^if\s+(?:it'?s|it\s+is)\s+your\s+turn$/i.test(clause)) {
    const active = getActivePlayerId(ctx);
    if (!active) return null;
    return active === controllerId;
  }

  // "if it's not your turn" / "if it isn't your turn" / "if it is not your turn"
  if (/^if\s+(?:it'?s\s+not|it\s+is\s+not|it\s+isn'?t)\s+your\s+turn$/i.test(clause)) {
    const active = getActivePlayerId(ctx);
    if (!active) return null;
    return active !== controllerId;
  }

  // "if it's not the first turn of the game" (turn-tracking)
  if (/^if\s+(?:it'?s\s+not|it\s+is\s+not)\s+the\s+first\s+turn\s+of\s+the\s+game$/i.test(clause)) {
    const tn = parseMaybeNumber((ctx as any).state?.turnNumber);
    if (tn === null) return null;
    return tn > 1;
  }

  // "if it's the first combat phase of the turn" (handles extra combats)
  if (/^if\s+it'?s\s+the\s+first\s+combat\s+phase\s+of\s+the\s+turn$/i.test(clause)) {
    const combatNumber = parseMaybeNumber((ctx as any).state?.combatNumber);
    return (combatNumber ?? 1) === 1;
  }

  // "if it's not their turn" (context-dependent)
  if (/^if\s+(?:it'?s\s+not|it\s+is\s+not|it\s+isn'?t)\s+their\s+turn$/i.test(clause)) {
    const ref = (sourcePermanent as any)?.thatPlayerId ?? (sourcePermanent as any)?.theirPlayerId ?? (sourcePermanent as any)?.referencedPlayerId;
    if (typeof ref !== "string" || !ref) return null;
    const active = getActivePlayerId(ctx);
    if (!active) return null;
    return active !== String(ref);
  }

  // "if it isn't that player's turn" / "if it's not that player's turn" (context-dependent)
  if (/^if\s+(?:it'?s\s+not|it\s+is\s+not|it\s+isn'?t)\s+that\s+player'?s\s+turn$/i.test(clause)) {
    const pid =
      refs?.thatPlayerId ??
      refs?.referencedPlayerId ??
      refs?.theirPlayerId ??
      (sourcePermanent as any)?.thatPlayerId ??
      (sourcePermanent as any)?.referencedPlayerId ??
      (sourcePermanent as any)?.theirPlayerId;
    if (typeof pid !== 'string' || !pid) return null;
    const active = getActivePlayerId(ctx);
    if (!active) return null;
    return active !== String(pid);
  }

  // "if it isn't a mana ability" (needs stack/ability metadata; recognize but unknown)
  if (
    /^if\s+it\s+isn'?t\s+a\s+mana\s+ability$/i.test(clause) ||
    /^if\s+it\s+is\s+not\s+a\s+mana\s+ability$/i.test(clause)
  ) {
    const refFlag = (refs as any)?.activatedAbilityIsManaAbility;
    if (typeof refFlag === 'boolean') return !refFlag;

    const stackItem = (refs as any)?.stackItem;
    if (stackItem) {
      if (typeof stackItem.isManaAbility === 'boolean') return !stackItem.isManaAbility;
      if (typeof stackItem.type === 'string' && stackItem.type.toLowerCase() === 'mana_ability') return false;
    }

    return null;
  }

  // "if it's an opponent's turn" (common shorthand)
  if (/^if\s+(?:it'?s|it\s+is)\s+an\s+opponent'?s\s+turn$/i.test(clause)) {
    const active = getActivePlayerId(ctx);
    if (!active) return null;
    return active !== controllerId;
  }

  // Life comparisons vs opponents
  // - "if no opponent has more life than you"
  // - "if an opponent has more life than you"
  // - "if you have more life than an opponent"
  // - "if you have more life than each opponent"
  {
    const noOppMore = clause.match(/^if\s+no\s+opponent\s+has\s+more\s+life\s+than\s+you$/i);
    if (noOppMore) {
      const yourLife = getPlayerLife(ctx, controllerId);
      const oppIds = getOpponentIds(ctx, controllerId);
      if (!oppIds.length) return true;
      return oppIds.every((opp) => getPlayerLife(ctx, opp) <= yourLife);
    }

    const oppMore = clause.match(/^if\s+an\s+opponent\s+has\s+more\s+life\s+than\s+you$/i);
    if (oppMore) {
      const yourLife = getPlayerLife(ctx, controllerId);
      const oppIds = getOpponentIds(ctx, controllerId);
      if (!oppIds.length) return false;
      return oppIds.some((opp) => getPlayerLife(ctx, opp) > yourLife);
    }

    const youMoreThanEach = clause.match(/^if\s+you\s+have\s+more\s+life\s+than\s+each\s+(?:opponent|other\s+player)$/i);
    if (youMoreThanEach) {
      const yourLife = getPlayerLife(ctx, controllerId);
      const oppIds = getOpponentIds(ctx, controllerId);
      if (!oppIds.length) return true;
      return oppIds.every((opp) => yourLife > getPlayerLife(ctx, opp));
    }

    const youMoreThanAn = clause.match(/^if\s+you\s+have\s+more\s+life\s+than\s+an\s+opponent$/i);
    if (youMoreThanAn) {
      const yourLife = getPlayerLife(ctx, controllerId);
      const oppIds = getOpponentIds(ctx, controllerId);
      if (!oppIds.length) return false;
      return oppIds.some((opp) => yourLife > getPlayerLife(ctx, opp));
    }

    const noOppLess = clause.match(/^if\s+no\s+opponent\s+has\s+less\s+life\s+than\s+you$/i);
    if (noOppLess) {
      const yourLife = getPlayerLife(ctx, controllerId);
      const oppIds = getOpponentIds(ctx, controllerId);
      if (!oppIds.length) return true;
      return oppIds.every((opp) => getPlayerLife(ctx, opp) >= yourLife);
    }

    const oppLess = clause.match(/^if\s+an\s+opponent\s+has\s+less\s+life\s+than\s+you$/i);
    if (oppLess) {
      const yourLife = getPlayerLife(ctx, controllerId);
      const oppIds = getOpponentIds(ctx, controllerId);
      if (!oppIds.length) return false;
      return oppIds.some((opp) => getPlayerLife(ctx, opp) < yourLife);
    }

    const youLessThanEach = clause.match(/^if\s+you\s+have\s+less\s+life\s+than\s+each\s+(?:opponent|other\s+player)$/i);
    if (youLessThanEach) {
      const yourLife = getPlayerLife(ctx, controllerId);
      const oppIds = getOpponentIds(ctx, controllerId);
      if (!oppIds.length) return true;
      return oppIds.every((opp) => yourLife < getPlayerLife(ctx, opp));
    }

    const youLessThanAn = clause.match(/^if\s+you\s+have\s+less\s+life\s+than\s+an\s+opponent$/i);
    if (youLessThanAn) {
      const yourLife = getPlayerLife(ctx, controllerId);
      const oppIds = getOpponentIds(ctx, controllerId);
      if (!oppIds.length) return false;
      return oppIds.some((opp) => yourLife < getPlayerLife(ctx, opp));
    }
  }

  // Superlatives: life totals (ties count)
  // - "if you have the most life" (including ties)
  // - "if you have the least life" (including ties)
  // - "if you have the highest/lowest life total"
  // - Optional: "... or are tied for ..."
  {
    const m = clause.match(
      /^if\s+you\s+have\s+the\s+(most|least)\s+life(?:\s+total)?(?:\s+or\s+are\s+tied\s+for\s+(?:the\s+)?\1\s+life(?:\s+total)?)?$/i
    );
    if (m) {
      const kind = m[1].toLowerCase();
      const ids = getAllPlayerIds(ctx, controllerId);
      if (!ids.length) return null;

      const yourLife = getPlayerLife(ctx, controllerId);
      if (kind === 'most') return ids.every((pid) => getPlayerLife(ctx, pid) <= yourLife);
      return ids.every((pid) => getPlayerLife(ctx, pid) >= yourLife);
    }

    const m2 = clause.match(
      /^if\s+you\s+have\s+the\s+(highest|lowest)\s+life\s+total(?:\s+or\s+are\s+tied\s+for\s+(?:the\s+)?\1\s+life\s+total)?$/i
    );
    if (m2) {
      const kind = m2[1].toLowerCase();
      const ids = getAllPlayerIds(ctx, controllerId);
      if (!ids.length) return null;

      const yourLife = getPlayerLife(ctx, controllerId);
      if (kind === 'highest') return ids.every((pid) => getPlayerLife(ctx, pid) <= yourLife);
      return ids.every((pid) => getPlayerLife(ctx, pid) >= yourLife);
    }

    const m3 = clause.match(/^if\s+you\s+(?:are|have)\s+tied\s+for\s+(?:the\s+)?(most|least)\s+life(?:\s+total)?$/i);
    if (m3) {
      const extreme = m3[1].toLowerCase() as 'most' | 'least';
      const ids = getAllPlayerIds(ctx, controllerId);
      if (!ids.length) return null;
      return isTiedForExtreme(ids, controllerId, (pid) => getPlayerLife(ctx, pid), extreme);
    }

    const m4 = clause.match(/^if\s+you\s+(?:are|have)\s+tied\s+for\s+(?:the\s+)?(highest|lowest)\s+life\s+total$/i);
    if (m4) {
      const extreme: 'most' | 'least' = m4[1].toLowerCase() === 'highest' ? 'most' : 'least';
      const ids = getAllPlayerIds(ctx, controllerId);
      if (!ids.length) return null;
      return isTiedForExtreme(ids, controllerId, (pid) => getPlayerLife(ctx, pid), extreme);
    }
  }

  // Superlatives: permanents you control (ties count)
  // - "if you control the most creatures/lands" (including ties)
  // - "if you control the least/fewest creatures/lands" (including ties)
  // - Optional: "... or are tied for ..."
  {
    const m = clause.match(
      /^if\s+you\s+(?:control|have)\s+the\s+(most|least|fewest)\s+(creatures|lands)(?:\s+or\s+are\s+tied\s+for\s+(?:the\s+)?\1\s+\2)?$/i
    );
    if (m) {
      const kind = m[1].toLowerCase();
      const subject = m[2].toLowerCase();

      const ids = getAllPlayerIds(ctx, controllerId);
      if (!ids.length) return null;

      const getCount = (pid: string) =>
        subject === 'creatures' ? countByPermanentType(ctx, pid, 'creature') : countByPermanentType(ctx, pid, 'land');

      const yourCount = getCount(controllerId);
      if (kind === 'most') return ids.every((pid) => getCount(pid) <= yourCount);
      return ids.every((pid) => getCount(pid) >= yourCount);
    }

    const m2 = clause.match(/^if\s+you\s+(?:are|control|have)\s+tied\s+for\s+(?:the\s+)?(most|least|fewest)\s+(creatures|lands)$/i);
    if (m2) {
      const kind = m2[1].toLowerCase();
      const extreme: 'most' | 'least' = kind === 'most' ? 'most' : 'least';
      const subject = m2[2].toLowerCase();

      const ids = getAllPlayerIds(ctx, controllerId);
      if (!ids.length) return null;

      const getCount = (pid: string) =>
        subject === 'creatures' ? countByPermanentType(ctx, pid, 'creature') : countByPermanentType(ctx, pid, 'land');

      return isTiedForExtreme(ids, controllerId, getCount, extreme);
    }
  }

  // "if that player controls more creatures/lands than you" (Keeper of the Accord, etc.)
  {
    const m = clause.match(
      /^if\s+that\s+player\s+(?:controls|has)\s+more\s+(creatures|lands)\s+than\s+you$/i
    );
    if (m) {
      const subject = m[1].toLowerCase();
      const thatPlayerId =
        refs?.thatPlayerId ??
        (sourcePermanent as any)?.thatPlayerId ??
        (sourcePermanent as any)?.referencedPlayerId ??
        (sourcePermanent as any)?.targetPlayerId ??
        getTurnPlayerId(ctx);

      if (typeof thatPlayerId !== 'string' || !thatPlayerId) return null;

      const yourCount =
        subject === "creatures"
          ? countByPermanentType(ctx, controllerId, "creature")
          : countByPermanentType(ctx, controllerId, "land");

      const theirCount =
        subject === "creatures"
          ? countByPermanentType(ctx, thatPlayerId, "creature")
          : countByPermanentType(ctx, thatPlayerId, "land");

      return theirCount > yourCount;
    }
  }

  // "if that player controls more lands than each other player" (Rivalry/Greener Pastures)
  if (/^if\s+that\s+player\s+controls\s+more\s+lands\s+than\s+each\s+other\s+player$/i.test(clause)) {
    const that =
      refs?.thatPlayerId ??
      (sourcePermanent as any)?.thatPlayerId ??
      (sourcePermanent as any)?.referencedPlayerId ??
      (sourcePermanent as any)?.targetPlayerId ??
      getTurnPlayerId(ctx);

    if (typeof that !== 'string' || !that) return null;
    const ids = getAllPlayerIds(ctx, controllerId);
    if (!ids.length) return null;

    const thatCount = countByPermanentType(ctx, that, 'land');
    return ids.every((pid) => {
      if (pid === that) return true;
      return thatCount > countByPermanentType(ctx, pid, 'land');
    });
  }

  // "if that player had another land enter the battlefield under their control this turn" (Tunnel Ignus/Conundrum)
  if (/^if\s+that\s+player\s+had\s+another\s+land\s+enter\s+the\s+battlefield\s+under\s+their\s+control\s+this\s+turn$/i.test(clause)) {
    const that =
      (sourcePermanent as any)?.thatPlayerId ??
      (sourcePermanent as any)?.referencedPlayerId ??
      (sourcePermanent as any)?.targetPlayerId;

    if (typeof that !== 'string' || !that) return null;

    // The "another" land is satisfied if total lands entered this turn under that player's control is at least 2.
    const c = countControlledEnteredThisTurn(ctx, that, 'land');
    if (c === null) return null;
    return c >= 2;
  }

  // "if an opponent controls more creatures/lands than you" (fallback for templates that don't use "that player")
  {
    const m = clause.match(
      /^if\s+an\s+opponent\s+(?:controls|has)\s+more\s+(creatures|lands)\s+than\s+you$/i
    );
    if (m) {
      const subject = m[1].toLowerCase();
      const yourCount =
        subject === "creatures"
          ? countByPermanentType(ctx, controllerId, "creature")
          : countByPermanentType(ctx, controllerId, "land");

      const opponentIds = getOpponentIds(ctx, controllerId);
      if (!opponentIds.length) return false;

      return opponentIds.some((oppId) => {
        const oppCount =
          subject === "creatures"
            ? countByPermanentType(ctx, oppId, "creature")
            : countByPermanentType(ctx, oppId, "land");
        return oppCount > yourCount;
      });
    }
  }

  // Opponent-relative creature/land comparisons
  // - "if no opponent controls more creatures/lands than you"
  // - "if an opponent controls fewer creatures/lands than you"
  {
    const noOppMore = clause.match(
      /^if\s+no\s+opponent\s+(?:controls|has)\s+more\s+(creatures|lands)\s+than\s+you$/i
    );
    if (noOppMore) {
      const subject = noOppMore[1].toLowerCase();
      const yourCount =
        subject === 'creatures'
          ? countByPermanentType(ctx, controllerId, 'creature')
          : countByPermanentType(ctx, controllerId, 'land');

      const opponentIds = getOpponentIds(ctx, controllerId);
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          subject === 'creatures'
            ? countByPermanentType(ctx, oppId, 'creature')
            : countByPermanentType(ctx, oppId, 'land');
        return oppCount <= yourCount;
      });
    }

    const oppFewer = clause.match(
      /^if\s+an\s+opponent\s+(?:controls|has)\s+fewer\s+(creatures|lands)\s+than\s+you$/i
    );
    if (oppFewer) {
      const subject = oppFewer[1].toLowerCase();
      const yourCount =
        subject === 'creatures'
          ? countByPermanentType(ctx, controllerId, 'creature')
          : countByPermanentType(ctx, controllerId, 'land');

      const opponentIds = getOpponentIds(ctx, controllerId);
      if (!opponentIds.length) return false;
      return opponentIds.some((oppId) => {
        const oppCount =
          subject === 'creatures'
            ? countByPermanentType(ctx, oppId, 'creature')
            : countByPermanentType(ctx, oppId, 'land');
        return oppCount < yourCount;
      });
    }

    const noOppFewer = clause.match(
      /^if\s+no\s+opponent\s+(?:controls|has)\s+fewer\s+(creatures|lands)\s+than\s+you$/i
    );
    if (noOppFewer) {
      const subject = noOppFewer[1].toLowerCase();
      const yourCount =
        subject === 'creatures'
          ? countByPermanentType(ctx, controllerId, 'creature')
          : countByPermanentType(ctx, controllerId, 'land');

      const opponentIds = getOpponentIds(ctx, controllerId);
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          subject === 'creatures'
            ? countByPermanentType(ctx, oppId, 'creature')
            : countByPermanentType(ctx, oppId, 'land');
        return oppCount >= yourCount;
      });
    }
  }

  // "if you control fewer/more creatures/lands than an opponent" / "... than each opponent" / "... than each other player"
  {
    const m = clause.match(
      /^if\s+you\s+(?:control|have)\s+(fewer|more)\s+(creatures|lands)\s+than\s+(an\s+opponent|each\s+opponent|each\s+other\s+player)$/i
    );
    if (m) {
      const cmp = m[1].toLowerCase();
      const subject = m[2].toLowerCase();
      const scope = m[3].toLowerCase().replace(/\s+/g, ' ');

      const yourCount =
        subject === 'creatures'
          ? countByPermanentType(ctx, controllerId, 'creature')
          : countByPermanentType(ctx, controllerId, 'land');

      const opponentIds = getOpponentIds(ctx, controllerId);

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            subject === 'creatures'
              ? countByPermanentType(ctx, oppId, 'creature')
              : countByPermanentType(ctx, oppId, 'land');
          return cmp === 'fewer' ? yourCount < oppCount : yourCount > oppCount;
        });
      }

      // "each opponent" / "each other player" (for "you" these are equivalent)
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          subject === 'creatures'
            ? countByPermanentType(ctx, oppId, 'creature')
            : countByPermanentType(ctx, oppId, 'land');
        return cmp === 'fewer' ? yourCount < oppCount : yourCount > oppCount;
      });
    }
  }

  // "if you control no more/no fewer creatures/lands than an opponent" / "... than each opponent" / "... than each other player"
  {
    const m = clause.match(
      /^if\s+you\s+(?:control|have)\s+no\s+(more|fewer|less)\s+(creatures|lands)\s+than\s+(an\s+opponent|each\s+opponent|each\s+other\s+player)$/i
    );
    if (m) {
      const cmpWord = m[1].toLowerCase();
      const subject = m[2].toLowerCase();
      const scope = m[3].toLowerCase().replace(/\s+/g, ' ');

      const yourCount =
        subject === 'creatures'
          ? countByPermanentType(ctx, controllerId, 'creature')
          : countByPermanentType(ctx, controllerId, 'land');

      const opponentIds = getOpponentIds(ctx, controllerId);
      const satisfies = (a: number, b: number) => (cmpWord === 'more' ? a <= b : a >= b);

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            subject === 'creatures'
              ? countByPermanentType(ctx, oppId, 'creature')
              : countByPermanentType(ctx, oppId, 'land');
          return satisfies(yourCount, oppCount);
        });
      }

      // "each opponent" / "each other player" (for "you" these are equivalent)
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          subject === 'creatures'
            ? countByPermanentType(ctx, oppId, 'creature')
            : countByPermanentType(ctx, oppId, 'land');
        return satisfies(yourCount, oppCount);
      });
    }
  }

  // "if you control as many / at least as many creatures/lands as an opponent" / "... as each opponent" / "... as each other player"
  {
    const m = clause.match(
      /^if\s+you\s+(?:control|have)\s+(as\s+many|at\s+least\s+as\s+many|at\s+most\s+as\s+many)\s+(creatures|lands)\s+as\s+(an\s+opponent|each\s+opponent|each\s+other\s+player)$/i
    );
    if (m) {
      const cmpRaw = m[1].toLowerCase().replace(/\s+/g, ' ');
      const subject = m[2].toLowerCase();
      const scope = m[3].toLowerCase().replace(/\s+/g, ' ');

      const cmpKind: 'eq' | 'gte' | 'lte' = cmpRaw.startsWith('at least')
        ? 'gte'
        : cmpRaw.startsWith('at most')
          ? 'lte'
          : 'eq';

      const yourCount =
        subject === 'creatures'
          ? countByPermanentType(ctx, controllerId, 'creature')
          : countByPermanentType(ctx, controllerId, 'land');

      const opponentIds = getOpponentIds(ctx, controllerId);

      const satisfies = (a: number, b: number) =>
        cmpKind === 'gte' ? a >= b : cmpKind === 'lte' ? a <= b : a === b;

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            subject === 'creatures'
              ? countByPermanentType(ctx, oppId, 'creature')
              : countByPermanentType(ctx, oppId, 'land');
          return satisfies(yourCount, oppCount);
        });
      }

      // "each opponent" / "each other player" (for "you" these are equivalent)
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          subject === 'creatures'
            ? countByPermanentType(ctx, oppId, 'creature')
            : countByPermanentType(ctx, oppId, 'land');
        return satisfies(yourCount, oppCount);
      });
    }
  }

  // "if you have fewer/more cards in hand/graveyard/library than an opponent" / "... than each opponent" / "... than each other player"
  {
    const m = clause.match(
      /^if\s+you\s+have\s+(fewer|less|more)\s+cards?\s+in\s+(?:your\s+)?(hand|graveyard|library)\s+than\s+(an\s+opponent|each\s+opponent|each\s+other\s+player)$/i
    );
    if (m) {
      const cmp = m[1].toLowerCase();
      const zone = m[2].toLowerCase();
      const scope = m[3].toLowerCase().replace(/\s+/g, ' ');

      const yourCount =
        zone === 'hand'
          ? getHandCount(ctx, controllerId)
          : zone === 'graveyard'
            ? getGraveyardCount(ctx, controllerId)
            : getLibraryCount(ctx, controllerId);
      const opponentIds = getOpponentIds(ctx, controllerId);

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            zone === 'hand'
              ? getHandCount(ctx, oppId)
              : zone === 'graveyard'
                ? getGraveyardCount(ctx, oppId)
                : getLibraryCount(ctx, oppId);
          return cmp === 'more' ? yourCount > oppCount : yourCount < oppCount;
        });
      }

      // "each opponent" / "each other player" (for "you" these are equivalent)
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          zone === 'hand'
            ? getHandCount(ctx, oppId)
            : zone === 'graveyard'
              ? getGraveyardCount(ctx, oppId)
              : getLibraryCount(ctx, oppId);
        return cmp === 'more' ? yourCount > oppCount : yourCount < oppCount;
      });
    }
  }

  // "if you have no more/no fewer cards in hand/graveyard/library than an opponent" / "... than each opponent" / "... than each other player"
  {
    const m = clause.match(
      /^if\s+you\s+have\s+no\s+(more|fewer|less)\s+cards?\s+in\s+(?:your\s+)?(hand|graveyard|library)\s+than\s+(an\s+opponent|each\s+opponent|each\s+other\s+player)$/i
    );
    if (m) {
      const cmpWord = m[1].toLowerCase();
      const zone = m[2].toLowerCase();
      const scope = m[3].toLowerCase().replace(/\s+/g, ' ');

      const yourCount =
        zone === 'hand'
          ? getHandCount(ctx, controllerId)
          : zone === 'graveyard'
            ? getGraveyardCount(ctx, controllerId)
            : getLibraryCount(ctx, controllerId);

      const opponentIds = getOpponentIds(ctx, controllerId);
      const satisfies = (a: number, b: number) => (cmpWord === 'more' ? a <= b : a >= b);

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            zone === 'hand'
              ? getHandCount(ctx, oppId)
              : zone === 'graveyard'
                ? getGraveyardCount(ctx, oppId)
                : getLibraryCount(ctx, oppId);
          return satisfies(yourCount, oppCount);
        });
      }

      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          zone === 'hand'
            ? getHandCount(ctx, oppId)
            : zone === 'graveyard'
              ? getGraveyardCount(ctx, oppId)
              : getLibraryCount(ctx, oppId);
        return satisfies(yourCount, oppCount);
      });
    }
  }

  // Superlatives: zone sizes (ties count)
  // - "if you have the most cards in hand/graveyard/library"
  // - "if you have the least/fewest cards in hand/graveyard/library"
  // - Optional: "... or are tied for ..."
  {
    const m = clause.match(
      /^if\s+you\s+have\s+the\s+(most|least|fewest)\s+cards?\s+in\s+(?:your\s+)?(hand|graveyard|library)(?:\s+or\s+are\s+tied\s+for\s+(?:the\s+)?\1\s+cards?\s+in\s+(?:your\s+)?\2)?$/i
    );
    if (m) {
      const kind = m[1].toLowerCase();
      const zone = m[2].toLowerCase();
      const ids = getAllPlayerIds(ctx, controllerId);
      if (!ids.length) return null;

      const getCount = (pid: string) =>
        zone === 'hand'
          ? getHandCount(ctx, pid)
          : zone === 'graveyard'
            ? getGraveyardCount(ctx, pid)
            : getLibraryCount(ctx, pid);

      const yourCount = getCount(controllerId);
      if (kind === 'most') return ids.every((pid) => getCount(pid) <= yourCount);
      return ids.every((pid) => getCount(pid) >= yourCount);
    }

    const m2 = clause.match(
      /^if\s+you\s+(?:are|have)\s+tied\s+for\s+(?:the\s+)?(most|least|fewest)\s+cards?\s+in\s+(?:your\s+)?(hand|graveyard|library)$/i
    );
    if (m2) {
      const kind = m2[1].toLowerCase();
      const extreme: 'most' | 'least' = kind === 'most' ? 'most' : 'least';
      const zone = m2[2].toLowerCase();
      const ids = getAllPlayerIds(ctx, controllerId);
      if (!ids.length) return null;

      const getCount = (pid: string) =>
        zone === 'hand'
          ? getHandCount(ctx, pid)
          : zone === 'graveyard'
            ? getGraveyardCount(ctx, pid)
            : getLibraryCount(ctx, pid);

      return isTiedForExtreme(ids, controllerId, getCount, extreme);
    }
  }

  // "if you have as many / at least as many cards in hand/graveyard/library as an opponent" / "... as each opponent" / "... as each other player"
  {
    const m = clause.match(
      /^if\s+you\s+have\s+(as\s+many|at\s+least\s+as\s+many|at\s+most\s+as\s+many)\s+cards?\s+in\s+(?:your\s+)?(hand|graveyard|library)\s+as\s+(an\s+opponent|each\s+opponent|each\s+other\s+player)$/i
    );
    if (m) {
      const cmpRaw = m[1].toLowerCase().replace(/\s+/g, ' ');
      const zone = m[2].toLowerCase();
      const scope = m[3].toLowerCase().replace(/\s+/g, ' ');

      const cmpKind: 'eq' | 'gte' | 'lte' = cmpRaw.startsWith('at least')
        ? 'gte'
        : cmpRaw.startsWith('at most')
          ? 'lte'
          : 'eq';

      const yourCount =
        zone === 'hand'
          ? getHandCount(ctx, controllerId)
          : zone === 'graveyard'
            ? getGraveyardCount(ctx, controllerId)
            : getLibraryCount(ctx, controllerId);

      const opponentIds = getOpponentIds(ctx, controllerId);
      const satisfies = (a: number, b: number) =>
        cmpKind === 'gte' ? a >= b : cmpKind === 'lte' ? a <= b : a === b;

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            zone === 'hand'
              ? getHandCount(ctx, oppId)
              : zone === 'graveyard'
                ? getGraveyardCount(ctx, oppId)
                : getLibraryCount(ctx, oppId);
          return satisfies(yourCount, oppCount);
        });
      }

      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          zone === 'hand'
            ? getHandCount(ctx, oppId)
            : zone === 'graveyard'
              ? getGraveyardCount(ctx, oppId)
              : getLibraryCount(ctx, oppId);
        return satisfies(yourCount, oppCount);
      });
    }
  }

  // "if an opponent controls/has as many / at least as many creatures/lands as you" / "if no opponent controls/has ... as you"
  {
    const m = clause.match(
      /^if\s+(no\s+opponent|an\s+opponent)\s+(?:controls|has)\s+(as\s+many|at\s+least\s+as\s+many|at\s+most\s+as\s+many)\s+(creatures|lands)\s+as\s+you$/i
    );
    if (m) {
      const scope = m[1].toLowerCase().replace(/\s+/g, ' ');
      const cmpRaw = m[2].toLowerCase().replace(/\s+/g, ' ');
      const subject = m[3].toLowerCase();

      const cmpKind: 'eq' | 'gte' | 'lte' = cmpRaw.startsWith('at least')
        ? 'gte'
        : cmpRaw.startsWith('at most')
          ? 'lte'
          : 'eq';

      const yourCount =
        subject === 'creatures'
          ? countByPermanentType(ctx, controllerId, 'creature')
          : countByPermanentType(ctx, controllerId, 'land');

      const opponentIds = getOpponentIds(ctx, controllerId);
      const satisfies = (oppCount: number) =>
        cmpKind === 'gte' ? oppCount >= yourCount : cmpKind === 'lte' ? oppCount <= yourCount : oppCount === yourCount;

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            subject === 'creatures'
              ? countByPermanentType(ctx, oppId, 'creature')
              : countByPermanentType(ctx, oppId, 'land');
          return satisfies(oppCount);
        });
      }

      // "no opponent" => universal negation (vacuously true if there are no opponents)
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          subject === 'creatures'
            ? countByPermanentType(ctx, oppId, 'creature')
            : countByPermanentType(ctx, oppId, 'land');
        return !satisfies(oppCount);
      });
    }
  }

  // "if an opponent has as many / at least as many cards in hand/graveyard/library as you" / "if no opponent has ... as you"
  {
    const m = clause.match(
      /^if\s+(no\s+opponent|an\s+opponent)\s+has\s+(as\s+many|at\s+least\s+as\s+many|at\s+most\s+as\s+many)\s+cards?\s+in\s+(?:their\s+)?(hand|graveyard|library)\s+as\s+you$/i
    );
    if (m) {
      const scope = m[1].toLowerCase().replace(/\s+/g, ' ');
      const cmpRaw = m[2].toLowerCase().replace(/\s+/g, ' ');
      const zone = m[3].toLowerCase();

      const cmpKind: 'eq' | 'gte' | 'lte' = cmpRaw.startsWith('at least')
        ? 'gte'
        : cmpRaw.startsWith('at most')
          ? 'lte'
          : 'eq';

      const yourCount =
        zone === 'hand'
          ? getHandCount(ctx, controllerId)
          : zone === 'graveyard'
            ? getGraveyardCount(ctx, controllerId)
            : getLibraryCount(ctx, controllerId);

      const opponentIds = getOpponentIds(ctx, controllerId);
      const satisfies = (oppCount: number) =>
        cmpKind === 'gte' ? oppCount >= yourCount : cmpKind === 'lte' ? oppCount <= yourCount : oppCount === yourCount;

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            zone === 'hand'
              ? getHandCount(ctx, oppId)
              : zone === 'graveyard'
                ? getGraveyardCount(ctx, oppId)
                : getLibraryCount(ctx, oppId);
          return satisfies(oppCount);
        });
      }

      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          zone === 'hand'
            ? getHandCount(ctx, oppId)
            : zone === 'graveyard'
              ? getGraveyardCount(ctx, oppId)
              : getLibraryCount(ctx, oppId);
        return !satisfies(oppCount);
      });
    }
  }

  // "if an opponent/no opponent controls/has no more/no fewer creatures/lands than you"
  {
    const m = clause.match(
      /^if\s+(no\s+opponent|an\s+opponent)\s+(?:controls|has)\s+no\s+(more|fewer|less)\s+(creatures|lands)\s+than\s+you$/i
    );
    if (m) {
      const scope = m[1].toLowerCase().replace(/\s+/g, ' ');
      const cmpWord = m[2].toLowerCase();
      const subject = m[3].toLowerCase();

      const yourCount =
        subject === 'creatures'
          ? countByPermanentType(ctx, controllerId, 'creature')
          : countByPermanentType(ctx, controllerId, 'land');

      const opponentIds = getOpponentIds(ctx, controllerId);
      const satisfies = (oppCount: number) => (cmpWord === 'more' ? oppCount <= yourCount : oppCount >= yourCount);

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            subject === 'creatures'
              ? countByPermanentType(ctx, oppId, 'creature')
              : countByPermanentType(ctx, oppId, 'land');
          return satisfies(oppCount);
        });
      }

      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          subject === 'creatures'
            ? countByPermanentType(ctx, oppId, 'creature')
            : countByPermanentType(ctx, oppId, 'land');
        return !satisfies(oppCount);
      });
    }
  }

  // "if an opponent/no opponent has no more/no fewer cards in hand/graveyard/library than you"
  {
    const m = clause.match(
      /^if\s+(no\s+opponent|an\s+opponent)\s+has\s+no\s+(more|fewer|less)\s+cards?\s+in\s+(?:their\s+)?(hand|graveyard|library)\s+than\s+you$/i
    );
    if (m) {
      const scope = m[1].toLowerCase().replace(/\s+/g, ' ');
      const cmpWord = m[2].toLowerCase();
      const zone = m[3].toLowerCase();

      const yourCount =
        zone === 'hand'
          ? getHandCount(ctx, controllerId)
          : zone === 'graveyard'
            ? getGraveyardCount(ctx, controllerId)
            : getLibraryCount(ctx, controllerId);

      const opponentIds = getOpponentIds(ctx, controllerId);
      const satisfies = (oppCount: number) => (cmpWord === 'more' ? oppCount <= yourCount : oppCount >= yourCount);

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            zone === 'hand'
              ? getHandCount(ctx, oppId)
              : zone === 'graveyard'
                ? getGraveyardCount(ctx, oppId)
                : getLibraryCount(ctx, oppId);
          return satisfies(oppCount);
        });
      }

      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          zone === 'hand'
            ? getHandCount(ctx, oppId)
            : zone === 'graveyard'
              ? getGraveyardCount(ctx, oppId)
              : getLibraryCount(ctx, oppId);
        return !satisfies(oppCount);
      });
    }
  }

  // "if an opponent has fewer/more cards in hand/graveyard/library than you" / "if no opponent has fewer/more ... than you"
  {
    const m = clause.match(
      /^if\s+(no\s+opponent|an\s+opponent)\s+has\s+(fewer|less|more)\s+cards?\s+in\s+(?:their\s+)?(hand|graveyard|library)\s+than\s+you$/i
    );
    if (m) {
      const scope = m[1].toLowerCase().replace(/\s+/g, ' ');
      const cmp = m[2].toLowerCase();
      const zone = m[3].toLowerCase();

      const yourCount =
        zone === 'hand'
          ? getHandCount(ctx, controllerId)
          : zone === 'graveyard'
            ? getGraveyardCount(ctx, controllerId)
            : getLibraryCount(ctx, controllerId);

      const opponentIds = getOpponentIds(ctx, controllerId);

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => {
          const oppCount =
            zone === 'hand'
              ? getHandCount(ctx, oppId)
              : zone === 'graveyard'
                ? getGraveyardCount(ctx, oppId)
                : getLibraryCount(ctx, oppId);
          return cmp === 'more' ? oppCount > yourCount : oppCount < yourCount;
        });
      }

      // "no opponent" => universal negation (vacuously true if there are no opponents)
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => {
        const oppCount =
          zone === 'hand'
            ? getHandCount(ctx, oppId)
            : zone === 'graveyard'
              ? getGraveyardCount(ctx, oppId)
              : getLibraryCount(ctx, oppId);

        return cmp === 'more' ? oppCount <= yourCount : oppCount >= yourCount;
      });
    }
  }

  // Opponent numeric zone thresholds
  // - "if an opponent has at least/at most/no more/no fewer than N cards in hand/graveyard/library"
  // - "if each opponent has ..."
  // - "if no opponent has ..." (universal negation, vacuously true if no opponents)
  {
    const m = clause.match(
      /^if\s+(an\s+opponent|each\s+opponent|each\s+other\s+player|no\s+opponent)\s+has\s+(at\s+least|at\s+most|no\s+more\s+than|no\s+(?:fewer|less)\s+than)\s+([a-z0-9]+)\s+cards?\s+in\s+(?:their\s+)?(hand|graveyard|library)$/i
    );
    if (m) {
      const scope = m[1].toLowerCase().replace(/\s+/g, ' ');
      const cmpRaw = m[2].toLowerCase().replace(/\s+/g, ' ');
      const n = parseCountToken(m[3]);
      if (n === null) return null;
      const zone = m[4].toLowerCase();

      const opponentIds = getOpponentIds(ctx, controllerId);

      const satisfies = (oppId: string) => {
        const oppCount =
          zone === 'hand'
            ? getHandCount(ctx, oppId)
            : zone === 'graveyard'
              ? getGraveyardCount(ctx, oppId)
              : getLibraryCount(ctx, oppId);

        if (cmpRaw === 'at least' || cmpRaw.startsWith('no fewer') || cmpRaw.startsWith('no less')) return oppCount >= n;
        return oppCount <= n;
      };

      if (scope === 'an opponent') {
        if (!opponentIds.length) return false;
        return opponentIds.some((oppId) => satisfies(oppId));
      }

      if (scope === 'no opponent') {
        if (!opponentIds.length) return true;
        return opponentIds.every((oppId) => !satisfies(oppId));
      }

      // "each opponent" / "each other player" (for "you" these are equivalent)
      if (!opponentIds.length) return true;
      return opponentIds.every((oppId) => satisfies(oppId));
    }
  }

  // "if you attacked this turn" (Raid and similar)
  if (/^if\s+you\s+attacked\s+this\s+turn$/i.test(clause)) {
    return didPlayerAttackThisTurn(ctx, controllerId);
  }

  // "if you didn't attack with a creature this turn" / "if you did not attack with a creature this turn"
  if (
    /^if\s+you\s+did\s+not\s+attack\s+with\s+a\s+creature\s+this\s+turn$/i.test(clause) ||
    /^if\s+you\s+didn't\s+attack\s+with\s+a\s+creature\s+this\s+turn$/i.test(clause)
  ) {
    return !didPlayerAttackThisTurn(ctx, controllerId);
  }

  // "if no creatures attacked this turn"
  if (/^if\s+no\s+creatures\s+attacked\s+this\s+turn$/i.test(clause)) {
    return !anyCreatureAttackedThisTurn(ctx);
  }

  // "if a Pirate and a Vehicle attacked this combat" (best-effort via current attackers)
  if (/^if\s+a\s+pirate\s+and\s+a\s+vehicle\s+attacked\s+this\s+combat$/i.test(clause)) {
    const attackers = getAttackingCreatures(ctx, controllerId);
    if (!attackers.length) return false;

    let foundPirate = false;
    let foundVehicle = false;
    let sawUnknown = false;
    for (const a of attackers) {
      const tl = String(a?.card?.type_line || '').toLowerCase();
      if (!tl) {
        sawUnknown = true;
        continue;
      }
      if (tl.includes('pirate')) foundPirate = true;
      if (tl.includes('vehicle')) foundVehicle = true;
    }

    if (foundPirate && foundVehicle) return true;
    return sawUnknown ? null : false;
  }

  // "if Kytheon and at least two other creatures attacked this combat" (best-effort via current attackers)
  if (/^if\s+kytheon\s+and\s+at\s+least\s+two\s+other\s+creatures\s+attacked\s+this\s+combat$/i.test(clause)) {
    const attackers = getAttackingCreatures(ctx, controllerId);
    if (attackers.length < 3) return false;

    let sawUnknownName = false;
    for (const a of attackers) {
      const name = String(a?.card?.name || '').trim();
      if (!name) {
        sawUnknownName = true;
        continue;
      }
      if (name.toLowerCase().startsWith('kytheon')) return true;
    }

    return sawUnknownName ? null : false;
  }

  // "if this creature didn't attack this turn" (best-effort)
  if (/^if\s+this\s+creature\s+did\s+not\s+attack\s+this\s+turn$/i.test(clause) || /^if\s+this\s+creature\s+didn't\s+attack\s+this\s+turn$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const attacked = (sourcePermanent as any).attackedThisTurn === true || !!(sourcePermanent as any).attacking || (sourcePermanent as any).isAttacking === true;
    return !attacked;
  }

  // "if this creature attacked this turn" (best-effort)
  if (/^if\s+this\s+creature\s+attacked\s+this\s+turn$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const hasInfo =
      'attackedThisTurn' in (sourcePermanent as any) ||
      'attacking' in (sourcePermanent as any) ||
      'isAttacking' in (sourcePermanent as any);
    if (!hasInfo) return null;
    const attacked = (sourcePermanent as any).attackedThisTurn === true || !!(sourcePermanent as any).attacking || (sourcePermanent as any).isAttacking === true;
    return attacked;
  }

  // "if <Name> attacked this turn" (best-effort; assumes <Name> refers to the source permanent)
  {
    const m = clause.match(/^if\s+(.+?)\s+attacked\s+this\s+turn$/i);
    if (m) {
      const nameToken = String(m[1] || '').trim();
      if (!nameToken) return null;
      if (/^(?:you|this\s+creature|it)$/i.test(nameToken)) return UNMATCHED_INTERVENING_IF;
      if (!sourcePermanent) return null;

      const cardName = String((sourcePermanent as any)?.card?.name || '').trim();
      if (!cardName) return null;
      if (!cardName.toLowerCase().startsWith(nameToken.toLowerCase())) return null;

      const hasInfo =
        'attackedThisTurn' in (sourcePermanent as any) ||
        'attacking' in (sourcePermanent as any) ||
        'isAttacking' in (sourcePermanent as any);
      if (!hasInfo) return null;
      return (sourcePermanent as any).attackedThisTurn === true || !!(sourcePermanent as any).attacking || (sourcePermanent as any).isAttacking === true;
    }
  }

  // "if this creature attacked or blocked this turn" (best-effort)
  if (/^if\s+this\s+creature\s+attacked\s+or\s+blocked\s+this\s+turn$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const hasInfo =
      'attackedThisTurn' in (sourcePermanent as any) ||
      'attacking' in (sourcePermanent as any) ||
      'isAttacking' in (sourcePermanent as any) ||
      'blockedThisTurn' in (sourcePermanent as any) ||
      'blocking' in (sourcePermanent as any) ||
      'isBlocking' in (sourcePermanent as any);
    if (!hasInfo) return null;
    const attacked = (sourcePermanent as any).attackedThisTurn === true || !!(sourcePermanent as any).attacking || (sourcePermanent as any).isAttacking === true;
    const blocked = (sourcePermanent as any).blockedThisTurn === true || !!(sourcePermanent as any).blocking || (sourcePermanent as any).isBlocking === true;
    return attacked || blocked;
  }

  // "if it was blocked this turn" (best-effort; only returns true on positive evidence)
  if (/^if\s+it\s+was\s+blocked\s+this\s+turn$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const v = (sourcePermanent as any).blockedThisTurn ?? (sourcePermanent as any).wasBlockedThisTurn ?? (sourcePermanent as any).card?.blockedThisTurn;
    if (typeof v === 'boolean') return v;
    // In-combat evidence: if it is currently blocked, it must have been blocked this turn.
    if (isPermanentBlocked(sourcePermanent)) return true;
    return null;
  }

  // "if this Vehicle attacked or blocked this combat" (best-effort)
  if (/^if\s+this\s+vehicle\s+attacked\s+or\s+blocked\s+this\s+combat$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const hasInfo =
      'attackedThisTurn' in (sourcePermanent as any) ||
      'attacking' in (sourcePermanent as any) ||
      'isAttacking' in (sourcePermanent as any) ||
      'blockedThisTurn' in (sourcePermanent as any) ||
      'blocking' in (sourcePermanent as any) ||
      'isBlocking' in (sourcePermanent as any);
    if (!hasInfo) return null;
    const attacked = (sourcePermanent as any).attackedThisTurn === true || !!(sourcePermanent as any).attacking || (sourcePermanent as any).isAttacking === true;
    const blocked = (sourcePermanent as any).blockedThisTurn === true || !!(sourcePermanent as any).blocking || (sourcePermanent as any).isBlocking === true;
    return attacked || blocked;
  }

  // "if your team controls another Warrior" (team-aware; falls back to a singleton team when no team data exists)
  if (/^if\s+your\s+team\s+controls\s+another\s+warrior$/i.test(clause)) {
    const teamIds = getTeamMemberIds(ctx, controllerId);
    const battlefield = (ctx as any).state?.battlefield || [];
    const sourceId = String((sourcePermanent as any)?.id || '');

    let count = 0;
    for (const pid of teamIds) {
      const creatures = getControlledCreatures(ctx, String(pid));
      for (const c of creatures) {
        if (!c) continue;
        if (sourceId && String(c.id) === sourceId) continue;
        const tl = String(c?.card?.type_line || '');
        if (typeLineHasWord(tl, 'warrior')) count++;
      }
    }

    // If we have battlefield tracking, we can safely return false when count is 0.
    // If battlefield isn't an array (corrupt state), be conservative.
    if (!Array.isArray(battlefield)) return null;
    return count >= 1;
  }

  // "if a creature died this turn" (Morbid)
  if (/^if\s+a\s+creature\s+died\s+this\s+turn$/i.test(clause)) {
    const v = isCreatureDiedThisTurn(ctx);
    return v;
  }

  // "if no creatures died this turn" (best-effort: only global boolean is tracked)
  if (/^if\s+no\s+creatures\s+died\s+this\s+turn$/i.test(clause)) {
    const v = isCreatureDiedThisTurn(ctx);
    return v === null ? null : !v;
  }

  // "if a creature died under your control this turn" (best-effort: only global boolean is tracked)
  if (/^if\s+a\s+creature\s+died\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {
    const n = getCreaturesDiedThisTurnByController(ctx, controllerId);
    if (typeof n === 'number') return n > 0;

    const v = isCreatureDiedThisTurn(ctx);
    if (v === false) return false;
    return null;
  }

  // "if N or more creatures died under your control this turn" (best-effort)
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+creatures\s+died\s+under\s+your\s+control\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const byController = getCreaturesDiedThisTurnByController(ctx, controllerId);
      if (typeof byController === 'number') return byController >= n;

      const v = isCreatureDiedThisTurn(ctx);
      if (v === false) return false;
      if (v === null) return null;
      if (n <= 1) return true;
      return null;
    }
  }

  // "if N or more creatures died this turn" (best-effort: only global boolean is tracked)
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+creatures\s+died\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const total = getCreaturesDiedThisTurnTotal(ctx);
      if (typeof total === 'number') return total >= n;

      const v = isCreatureDiedThisTurn(ctx);
      if (v === false) return false;
      if (v === null) return null;
      if (n <= 1) return true;
      return null;
    }
  }

  // "if an opponent lost N or more life this turn"
  {
    const m = clause.match(/^if\s+an\s+opponent\s+lost\s+([a-z0-9]+)\s+or\s+more\s+life\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const opps = getOpponentIds(ctx, controllerId);
      return opps.some((oid) => getLifeLostThisTurn(ctx, oid) >= n);
    }
  }

  // "if a player lost N or more life this turn" (any player)
  {
    const m = clause.match(/^if\s+a\s+player\s+lost\s+([a-z0-9]+)\s+or\s+more\s+life\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const map = (ctx as any).state?.lifeLostThisTurn;
      if (!map || typeof map !== 'object') return null;
      const playerIds = getAllPlayerIds(ctx, controllerId);
      const ids = playerIds.length ? playerIds : Object.keys(map).map(String);
      return ids.some((pid) => {
        const v = (map as any)[pid];
        return typeof v === 'number' && v >= n;
      });
    }
  }

  // "if a player has more life than each other player" (life leader)
  if (/^if\s+a\s+player\s+has\s+more\s+life\s+than\s+each\s+other\s+player$/i.test(clause)) {
    const life = (ctx as any).state?.life;
    if (!life || typeof life !== 'object') return null;
    const ids = getAllPlayerIds(ctx, controllerId);
    if (!ids.length) return null;

    for (const pid of ids) {
      const v = (life as any)[pid];
      if (typeof v !== 'number') continue;
      const isLeader = ids.every((other) => {
        if (other === pid) return true;
        const ov = (life as any)[other];
        return typeof ov === 'number' ? v > ov : true;
      });
      if (isLeader) return true;
    }
    return false;
  }

  // "if it's your main phase"
  if (/^if\s+it'?s\s+your\s+main\s+phase$/i.test(clause) || /^if\s+it\s+is\s+your\s+main\s+phase$/i.test(clause)) {
    const active = getActivePlayerId(ctx);
    if (!active) return null;
    if (String(active) !== String(controllerId)) return false;
    const phase = String((ctx as any).state?.phase || (ctx as any).state?.turn?.phase || '').toLowerCase();
    if (!phase) return null;
    return phase.includes('main');
  }

  // "if a permanent you controlled left the battlefield this turn" (Revolt)
  if (/^if\s+a\s+permanent\s+you\s+controlled\s+left\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {
    return didPermanentLeaveBattlefieldThisTurn(ctx, controllerId);
  }

  // Alternate Revolt phrasing: "if a permanent left the battlefield under your control this turn"
  if (/^if\s+(?:one\s+or\s+more\s+)?a\s+permanent\s+left\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {
    return didPermanentLeaveBattlefieldThisTurn(ctx, controllerId);
  }

  // "if no permanents left the battlefield this turn" (best-effort; needs per-player tracking)
  if (/^if\s+no\s+permanents\s+left\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {
    const stateAny: any = (ctx as any).state || {};
    const players = Array.isArray(stateAny.players) ? stateAny.players : [];
    const ids = players.map((p: any) => String(p?.id || '')).filter(Boolean);
    if (!ids.length) return null;

    let unknown = false;
    for (const pid of ids) {
      const v = didPermanentLeaveBattlefieldThisTurn(ctx, pid);
      if (v === true) return false;
      if (v === null) unknown = true;
    }
    return unknown ? null : true;
  }

  // "if a nonland permanent left the battlefield this turn or a spell was warped this turn" (best-effort)
  if (/^if\s+a\s+nonland\s+permanent\s+left\s+the\s+battlefield\s+this\s+turn\s+or\s+a\s+spell\s+was\s+warped\s+this\s+turn$/i.test(clause)) {
    const left = didPermanentLeaveBattlefieldThisTurn(ctx, controllerId);
    const warpedMap = (ctx as any).state?.spellWasWarpedThisTurn;
    const warped = warpedMap?.[controllerId];
    const warpedBool = typeof warped === "boolean" ? warped : null;

    if (left === true || warpedBool === true) return true;
    if (left === false && warpedBool === false) return false;
    return null;
  }

  // "if you descended this turn" (best-effort: requires a per-turn flag)
  if (/^if\s+you\s+descended\s+this\s+turn$/i.test(clause)) {
    const map = (ctx as any).state?.descendedThisTurn;
    const v = map?.[controllerId] ?? (ctx as any).state?.descended;
    return typeof v === "boolean" ? v : null;
  }

  // "if you attacked with N or more creatures this turn" (Planechase and similar)
  {
    const m = clause.match(/^if\s+you\s+attacked\s+with\s+([a-z0-9]+)\s+or\s+more\s+creatures\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getCreaturesAttackedThisTurnCount(ctx, controllerId) >= n;
    }
  }

  // ===== Zone thresholds (graveyard/library) =====

  // "if you have no cards in your library"
  if (/^if\s+you\s+have\s+no\s+cards\s+in\s+your\s+library$/i.test(clause)) {
    return getLibraryCount(ctx, controllerId) === 0;
  }

  // "if there are N or more creature cards in your graveyard"
  {
    const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+creature\s+cards\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return countCreatureCardsInGraveyard(ctx, controllerId) >= n;
    }
  }

  // "if there are no creature cards in your graveyard"
  if (/^if\s+there\s+are\s+no\s+creature\s+cards\s+in\s+your\s+graveyard$/i.test(clause)) {
    return countCreatureCardsInGraveyard(ctx, controllerId) === 0;
  }

  // "if you have N or more creature cards in your graveyard"
  {
    const m = clause.match(/^if\s+you\s+have\s+([a-z0-9]+)\s+or\s+more\s+creature\s+cards\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return countCreatureCardsInGraveyard(ctx, controllerId) >= n;
    }
  }

  // "if there are N or more permanent cards in your graveyard"
  {
    const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+permanent\s+cards\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return countPermanentCardsInGraveyard(ctx, controllerId) >= n;
    }
  }

  // "if you have N or more permanent cards in your graveyard"
  {
    const m = clause.match(/^if\s+you\s+have\s+([a-z0-9]+)\s+or\s+more\s+permanent\s+cards\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return countPermanentCardsInGraveyard(ctx, controllerId) >= n;
    }
  }

  // ===== Cast-modification flags (kicker/foretell etc.) =====
  // "if you cast it" / "if you cast this spell" (often on ETB triggers)
  if (/^if\s+you\s+cast\s+(?:it|this\s+spell)$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const direct = (sourcePermanent as any)?.enteredFromCast ?? (sourcePermanent as any)?.wasCast ?? (sourcePermanent as any)?.card?.enteredFromCast ?? (sourcePermanent as any)?.card?.wasCast;
    if (typeof direct === 'boolean') return direct;
    // If we at least know the source zone of the cast, that's enough to conclude it was cast.
    const sourceZone = (sourcePermanent as any)?.castSourceZone ?? (sourcePermanent as any)?.source ?? (sourcePermanent as any)?.card?.castSourceZone ?? (sourcePermanent as any)?.card?.source;
    if (typeof sourceZone === 'string' && sourceZone.length > 0) return true;
    const fromHand = (sourcePermanent as any)?.castFromHand ?? (sourcePermanent as any)?.card?.castFromHand;
    if (typeof fromHand === 'boolean') return true;
    return null;
  }

  // "if you cast it from your hand" / "if this spell was cast from your hand"
  if (
    /^if\s+you\s+cast\s+it\s+from\s+your\s+hand$/i.test(clause) ||
    /^if\s+this\s+spell\s+was\s+cast\s+from\s+your\s+hand$/i.test(clause)
  ) {
    if (!sourcePermanent) return null;
    const fromHand = (sourcePermanent as any)?.castFromHand ?? (sourcePermanent as any)?.card?.castFromHand;
    if (typeof fromHand === 'boolean') return fromHand;
    const sourceZone = (sourcePermanent as any)?.castSourceZone ?? (sourcePermanent as any)?.source ?? (sourcePermanent as any)?.card?.castSourceZone ?? (sourcePermanent as any)?.card?.source;
    if (typeof sourceZone === 'string') return String(sourceZone).toLowerCase() === 'hand';
    return null;
  }

  // "if you didn't cast it from your hand"
  if (/^if\s+you\s+didn't\s+cast\s+it\s+from\s+your\s+hand$/i.test(clause) || /^if\s+you\s+did\s+not\s+cast\s+it\s+from\s+your\s+hand$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const fromHand = (sourcePermanent as any)?.castFromHand ?? (sourcePermanent as any)?.card?.castFromHand;
    if (typeof fromHand === 'boolean') return !fromHand;
    const sourceZone = (sourcePermanent as any)?.castSourceZone ?? (sourcePermanent as any)?.source ?? (sourcePermanent as any)?.card?.castSourceZone ?? (sourcePermanent as any)?.card?.source;
    if (typeof sourceZone === 'string') return String(sourceZone).toLowerCase() !== 'hand';
    return null;
  }

  // "if it entered from your graveyard or you cast it from your graveyard" (best-effort)
  if (/^if\s+it\s+entered\s+from\s+your\s+graveyard\s+or\s+you\s+cast\s+it\s+from\s+your\s+graveyard$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const enteredFrom = (sourcePermanent as any)?.enteredFromZone ?? (sourcePermanent as any)?.card?.enteredFromZone;
    const castFrom = (sourcePermanent as any)?.castSourceZone ?? (sourcePermanent as any)?.source ?? (sourcePermanent as any)?.card?.castSourceZone ?? (sourcePermanent as any)?.card?.source;

    const okEntered = typeof enteredFrom === "string" && String(enteredFrom).toLowerCase() === "graveyard";
    const okCast = typeof castFrom === "string" && String(castFrom).toLowerCase() === "graveyard";
    if (okEntered || okCast) return true;

    if (typeof enteredFrom === "string" || typeof castFrom === "string") return false;
    return null;
  }

  // "if it was cast from your graveyard" / "if this spell was cast from your graveyard" (best-effort)
  if (/^if\s+(?:it|this\s+spell)\s+was\s+cast\s+from\s+your\s+graveyard$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const castFrom = (sourcePermanent as any)?.castSourceZone ?? (sourcePermanent as any)?.source ?? (sourcePermanent as any)?.card?.castSourceZone ?? (sourcePermanent as any)?.card?.source;
    if (typeof castFrom === 'string') return String(castFrom).toLowerCase() === 'graveyard';
    const v = (sourcePermanent as any)?.castFromGraveyard ?? (sourcePermanent as any)?.card?.castFromGraveyard;
    return typeof v === 'boolean' ? v : null;
  }

  // "if one or more of them entered from a graveyard or was cast from a graveyard" (needs plural-context tracking)
  if (/^if\s+([a-z0-9]+)\s+or\s+more\s+of\s+them\s+entered\s+from\s+a\s+graveyard\s+or\s+was\s+cast\s+from\s+a\s+graveyard$/i.test(clause)) {
    return null;
  }

  // "if one or more of them entered from exile or was cast from exile" (needs plural-context tracking)
  if (/^if\s+([a-z0-9]+)\s+or\s+more\s+of\s+them\s+entered\s+from\s+exile\s+or\s+was\s+cast\s+from\s+exile$/i.test(clause)) {
    return null;
  }

  // "if it was kicked"
  if (/^if\s+it\s+was\s+kicked$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const wasKicked = sourcePermanent?.wasKicked === true || sourcePermanent?.card?.wasKicked === true;
    return wasKicked;
  }

  // "if this creature wasn't kicked" / "if this creature was not kicked" (best-effort)
  if (/^if\s+this\s+creature\s+was\s+not\s+kicked$/i.test(clause) || /^if\s+this\s+creature\s+wasn'?t\s+kicked$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const v = (sourcePermanent as any)?.wasKicked ?? (sourcePermanent as any)?.card?.wasKicked;
    if (typeof v === 'boolean') return !v;
    return null;
  }

  // "if it was kicked with its {..} kicker" (recognize but we don't track which kicker)
  if (/^if\s+it\s+was\s+kicked\s+with\s+its\s+(?:\{[^}]+\})+\s+kicker$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const wasKicked = sourcePermanent?.wasKicked === true || sourcePermanent?.card?.wasKicked === true;
    return wasKicked ? true : null;
  }

  // "if it was bargained" (best-effort)
  if (/^if\s+it\s+was\s+bargained$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const v = (sourcePermanent as any)?.wasBargained ?? (sourcePermanent as any)?.card?.wasBargained;
    return typeof v === "boolean" ? v : null;
  }

  // "if it was cast" (best-effort)
  if (/^if\s+it\s+was\s+cast$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const v = (sourcePermanent as any)?.enteredFromCast ?? (sourcePermanent as any)?.wasCast ?? (sourcePermanent as any)?.card?.enteredFromCast ?? (sourcePermanent as any)?.card?.wasCast;
    return typeof v === "boolean" ? v : null;
  }

  // "if it/that spell was foretold"
  if (/^if\s+(?:it|that\s+spell)\s+was\s+foretold$/i.test(clause)) {
    return isCastFromForetell(sourcePermanent);
  }

  // "if {R} was spent to cast it" / "if red mana was spent to cast this spell" etc.
  {
    const m = clause.match(/^if\s+((?:\{[wubrg]\}){2,})\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const groups = Array.from(String(m[1]).matchAll(/\{([wubrg])\}/gi)).map((mm) => String(mm[1]).toLowerCase());
      if (!groups.length) return null;
      if (!groups.every((c) => c === groups[0])) return null;
      const normalized = normalizeColorToken(groups[0]);
      if (!normalized) return null;
      const breakdown = (sourcePermanent as any)?.manaSpentBreakdown ?? (sourcePermanent as any)?.card?.manaSpentBreakdown;
      if (!breakdown || typeof breakdown !== "object") return null;
      const amount = parseMaybeNumber((breakdown as any)[normalized]);
      if (amount === null) return null;
      return amount >= groups.length;
    }
  }
  {
    const m = clause.match(/^if\s+((?:\{c\}){2,})\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const groups = Array.from(String(m[1]).matchAll(/\{c\}/gi));
      if (!groups.length) return null;
      const breakdown = (sourcePermanent as any)?.manaSpentBreakdown ?? (sourcePermanent as any)?.card?.manaSpentBreakdown;
      if (!breakdown || typeof breakdown !== "object") return null;
      const amount = parseMaybeNumber((breakdown as any).colorless);
      if (amount === null) return null;
      return amount >= groups.length;
    }
  }
  {
    const m = clause.match(/^if\s+\{([wubrg])\}\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const color = normalizeColorToken(m[1]);
      if (!color) return null;
      const spent = getManaColorsSpentFromSource(sourcePermanent);
      if (!spent) return null;
      return spent.includes(color);
    }
  }
  {
    const m = clause.match(/^if\s+\{c\}\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const breakdown = (sourcePermanent as any)?.manaSpentBreakdown ?? (sourcePermanent as any)?.card?.manaSpentBreakdown;
      if (!breakdown || typeof breakdown !== "object") return null;
      const amount = parseMaybeNumber((breakdown as any).colorless);
      if (amount === null) return null;
      return amount > 0;
    }
  }
  {
    const m = clause.match(/^if\s+\{c\}\s+(?:wasn't|was\s+not)\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const breakdown = (sourcePermanent as any)?.manaSpentBreakdown ?? (sourcePermanent as any)?.card?.manaSpentBreakdown;
      if (!breakdown || typeof breakdown !== "object") return null;
      const amount = parseMaybeNumber((breakdown as any).colorless);
      if (amount === null) return null;
      return amount === 0;
    }
  }
  {
    const m = clause.match(/^if\s+((?:\{s\}){2,})\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      // We don't currently track snow-vs-nonsnow mana payment.
      return null;
    }
  }
  {
    const m = clause.match(/^if\s+\{s\}\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      // We don't currently track snow-vs-nonsnow mana payment.
      return null;
    }
  }
  {
    const m = clause.match(/^if\s+snow\s+mana\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      // We don't currently track snow-vs-nonsnow mana payment.
      return null;
    }
  }
  {
    const m = clause.match(/^if\s+(white|blue|black|red|green)\s+mana\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const color = normalizeColorToken(m[1]);
      if (!color) return null;
      const spent = getManaColorsSpentFromSource(sourcePermanent);
      if (!spent) return null;
      return spent.includes(color);
    }
  }
  {
    const m = clause.match(/^if\s+colorless\s+mana\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const breakdown = (sourcePermanent as any)?.manaSpentBreakdown ?? (sourcePermanent as any)?.card?.manaSpentBreakdown;
      if (!breakdown || typeof breakdown !== "object") return null;
      const amount = parseMaybeNumber((breakdown as any).colorless);
      if (amount === null) return null;
      return amount > 0;
    }
  }
  {
    const m = clause.match(/^if\s+colorless\s+mana\s+(?:wasn't|was\s+not)\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const breakdown = (sourcePermanent as any)?.manaSpentBreakdown ?? (sourcePermanent as any)?.card?.manaSpentBreakdown;
      if (!breakdown || typeof breakdown !== "object") return null;
      const amount = parseMaybeNumber((breakdown as any).colorless);
      if (amount === null) return null;
      return amount === 0;
    }
  }
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+colors\s+of\s+mana\s+were\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const spent = getManaColorsSpentFromSource(sourcePermanent);
      if (!spent) return null;
      return new Set(spent).size >= n;
    }
  }

  // "if no colored mana was spent to cast it" (conservative)
  {
    const m = clause.match(/^if\s+no\s+colored\s+mana\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      if (!sourcePermanent) return null;

      const breakdown = (sourcePermanent as any)?.manaSpentBreakdown ?? (sourcePermanent as any)?.card?.manaSpentBreakdown;
      if (breakdown && typeof breakdown === 'object') {
        const colorKeys = ['white', 'blue', 'black', 'red', 'green'];
        let allKnown = true;
        for (const k of colorKeys) {
          const n = parseMaybeNumber((breakdown as any)[k]);
          if (n === null) {
            allKnown = false;
            continue;
          }
          if (n > 0) return false;
        }
        if (allKnown) return true;
      }

      const spent = getManaColorsSpentFromSource(sourcePermanent);
      if (spent) return spent.length === 0;

      return null;
    }
  }

  // "if at least N mana was spent to cast it"
  {
    const m = clause.match(/^if\s+at\s+least\s+([a-z0-9]+)\s+mana\s+was\s+spent\s+to\s+cast\s+it$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const total = sumManaSpentTotal(sourcePermanent);
      if (total === null) return null;
      return total >= n;
    }
  }

  // "if no mana was spent to cast it"
  if (/^if\s+no\s+mana\s+was\s+spent\s+to\s+cast\s+it$/i.test(clause)) {
    const total = sumManaSpentTotal(sourcePermanent);
    if (total === null) return null;
    return total === 0;
  }

  // "if mana from a Treasure was spent to cast it" (best-effort; depends on tracking)
  if (/^if\s+mana\s+from\s+a\s+treasure\s+was\s+spent\s+to\s+cast\s+it$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const v = (sourcePermanent as any)?.manaFromTreasureSpent ?? (sourcePermanent as any)?.card?.manaFromTreasureSpent;
    return typeof v === "boolean" ? v : null;
  }

  // ===== Counter / modification checks =====
  // "if this creature is modified" / "if it is modified"
  if (/^if\s+(?:this\s+creature|it|it'?s)\s+is\s+modified$/i.test(clause) || /^if\s+it'?s\s+modified$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return isPermanentModified(ctx, sourcePermanent);
  }

  // "if it didn't have decayed" / "if this creature didn't have decayed" (keyword; best-effort)
  if (
    /^if\s+it\s+did\s+not\s+have\s+decayed$/i.test(clause) ||
    /^if\s+it\s+didn'?t\s+have\s+decayed$/i.test(clause) ||
    /^if\s+this\s+creature\s+did\s+not\s+have\s+decayed$/i.test(clause) ||
    /^if\s+this\s+creature\s+didn'?t\s+have\s+decayed$/i.test(clause)
  ) {
    const has = permanentHasKeyword(sourcePermanent, 'decayed');
    return has === null ? null : !has;
  }

  // "if this creature has defender" (keyword)
  if (/^if\s+this\s+creature\s+has\s+defender$/i.test(clause)) {
    return permanentHasKeyword(sourcePermanent, 'defender');
  }

  // "if it/this creature has first strike" (keyword)
  if (/^if\s+(?:it|this\s+creature)\s+has\s+first\s+strike$/i.test(clause)) {
    return permanentHasKeyword(sourcePermanent, 'first strike');
  }

  // "if it/this creature has mutate" (keyword)
  if (/^if\s+(?:it|this\s+creature)\s+has\s+mutate$/i.test(clause)) {
    return permanentHasKeyword(sourcePermanent, 'mutate');
  }

  // "if this creature is enchanted" / "if this creature is equipped" (attachments)
  if (/^if\s+this\s+creature\s+is\s+equipped$/i.test(clause)) {
    return isEquippedConservative(ctx, sourcePermanent);
  }
  if (/^if\s+this\s+creature\s+is\s+enchanted$/i.test(clause)) {
    const info = getAuraCountConservative(ctx, sourcePermanent);
    if (!info) return null;
    if (info.count > 0) return true;
    return info.unknown ? null : false;
  }
  if (/^if\s+this\s+creature\s+is\s+enchanted\s+by\s+two\s+or\s+more\s+auras$/i.test(clause)) {
    const info = getAuraCountConservative(ctx, sourcePermanent);
    if (!info) return null;
    if (info.count >= 2) return true;
    return info.unknown ? null : false;
  }

  // "if this creature is monstrous" (status flag)
  if (/^if\s+this\s+creature\s+is\s+monstrous$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const v = (sourcePermanent as any).monstrous;
    return typeof v === 'boolean' ? v : null;
  }

  // "if this creature is renowned" (status flag)
  if (/^if\s+this\s+creature\s+is\s+renowned$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return (sourcePermanent as any).renowned === true;
  }

  // "if this creature is suspected" (status flag; best-effort)
  if (/^if\s+this\s+creature\s+is\s+suspected$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const v = (sourcePermanent as any).suspected;
    return typeof v === 'boolean' ? v : null;
  }

  // "if it's not suspected" / "if it isn't suspected" (status flag; best-effort)
  if (
    /^if\s+(?:it'?s\s+not|it\s+is\s+not|it\s+isn'?t|this\s+creature\s+is\s+not|this\s+creature\s+isn'?t)\s+suspected$/i.test(
      clause
    )
  ) {
    if (!sourcePermanent) return null;
    const v = (sourcePermanent as any).suspected;
    return typeof v === 'boolean' ? !v : null;
  }

  // "if this creature doesn't have a +1/+1 counter on it"
  if (/^if\s+this\s+creature\s+doesn'?t\s+have\s+a\s+\+1\/\+1\s+counter\s+on\s+it$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const n = getCounterCount(sourcePermanent, '+1/+1');
    if (n === null) return null;
    return n <= 0;
  }

  // "if this creature has one or more +1/+1 counters on it"
  if (/^if\s+this\s+creature\s+has\s+one\s+or\s+more\s+\+1\/\+1\s+counters\s+on\s+it$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const n = getCounterCount(sourcePermanent, '+1/+1');
    if (n === null) return null;
    return n >= 1;
  }

  // "if this creature has fewer than three +1/+1 counters on it"
  if (/^if\s+this\s+creature\s+has\s+fewer\s+than\s+three\s+\+1\/\+1\s+counters\s+on\s+it$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const n = getCounterCount(sourcePermanent, '+1/+1');
    if (n === null) return null;
    return n < 3;
  }

  // "if it has a +1/+1 counter on it"
  if (/^if\s+it\s+has\s+(?:a|one\s+or\s+more)\s+\+1\/\+1\s+counter\s+on\s+it$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const n = sourcePermanent?.counters?.['+1/+1'];
    return typeof n === 'number' ? n > 0 : false;
  }

  // "if it had counters on it"
  if (/^if\s+it\s+had\s+counters\s+on\s+it$/i.test(clause)) {
    return hasAnyCounters(sourcePermanent);
  }

  // "if it had one or more counters on it"
  if (/^if\s+it\s+had\s+(?:one\s+or\s+more|a)\s+counters\s+on\s+it$/i.test(clause)) {
    return hasAnyCounters(sourcePermanent);
  }

  // "if it had a -1/-1 counter on it"
  if (/^if\s+it\s+had\s+a\s+-1\/-1\s+counter\s+on\s+it$/i.test(clause)) {
    const n = getCounterCount(sourcePermanent, '-1/-1');
    if (n === null) return null;
    return n >= 1;
  }

  // "if it had no -1/-1 counters on it"
  if (/^if\s+it\s+had\s+no\s+-1\/-1\s+counters\s+on\s+it$/i.test(clause)) {
    const n = getCounterCount(sourcePermanent, '-1/-1');
    if (n === null) return null;
    return n <= 0;
  }

  // "if it had one or more -1/-1 counters on it"
  if (/^if\s+it\s+had\s+one\s+or\s+more\s+-1\/-1\s+counters\s+on\s+it$/i.test(clause)) {
    const n = getCounterCount(sourcePermanent, '-1/-1');
    if (n === null) return null;
    return n >= 1;
  }

  // "if it had N or more counters on it" (generic total)
  {
    const m = clause.match(/^if\s+it\s+had\s+([a-z0-9]+)\s+or\s+more\s+counters\s+on\s+it$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const total = sumAllCounters(sourcePermanent);
      if (total === null) return null;
      return total >= n;
    }
  }

  // "if it had a +1/+1 counter on it"
  if (/^if\s+it\s+had\s+a\s+\+1\/\+1\s+counter\s+on\s+it$/i.test(clause)) {
    const n = getCounterCount(sourcePermanent, "+1/+1");
    if (n === null) return null;
    return n >= 1;
  }

  // "if it had N or more +1/+1 counters on it"
  {
    const m = clause.match(/^if\s+it\s+had\s+([a-z0-9]+)\s+or\s+more\s+\+1\/\+1\s+counters\s+on\s+it$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const count = getCounterCount(sourcePermanent, "+1/+1");
      if (count === null) return null;
      return count >= n;
    }
  }

  // "if it has fewer than four +1/+1 counters on it"
  if (/^if\s+it\s+has\s+fewer\s+than\s+four\s+\+1\/\+1\s+counters\s+on\s+it$/i.test(clause)) {
    const n = getCounterCount(sourcePermanent, '+1/+1');
    if (n === null) return null;
    return n < 4;
  }

  // "if it has an egg counter on it"
  if (/^if\s+it\s+has\s+an\s+egg\s+counter\s+on\s+it$/i.test(clause)) {
    const n = getCounterCountCaseInsensitiveFromPerm(sourcePermanent, 'egg');
    if (n === null) return null;
    return n >= 1;
  }

  // "if it had a revival counter on it"
  if (/^if\s+it\s+had\s+a\s+revival\s+counter\s+on\s+it$/i.test(clause)) {
    const n = getCounterCountCaseInsensitiveFromPerm(sourcePermanent, 'revival');
    if (n === null) return null;
    return n >= 1;
  }

  // "if there are N or more ki counters on this creature"
  {
    const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+ki\s+counters\s+on\s+this\s+creature$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const count = getCounterCount(sourcePermanent, "ki");
      if (count === null) return null;
      return count >= n;
    }
  }

  // "if this <type> has N or fewer <counter> counters on it" (generic counter upper-bound)
  {
    const m = clause.match(
      /^if\s+this\s+(creature|artifact|enchantment|permanent)\s+has\s+([a-z0-9]+)\s+or\s+fewer\s+([a-z][a-z0-9'’\- ]*)\s+counters?\s+on\s+it$/i
    );
    if (m) {
      const n = parseCountToken(m[2]);
      if (n === null) return null;
      const counterTypeLower = toLower(m[3]);
      const c = getCounterCountCaseInsensitiveFromPerm(sourcePermanent, counterTypeLower);
      if (c === null) return null;
      return c <= n;
    }
  }

  // "if it has N or fewer <counter> counters on it" (generic counter upper-bound)
  {
    const m = clause.match(/^if\s+it\s+has\s+([a-z0-9]+)\s+or\s+fewer\s+([a-z][a-z0-9'’\- ]*)\s+counters?\s+on\s+it$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const counterTypeLower = toLower(m[2]);
      const c = getCounterCountCaseInsensitiveFromPerm(sourcePermanent, counterTypeLower);
      if (c === null) return null;
      return c <= n;
    }
  }

  // "if it had no time counters on it" (suspend/vanishing)
  if (/^if\s+it\s+had\s+no\s+time\s+counters\s+on\s+it$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const direct = parseMaybeNumber((sourcePermanent as any)?.timeCounters ?? (sourcePermanent as any)?.card?.timeCounters);
    if (direct !== null) return direct <= 0;
    const count = getCounterCount(sourcePermanent, "time");
    if (count === null) return null;
    return count <= 0;
  }

  // "if this enchantment has N or more quest counters on it"
  {
    const m = clause.match(/^if\s+this\s+enchantment\s+has\s+([a-z0-9]+)\s+or\s+more\s+quest\s+counters\s+on\s+it$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const count = getCounterCount(sourcePermanent, "quest");
      if (count === null) return null;
      return count >= n;
    }
  }

  // ===== Permanent-type count checks =====
  // "if you control ten or more Treasures" / "if you control N or more treasures"
  {
    const m = clause.match(/^if\s+you\s+control\s+([a-z0-9]+)\s+or\s+more\s+treasures$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return countControlledPermanentsBySubtype(ctx, controllerId, 'treasure') >= n;
    }
  }

  // "if you control ten or more Gates"
  {
    const m = clause.match(/^if\s+you\s+control\s+([a-z0-9]+)\s+or\s+more\s+gates$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return countLandsWithSubtype(ctx, controllerId, 'gate') >= n;
    }
  }

  // "if you control three or more snow permanents"
  {
    const m = clause.match(/^if\s+you\s+control\s+([a-z0-9]+)\s+or\s+more\s+snow\s+permanents$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return countControlledPermanentsBySubtype(ctx, controllerId, 'snow') >= n;
    }
  }

  // "if you control a Desert"
  if (/^if\s+you\s+control\s+a\s+desert$/i.test(clause)) {
    return countLandsWithSubtype(ctx, controllerId, 'desert') >= 1;
  }

  // "if you control a Plains/Island/Swamp/Mountain/Forest"
  {
    const m = clause.match(/^if\s+you\s+control\s+a\s+(plains|island|swamp|mountain|forest)$/i);
    if (m) {
      return countLandsWithSubtype(ctx, controllerId, m[1].toLowerCase()) >= 1;
    }
  }

  // "if you control lands of each basic land type" (domain - full)
  if (/^if\s+you\s+control\s+lands\s+of\s+each\s+basic\s+land\s+type$/i.test(clause)) {
    return hasLandsOfAllBasicTypes(ctx, controllerId);
  }

  // ===== Combat status =====
  // "if this and at least two other creatures are attacking" (Battalion)
  if (/^if\s+(?:this\s+creature|it)\s+and\s+at\s+least\s+two\s+other\s+creatures\s+are\s+attacking$/i.test(clause)) {
    if (!sourcePermanent?.id) return null;
    if (!isPermanentAttacking(sourcePermanent)) return false;
    const attackers = getAttackingCreatures(ctx, controllerId);
    const hasSource = attackers.some((a: any) => String(a?.id || '') === String(sourcePermanent.id));
    if (!hasSource) return false;
    return attackers.length >= 3;
  }

  // "if it's blocking a <color> creature" / "if it is blocking a <type> creature"
  {
    const m = clause.match(/^if\s+(?:it'?s|it\s+is)\s+blocking\s+an?\s+([a-z]+)\s+creature$/i);
    if (m) {
      if (!sourcePermanent) return null;
      const word = String(m[1] || '').toLowerCase();
      const blockedIdsRaw = sourcePermanent?.blocking;
      const blockedIds = Array.isArray(blockedIdsRaw) ? blockedIdsRaw : (blockedIdsRaw ? [blockedIdsRaw] : []);
      if (blockedIds.length === 0) return false;

      const battlefield = (ctx as any).state?.battlefield || [];
      const blockedCreatures = blockedIds
        .map((id: any) => (Array.isArray(battlefield) ? battlefield : []).find((p: any) => p?.id === id))
        .filter(Boolean);

      if (['white', 'blue', 'black', 'red', 'green'].includes(word)) {
        const colorMap: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
        const symbol = colorMap[word];
        return blockedCreatures.some((c: any) => Array.isArray(c?.card?.colors) && c.card.colors.includes(symbol));
      }

      // Fallback: treat as creature subtype/type word (e.g., "zombie")
      const re = new RegExp(`\\b${word.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i');
      return blockedCreatures.some((c: any) => re.test(String(c?.card?.type_line || '')));
    }
  }

  // ===== Party =====
  if (/^if\s+you\s+have\s+a\s+full\s+party$/i.test(clause)) {
    return hasFullParty(ctx, controllerId);
  }

  // ===== Status / ownership =====
  if (/^if\s+it\s+is\s+tapped$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return sourcePermanent.tapped === true;
  }

  if (/^if\s+it\s+is\s+untapped$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return sourcePermanent.tapped !== true;
  }

  if (/^if\s+this\s+(?:permanent|creature|artifact|enchantment|land|planeswalker|battle)\s+is\s+tapped$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return sourcePermanent.tapped === true;
  }

  if (/^if\s+this\s+(?:permanent|creature|artifact|enchantment|land|planeswalker|battle)\s+is\s+untapped$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return sourcePermanent.tapped !== true;
  }

  if (
    /^if\s+it\s+isn'?t\s+tapped$/i.test(clause) ||
    /^if\s+it\s+is\s+not\s+tapped$/i.test(clause)
  ) {
    if (!sourcePermanent) return null;
    return sourcePermanent.tapped !== true;
  }

  if (
    /^if\s+this\s+(?:permanent|creature|artifact|enchantment|land|planeswalker|battle)\s+isn'?t\s+tapped$/i.test(clause) ||
    /^if\s+this\s+(?:permanent|creature|artifact|enchantment|land|planeswalker|battle)\s+is\s+not\s+tapped$/i.test(clause)
  ) {
    if (!sourcePermanent) return null;
    return sourcePermanent.tapped !== true;
  }

  // "if this permanent is an enchantment" (and similar type checks)
  {
    const m = clause.match(/^if\s+this\s+(?:permanent|creature|artifact|enchantment|land|planeswalker|battle)\s+is\s+an?\s+(artifact|creature|enchantment|land|planeswalker|battle)$/i);
    if (m) {
      if (!sourcePermanent) return null;
      const want = String(m[1] || '').toLowerCase();
      const tl = String(sourcePermanent?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      return tl.includes(want);
    }
  }

  // "if tribute was(n't) paid" (recognized; best-effort when the state tracks it)
  if (/^if\s+tribute\s+was\s+paid$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const v = (sourcePermanent as any)?.tributePaid ?? (sourcePermanent as any)?.tributeWasPaid ?? (sourcePermanent as any)?.card?.tributePaid ?? (sourcePermanent as any)?.card?.tributeWasPaid;
    if (typeof v === 'boolean') return v;
    return null;
  }

  if (/^if\s+tribute\s+wasn'?t\s+paid$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const v = (sourcePermanent as any)?.tributePaid ?? (sourcePermanent as any)?.tributeWasPaid ?? (sourcePermanent as any)?.card?.tributePaid ?? (sourcePermanent as any)?.card?.tributeWasPaid;
    if (typeof v === 'boolean') return !v;
    return null;
  }

  if (/^if\s+it\s+is\s+a\s+token$/i.test(clause) || /^if\s+it'?s\s+a\s+token$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return sourcePermanent.isToken === true;
  }

  if (
    /^if\s+it\s+isn'?t\s+a\s+token$/i.test(clause) ||
    /^if\s+it\s+is\s+not\s+a\s+token$/i.test(clause) ||
    /^if\s+it'?s\s+not\s+a\s+token$/i.test(clause)
  ) {
    if (!sourcePermanent) return null;
    return sourcePermanent.isToken !== true;
  }

  // "if there are no Reflection tokens on the battlefield"
  if (/^if\s+there\s+are\s+no\s+reflection\s+tokens\s+on\s+the\s+battlefield$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield || [];
    if (!Array.isArray(battlefield)) return null;
    const anyReflection = battlefield.some((p: any) => {
      if (!p || p.isToken !== true) return false;
      const name = String(p?.card?.name || p?.name || '').toLowerCase();
      return name === 'reflection';
    });
    return !anyReflection;
  }

  // "if you control a legendary <thing>"
  {
    const m = clause.match(/^if\s+you\s+control\s+a\s+legendary\s+([a-z ]+)$/i);
    if (m) {
      const subject = String(m[1] || '').trim().toLowerCase();
      // normalize: "permanent" is a wildcard; otherwise require the subject word in type line.
      return countControlledPermanents(ctx, controllerId, (tl) => {
        if (!tl.includes('legendary')) return false;
        if (subject === 'permanent') return true;
        return tl.includes(subject);
      }) > 0;
    }
  }

  // "if you control a creature named <Name>"
  {
    const m = clause.match(/^if\s+you\s+control\s+a\s+creature\s+named\s+(.+)$/i);
    if (m) {
      const nameRaw = normalizeText(m[1]).replace(/[.]+$/, '').replace(/^"|"$/g, '').trim();
      const nameLower = nameRaw.toLowerCase();
      const creatures = getControlledCreatures(ctx, controllerId);
      return creatures.some((c: any) => String(c?.card?.name || '').toLowerCase() === nameLower);
    }
  }

  // "if this creature is named <Name>" / "if this permanent is named <Name>"
  {
    const m = clause.match(/^if\s+this\s+(creature|permanent)\s+is\s+named\s+(.+)$/i);
    if (m) {
      if (!sourcePermanent) return null;
      const nameRaw = normalizeText(m[2]).replace(/[.]+$/, '').replace(/^"|"$/g, '').trim();
      const expected = nameRaw.toLowerCase();
      const actual = String((sourcePermanent as any)?.card?.name || (sourcePermanent as any)?.name || '').toLowerCase();
      if (!actual) return null;
      return actual === expected;
    }
  }

  // "if all nonland permanents you control are white" (best-effort)
  if (/^if\s+all\s+nonland\s+permanents\s+you\s+control\s+are\s+white$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield || [];
    if (!Array.isArray(battlefield)) return null;
    const yours = battlefield.filter((p: any) => p && String(p.controller) === String(controllerId));
    const nonlands = yours.filter((p: any) => {
      const tl = String(p?.card?.type_line || '').toLowerCase();
      return !tl.includes('land');
    });
    if (nonlands.length === 0) return true;

    let unknown = false;
    for (const p of nonlands) {
      const isWhite = isPermanentWhite(p);
      if (isWhite === false) return false;
      if (isWhite === null) unknown = true;
    }
    return unknown ? null : true;
  }

  // ===== Chosen color =====
  // "If you chose red" / "If the chosen color is red" (requires a chosenColor stored on the source)
  {
    const m = clause.match(/^if\s+you\s+chose\s+(white|blue|black|red|green)$/i);
    if (m) {
      const chosen = getChosenColorFromSource(sourcePermanent);
      if (!chosen) return null;
      const expected = normalizeColorToken(m[1]);
      if (!expected) return null;
      return chosen === expected;
    }
  }
  {
    const m = clause.match(/^if\s+the\s+chosen\s+color\s+is\s+(white|blue|black|red|green)$/i);
    if (m) {
      const chosen = getChosenColorFromSource(sourcePermanent);
      if (!chosen) return null;
      const expected = normalizeColorToken(m[1]);
      if (!expected) return null;
      return chosen === expected;
    }
  }

  // ===== Dungeon completion (best-effort; authoritative if completion is tracked) =====
  // Supports both "If you completed a dungeon" and "If you completed a dungeon this turn".
  if (/^if\s+you(?:'ve|\s+have)?\s+completed\s+a\s+dungeon(\s+this\s+turn)?$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const wantsThisTurn = /\s+this\s+turn$/i.test(clause);

    if (wantsThisTurn) {
      const thisTurn = stateAny?.completedDungeonThisTurn?.[controllerId] ?? stateAny?.dungeonCompletedThisTurn?.[controllerId];
      if (typeof thisTurn === 'boolean') return thisTurn;
      // If we don't have per-turn tracking, we can't safely answer the "this turn" variant.
      return null;
    }

    const flag = stateAny?.completedDungeon?.[controllerId] ?? stateAny?.dungeonCompleted?.[controllerId];
    if (typeof flag === 'boolean') return flag;
    const completedCount = stateAny?.completedDungeons?.[controllerId];
    if (typeof completedCount === 'number') return completedCount > 0;
    return null;
  }

  // "if you haven't completed Tomb of Annihilation" (best-effort; name-specific tracking is optional)
  if (/^if\s+you\s+haven'?t\s+completed\s+tomb\s+of\s+annihilation$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;

    const namesCandidate =
      stateAny?.completedDungeonNames?.[controllerId] ??
      stateAny?.completedDungeonsByName?.[controllerId] ??
      stateAny?.completedDungeonNameList?.[controllerId];

    if (Array.isArray(namesCandidate)) {
      const completedNames = namesCandidate.map((n: any) => String(n || '').toLowerCase());
      return !completedNames.includes('tomb of annihilation');
    }

    const mapCandidate = stateAny?.completedDungeonNamesMap?.[controllerId] ?? stateAny?.completedDungeonsByNameMap?.[controllerId];
    if (mapCandidate && typeof mapCandidate === 'object') {
      const v = (mapCandidate as any)['tomb of annihilation'];
      if (typeof v === 'boolean') return !v;
      if (typeof v === 'number') return v <= 0;
    }

    return null;
  }

  // ===== Mechanic-specific =====
  // "if an opponent has three or more poison counters" (corrupted)
  if (/^if\s+an\s+opponent\s+has\s+([a-z0-9]+)\s+or\s+more\s+poison\s+counters$/i.test(clause)) {
    const m = clause.match(/^if\s+an\s+opponent\s+has\s+([a-z0-9]+)\s+or\s+more\s+poison\s+counters$/i);
    const n = m ? parseCountToken(m[1]) : null;
    if (n === null) return null;
    const opps = getOpponentIds(ctx, controllerId);
    if (!opps.length) return false;
    return opps.some((oid) => getPoisonCounters(ctx, oid) >= n);
  }

  // "if you control a permanent with mana value X or greater"
  {
    const m = clause.match(/^if\s+you\s+control\s+a\s+permanent\s+with\s+mana\s+value\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const battlefield = (ctx as any).state?.battlefield || [];
      return (Array.isArray(battlefield) ? battlefield : []).some((p: any) => {
        if (!p || p.controller !== controllerId) return false;
        const mv = getManaValue(p);
        return typeof mv === 'number' && mv >= n;
      });
    }
  }

  // "if its mana value was N or greater" (best-effort; prefers triggering stackItem card)
  {
    const m = clause.match(/^if\s+its\s+mana\s+value\s+was\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const refStackItemCard = (refs as any)?.stackItem?.card;
      const stackId =
        refs?.triggeringStackItemId ??
        (sourcePermanent as any)?.triggeringStackItemId ??
        (sourcePermanent as any)?.triggeringSpellStackItemId;
      const stack: any[] = Array.isArray((ctx as any).state?.stack) ? (ctx as any).state.stack : [];
      const triggeringStackItem = !refStackItemCard && stackId ? stack.find((it: any) => it && String(it.id) === String(stackId)) : null;
      const triggeringCard = refStackItemCard ?? triggeringStackItem?.card ?? sourcePermanent?.card ?? sourcePermanent;

      const mv = getManaValue(triggeringCard);
      if (typeof mv !== 'number') return null;
      return mv >= n;
    }
  }

  // "if N or more spells were cast this turn" (Archenemy/Planechase and similar)
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+spells\s+were\s+cast\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getSpellsCastThisTurnCount(ctx) >= n;
    }
  }

  // "if you control your commander" / "if you control a commander"
  // Best-effort based on commander card IDs stored in command zone metadata.
  {
    const wantsYour = /^if\s+you\s+control\s+your\s+commander$/i.test(clause);
    const wantsAny = /^if\s+you\s+control\s+a\s+commander$/i.test(clause);
    if (wantsYour || wantsAny) {
      const cz = (ctx as any).commandZone ?? (ctx as any).state?.commandZone;
      if (!cz || typeof cz !== 'object') return null;

      const yourCommanderIds = cz?.[controllerId]?.commanderIds;
      if (!Array.isArray(yourCommanderIds)) return null;

      const commanderIdSet = new Set<string>();
      if (wantsYour) {
        for (const id of yourCommanderIds) commanderIdSet.add(String(id));
      } else {
        for (const pid of Object.keys(cz)) {
          const ids = cz?.[pid]?.commanderIds;
          if (Array.isArray(ids)) for (const id of ids) commanderIdSet.add(String(id));
        }
      }

      const battlefield = (ctx as any).state?.battlefield || [];
      return (Array.isArray(battlefield) ? battlefield : []).some((p: any) => {
        if (!p || p.controller !== controllerId) return false;
        const cid = p.card?.id;
        return cid ? commanderIdSet.has(String(cid)) : false;
      });
    }
  }

  // "if you don't control ..." / "if you do not control ..." (common negative existence)
  {
    const m = clause.match(/^if\s+you\s+(?:do\s+not|don't)\s+control\s+(?:(?:a|an)\s+)?(?:any\s+)?([a-z0-9\-\s']+)$/i);
    if (m) {
      const subjectRaw = m[1].trim().replace(/\s+/g, " ");
      const subjectLower = subjectRaw.toLowerCase();

      if (subjectLower === 'cards in hand') return getHandCount(ctx, controllerId) === 0;
      if (subjectLower === 'your commander') {
        const cz = (ctx as any).commandZone ?? (ctx as any).state?.commandZone;
        const ids = cz?.[controllerId]?.commanderIds;
        if (!Array.isArray(ids)) return null;
        const idSet = new Set(ids.map((id: any) => String(id)));
        const battlefield = (ctx as any).state?.battlefield || [];
        const controlsCommander = (Array.isArray(battlefield) ? battlefield : []).some((p: any) => {
          if (!p || p.controller !== controllerId) return false;
          const cid = p.card?.id;
          return cid ? idSet.has(String(cid)) : false;
        });
        return !controlsCommander;
      }
      if (subjectLower === 'basic lands') return countBasicLands(ctx, controllerId) === 0;

      const subjectToken = subjectLower.endsWith('s') ? subjectLower.slice(0, -1) : subjectLower;
      return countByPermanentType(ctx, controllerId, subjectToken) === 0;
    }
  }

  // "if you control no other X" (requires source permanent to exclude itself)
  {
    const m = clause.match(/^if\s+you\s+control\s+no\s+other\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      if (!sourcePermanent?.id) return null;
      const subjectRaw = m[1].trim().replace(/\s+/g, " ");
      const subjectLower = subjectRaw.toLowerCase();
      const sourceId = String(sourcePermanent.id);

      if (subjectLower === 'cards in hand') return getHandCount(ctx, controllerId) === 0;
      if (subjectLower === 'basic lands') {
        const battlefield = (ctx as any).state?.battlefield || [];
        let count = 0;
        for (const perm of Array.isArray(battlefield) ? battlefield : []) {
          if (!perm || perm.controller !== controllerId) continue;
          if (String(perm.id) === sourceId) continue;
          const tl = String(perm.card?.type_line || '').toLowerCase();
          if (tl.includes('basic') && tl.includes('land')) count++;
        }
        return count === 0;
      }

      const subjectToken = subjectLower.endsWith('s') ? subjectLower.slice(0, -1) : subjectLower;
      const battlefield = (ctx as any).state?.battlefield || [];
      let count = 0;
      for (const perm of Array.isArray(battlefield) ? battlefield : []) {
        if (!perm || perm.controller !== controllerId) continue;
        if (String(perm.id) === sourceId) continue;
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (tl.includes(subjectToken)) count++;
      }
      return count === 0;
    }
  }

  // "if you control no X"
  {
    const m = clause.match(/^if\s+you\s+control\s+no\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const nounRaw = m[1].trim();
      const nounLower = nounRaw.toLowerCase();

      // Avoid swallowing numeric-comparison phrases like "no fewer than ...".
      if (nounLower.startsWith('fewer than ') || nounLower.startsWith('less than ') || nounLower.startsWith('more than ')) {
        // fall through
      } else {

      // Let the more-specific tapped/untapped templates handle these.
      if (nounLower.startsWith('untapped ') || nounLower.startsWith('tapped ')) {
        // fall through
      } else {
      if (nounLower === "cards in hand") {
        return getHandCount(ctx, controllerId) === 0;
      }

      // Special case: "no basic lands" / "no lands" etc.
      if (nounLower === "basic lands") return countBasicLands(ctx, controllerId) === 0;

      const noun = nounLower.replace(/\s+/g, " ");
      const nounSingular = noun.endsWith("s") ? noun.slice(0, -1) : noun;

      // Heuristic: check type line contains the noun (covers permanent types and creature types).
      return countByPermanentType(ctx, controllerId, nounSingular) === 0;
      }
      }
    }
  }

  // "if you control no untapped/tapped lands" (and creatures)
  {
    const m = clause.match(/^if\s+you\s+control\s+no\s+(untapped|tapped)\s+(lands|land|creatures|creature)$/i);
    if (m) {
      const wantsUntapped = String(m[1]).toLowerCase() === 'untapped';
      const subject = String(m[2]).toLowerCase();
      const typeToken = subject.startsWith('land') ? 'land' : 'creature';

      const battlefield = (ctx as any).state?.battlefield || [];
      const found = (Array.isArray(battlefield) ? battlefield : []).some((p: any) => {
        if (!p || p.controller !== controllerId) return false;
        const tl = String(p.card?.type_line || '').toLowerCase();
        if (!tl.includes(typeToken)) return false;
        const tapped = p.tapped === true;
        return wantsUntapped ? !tapped : tapped;
      });

      return !found;
    }
  }

  // "if you control an untapped/tapped land" (and creature)
  {
    const m = clause.match(/^if\s+you\s+control\s+(?:an?|a)\s+(untapped|tapped)\s+(land|creature)$/i);
    if (m) {
      const wantsUntapped = String(m[1]).toLowerCase() === 'untapped';
      const typeToken = String(m[2]).toLowerCase();

      const battlefield = (ctx as any).state?.battlefield || [];
      return (Array.isArray(battlefield) ? battlefield : []).some((p: any) => {
        if (!p || p.controller !== controllerId) return false;
        const tl = String(p.card?.type_line || '').toLowerCase();
        if (!tl.includes(typeToken)) return false;
        const tapped = p.tapped === true;
        return wantsUntapped ? !tapped : tapped;
      });
    }
  }

  // "if an opponent controls no X" / "if no opponent controls a/an X"
  {
    const m1 = clause.match(/^if\s+an\s+opponent\s+controls\s+no\s+([a-z0-9\-\s']+)$/i);
    if (m1) {
      const noun = String(m1[1] || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const nounToken = noun.endsWith('s') ? noun.slice(0, -1) : noun;
      const opps = getOpponentIds(ctx, controllerId);
      if (!opps.length) return true;
      return opps.every((oid) => countByPermanentType(ctx, oid, nounToken) === 0);
    }

    const m2 = clause.match(/^if\s+no\s+opponent\s+controls\s+an?\s+([a-z0-9\-\s']+)$/i);
    if (m2) {
      const noun = String(m2[1] || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const nounToken = noun.endsWith('s') ? noun.slice(0, -1) : noun;
      const opps = getOpponentIds(ctx, controllerId);
      if (!opps.length) return true;
      return opps.every((oid) => countByPermanentType(ctx, oid, nounToken) === 0);
    }
  }

  // "if your opponents control no creatures" (Kezzerdrix)
  if (/^if\s+your\s+opponents\s+control\s+no\s+creatures$/i.test(clause)) {
    const opps = getOpponentIds(ctx, controllerId);
    if (!opps.length) return true;
    return opps.every((oid) => countByPermanentType(ctx, oid, 'creature') === 0);
  }

  // "if you control another X"
  {
    const m = clause.match(/^if\s+you\s+control\s+another\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const nounRaw = m[1].trim().replace(/\s+/g, " ");
      // Heuristic: count permanents whose type line includes the noun token.
      // For creature subtypes (e.g., Knight), this works because type lines include it.
      // "another" means at least 2 (the source permanent itself counts as one).
      const noun = nounRaw.endsWith("s") ? nounRaw.slice(0, -1) : nounRaw;
      return countByPermanentType(ctx, controllerId, noun) >= 2;
    }
  }

  // "if you control a/an X" (existence)
  {
    const m = clause.match(/^if\s+you\s+control\s+(?:a|an)\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const nounRaw = m[1].trim().replace(/\s+/g, " ");
      const nounLower = nounRaw.toLowerCase();

      // Let the more-specific templates handle these.
      if (nounLower.startsWith('untapped ') || nounLower.startsWith('tapped ') || nounLower.includes('with power ')) {
        // fall through
      } else {
      const noun = nounRaw.endsWith("s") ? nounRaw.slice(0, -1) : nounRaw;
      return countByPermanentType(ctx, controllerId, noun) >= 1;
      }
    }
  }

  // "if you control N or more X"
  {
    const m = clause.match(/^if\s+you\s+control\s+([a-z0-9]+)\s+or\s+more\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const subjectRaw = m[2].trim().replace(/\s+/g, " ");

      // Land subtypes (Plains, Islands, etc.)
      const landSubtype = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      if (["plain", "island", "swamp", "mountain", "forest"].includes(landSubtype)) {
        const subtypeLookup = landSubtype === "plain" ? "plains" : `${landSubtype}s`;
        return countLandsWithSubtype(ctx, controllerId, subtypeLookup) >= n;
      }

      if (subjectRaw === "basic lands") return countBasicLands(ctx, controllerId) >= n;

      // Generic permanent-type counts: lands, creatures, artifacts, enchantments, etc.
      const typeToken = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      return countByPermanentType(ctx, controllerId, typeToken) >= n;
    }
  }

  // "if you control at least N X"
  {
    const m = clause.match(/^if\s+you\s+control\s+at\s+least\s+([a-z0-9]+)\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const subjectRaw = m[2].trim().replace(/\s+/g, " ");

      const landSubtype = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      if (["plain", "island", "swamp", "mountain", "forest"].includes(landSubtype)) {
        const subtypeLookup = landSubtype === "plain" ? "plains" : `${landSubtype}s`;
        return countLandsWithSubtype(ctx, controllerId, subtypeLookup) >= n;
      }

      if (subjectRaw === "basic lands") return countBasicLands(ctx, controllerId) >= n;

      const typeToken = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      return countByPermanentType(ctx, controllerId, typeToken) >= n;
    }
  }

  // "if you control at most N X" / "if you control no more than N X"
  {
    const m = clause.match(
      /^if\s+you\s+control\s+(?:at\s+most|no\s+more\s+than)\s+([a-z0-9]+)\s+([a-z0-9\-\s']+)$/i
    );
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const subjectRaw = m[2].trim().replace(/\s+/g, " ");

      const landSubtype = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      if (["plain", "island", "swamp", "mountain", "forest"].includes(landSubtype)) {
        const subtypeLookup = landSubtype === "plain" ? "plains" : `${landSubtype}s`;
        return countLandsWithSubtype(ctx, controllerId, subtypeLookup) <= n;
      }

      if (subjectRaw === "basic lands") return countBasicLands(ctx, controllerId) <= n;

      const typeToken = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      return countByPermanentType(ctx, controllerId, typeToken) <= n;
    }
  }

  // "if you control no fewer/less than N X"
  {
    const m = clause.match(/^if\s+you\s+control\s+no\s+(?:fewer|less)\s+than\s+([a-z0-9]+)\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const subjectRaw = m[2].trim().replace(/\s+/g, " ");

      const landSubtype = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      if (["plain", "island", "swamp", "mountain", "forest"].includes(landSubtype)) {
        const subtypeLookup = landSubtype === "plain" ? "plains" : `${landSubtype}s`;
        return countLandsWithSubtype(ctx, controllerId, subtypeLookup) >= n;
      }

      if (subjectRaw === "basic lands") return countBasicLands(ctx, controllerId) >= n;

      const typeToken = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      return countByPermanentType(ctx, controllerId, typeToken) >= n;
    }
  }

  // "if you control exactly N X"
  {
    const m = clause.match(/^if\s+you\s+control\s+exactly\s+([a-z0-9]+)\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const subjectRaw = m[2].trim().replace(/\s+/g, " ");

      const landSubtype = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      if (["plain", "island", "swamp", "mountain", "forest"].includes(landSubtype)) {
        const subtypeLookup = landSubtype === "plain" ? "plains" : `${landSubtype}s`;
        return countLandsWithSubtype(ctx, controllerId, subtypeLookup) === n;
      }

      if (subjectRaw === "basic lands") return countBasicLands(ctx, controllerId) === n;

      const typeToken = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      return countByPermanentType(ctx, controllerId, typeToken) === n;
    }
  }

  // "if you control N or fewer X"
  {
    const m = clause.match(/^if\s+you\s+control\s+([a-z0-9]+)\s+or\s+fewer\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const subjectRaw = m[2].trim().replace(/\s+/g, " ");

      const landSubtype = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      if (["plain", "island", "swamp", "mountain", "forest"].includes(landSubtype)) {
        const subtypeLookup = landSubtype === "plain" ? "plains" : `${landSubtype}s`;
        return countLandsWithSubtype(ctx, controllerId, subtypeLookup) <= n;
      }

      if (subjectRaw === "basic lands") return countBasicLands(ctx, controllerId) <= n;

      const typeToken = subjectRaw.endsWith("s") ? subjectRaw.slice(0, -1) : subjectRaw;
      return countByPermanentType(ctx, controllerId, typeToken) <= n;
    }
  }

  // "if you have N or more life"
  {
    const m = clause.match(/^if\s+you\s+have\s+([a-z0-9]+)\s+or\s+more\s+life$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getPlayerLife(ctx, controllerId) >= n;
    }
  }

  // "if each player has 10 or less life" (Cryptolith Fragment // Aurora of Emrakul)
  if (/^if\s+each\s+player\s+has\s+10\s+or\s+less\s+life$/i.test(clause)) {
    const ids = getAllPlayerIds(ctx, controllerId);
    if (!ids.length) return true;

    let unknown = false;
    for (const pid of ids) {
      const v = getPlayerLifeMaybe(ctx, pid);
      if (v === null) {
        unknown = true;
        continue;
      }
      if (v > 10) return false;
    }

    return unknown ? null : true;
  }

  // "if each player has an empty library" (Platinum Persecutor)
  if (/^if\s+each\s+player\s+has\s+an\s+empty\s+library$/i.test(clause)) {
    const ids = getAllPlayerIds(ctx, controllerId);
    if (!ids.length) return true;

    let unknown = false;
    for (const pid of ids) {
      const c = getLibraryCountMaybe(ctx, pid);
      if (c === null) {
        unknown = true;
        continue;
      }
      if (c !== 0) return false;
    }

    return unknown ? null : true;
  }

  // "if you have at least N life" / "if you have no fewer/less than N life"
  {
    const m = clause.match(/^if\s+you\s+have\s+(?:at\s+least|no\s+(?:fewer|less)\s+than)\s+([a-z0-9]+)\s+life$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getPlayerLife(ctx, controllerId) >= n;
    }
  }

  // "if you have N or less/fewer life"
  {
    const m = clause.match(/^if\s+you\s+have\s+([a-z0-9]+)\s+or\s+(?:less|fewer)\s+life$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getPlayerLife(ctx, controllerId) <= n;
    }
  }

  // "if you have at most N life" / "if you have no more than N life"
  {
    const m = clause.match(/^if\s+you\s+have\s+(?:at\s+most|no\s+more\s+than)\s+([a-z0-9]+)\s+life$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getPlayerLife(ctx, controllerId) <= n;
    }
  }

  // "if you have less than N life"
  {
    const m = clause.match(/^if\s+you\s+have\s+less\s+than\s+([a-z0-9]+)\s+life$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getPlayerLife(ctx, controllerId) < n;
    }
  }

  // "if you have more than N life"
  {
    const m = clause.match(/^if\s+you\s+have\s+more\s+than\s+([a-z0-9]+)\s+life$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getPlayerLife(ctx, controllerId) > n;
    }
  }

  // "if you have exactly N life"
  {
    const m = clause.match(/^if\s+you\s+have\s+exactly\s+([a-z0-9]+)\s+life$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getPlayerLife(ctx, controllerId) === n;
    }
  }

  // "if you have no cards in hand"
  if (/^if\s+you\s+have\s+no\s+cards\s+in\s+hand$/i.test(clause)) {
    return getHandCount(ctx, controllerId) === 0;
  }

  // "if you have a card in hand" (Imaginary Pet)
  if (/^if\s+you\s+have\s+a\s+card\s+in\s+hand$/i.test(clause)) {
    return getHandCount(ctx, controllerId) > 0;
  }

  // "if you have N or more cards in hand"
  {
    const m = clause.match(/^if\s+you\s+have\s+([a-z0-9]+)\s+or\s+more\s+cards\s+in\s+hand$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getHandCount(ctx, controllerId) >= n;
    }
  }

  // "if you have at least N cards in hand" / "if you have no fewer/less than N cards in hand"
  {
    const m = clause.match(
      /^if\s+you\s+have\s+(?:at\s+least|no\s+(?:fewer|less)\s+than)\s+([a-z0-9]+)\s+cards?\s+in\s+hand$/i
    );
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getHandCount(ctx, controllerId) >= n;
    }
  }

  // "if you have N or fewer/less cards in hand"
  {
    const m = clause.match(/^if\s+you\s+have\s+([a-z0-9]+)\s+or\s+(?:fewer|less)\s+cards\s+in\s+hand$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getHandCount(ctx, controllerId) <= n;
    }
  }

  // "if you have at most N cards in hand" / "if you have no more than N cards in hand"
  {
    const m = clause.match(
      /^if\s+you\s+have\s+(?:at\s+most|no\s+more\s+than)\s+([a-z0-9]+)\s+cards?\s+in\s+hand$/i
    );
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getHandCount(ctx, controllerId) <= n;
    }
  }

  // "if you have at least/at most/no more than/no fewer than N cards in (your) graveyard/library"
  {
    const m = clause.match(
      /^if\s+you\s+have\s+(at\s+least|at\s+most|no\s+more\s+than|no\s+(?:fewer|less)\s+than)\s+([a-z0-9]+)\s+cards?\s+in\s+(?:your\s+)?(graveyard|library)$/i
    );
    if (m) {
      const cmpRaw = m[1].toLowerCase().replace(/\s+/g, ' ');
      const n = parseCountToken(m[2]);
      if (n === null) return null;
      const zone = m[3].toLowerCase();

      const count = zone === 'graveyard' ? getGraveyardCount(ctx, controllerId) : getLibraryCount(ctx, controllerId);

      if (cmpRaw === 'at least' || cmpRaw.startsWith('no fewer') || cmpRaw.startsWith('no less')) return count >= n;
      return count <= n;
    }
  }

  // "if you have exactly N cards in hand"
  {
    const m = clause.match(/^if\s+you\s+have\s+exactly\s+([a-z0-9]+)\s+cards\s+in\s+hand$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getHandCount(ctx, controllerId) === n;
    }
  }

  // "if you have exactly thirteen cards in your hand" (Triskaidekaphile)
  if (/^if\s+you\s+have\s+exactly\s+thirteen\s+cards\s+in\s+your\s+hand$/i.test(clause)) {
    return getHandCount(ctx, controllerId) === 13;
  }

  // "if you didn't play a land this turn" (Mercadian Atlas)
  if (/^if\s+you\s+(?:did\s+not|didn't)\s+play\s+a\s+land\s+this\s+turn$/i.test(clause)) {
    const n = getLandsPlayedThisTurn(ctx, controllerId);
    if (n === null) return null;
    return n === 0;
  }

  // "if it wasn't the first land you played this turn" (Fastbond)
  if (
    /^if\s+it\s+was\s+not\s+the\s+first\s+land\s+you\s+played\s+this\s+turn$/i.test(clause) ||
    /^if\s+it\s+wasn'?t\s+the\s+first\s+land\s+you\s+played\s+this\s+turn$/i.test(clause)
  ) {
    const n = getLandsPlayedThisTurn(ctx, controllerId);
    if (n === null) return null;
    // This land counts as one of the lands played this turn.
    return n >= 2;
  }

  // "if you have at least 15 life more than your starting life total" (Angel of Destiny)
  if (/^if\s+you\s+have\s+at\s+least\s+15\s+life\s+more\s+than\s+your\s+starting\s+life\s+total$/i.test(clause)) {
    const starting = getStartingLifeTotal(ctx);
    const current = getPlayerLife(ctx, controllerId);
    return current >= starting + 15;
  }

  // "if your life total is greater than your starting life total" (Theopholos, Order Acolyte)
  if (/^if\s+your\s+life\s+total\s+is\s+greater\s+than\s+your\s+starting\s+life\s+total$/i.test(clause)) {
    const starting = getStartingLifeTotal(ctx);
    const current = getPlayerLife(ctx, controllerId);
    return current > starting;
  }

  // "if your life total is less than your starting life total" (Resolute Archangel)
  if (/^if\s+your\s+life\s+total\s+is\s+less\s+than\s+your\s+starting\s+life\s+total$/i.test(clause)) {
    const starting = getStartingLifeTotal(ctx);
    const current = getPlayerLife(ctx, controllerId);
    return current < starting;
  }

  // "if your life total is less than 7" (Elderscale Wurm)
  if (/^if\s+your\s+life\s+total\s+is\s+less\s+than\s+7$/i.test(clause)) {
    const current = getPlayerLife(ctx, controllerId);
    return current < 7;
  }

  // "if you have fewer than N cards in hand"
  {
    const m = clause.match(/^if\s+you\s+have\s+fewer\s+than\s+([a-z0-9]+)\s+cards\s+in\s+hand$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getHandCount(ctx, controllerId) < n;
    }
  }

  // "if that player has N or fewer cards in hand" (context-dependent)
  {
    const m = clause.match(/^if\s+that\s+player\s+has\s+([a-z0-9]+)\s+or\s+fewer\s+cards\s+in\s+hand$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const that = (sourcePermanent as any)?.thatPlayerId ?? (sourcePermanent as any)?.referencedPlayerId;
      if (typeof that !== "string" || !that) return null;
      return getHandCount(ctx, String(that)) <= n;
    }
  }

  // "if that player has N or more cards in hand" (context-dependent)
  {
    const m = clause.match(/^if\s+that\s+player\s+has\s+([a-z0-9]+)\s+or\s+more\s+cards\s+in\s+hand$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const that = (sourcePermanent as any)?.thatPlayerId ?? (sourcePermanent as any)?.referencedPlayerId;
      if (typeof that !== "string" || !that) return null;
      return getHandCount(ctx, String(that)) >= n;
    }
  }

  // "if that player has no cards in hand" (context-dependent)
  if (/^if\s+that\s+player\s+has\s+no\s+cards\s+in\s+hand$/i.test(clause)) {
    const that = (sourcePermanent as any)?.thatPlayerId ?? (sourcePermanent as any)?.referencedPlayerId;
    if (typeof that !== "string" || !that) return null;
    return getHandCount(ctx, String(that)) === 0;
  }

  // "if you've cast another spell this turn"
  if (/^if\s+you'?ve\s+cast\s+another\s+spell\s+this\s+turn$/i.test(clause)) {
    return getSpellsCastThisTurnByPlayerCount(ctx, controllerId) >= 2;
  }

  // "if it's the first instant spell" / "if it is the first instant spell" (conservative)
  if (/^if\s+(?:it'?s|it\s+is)\s+the\s+first\s+instant\s+spell$/i.test(clause)) {
    const raw = (ctx as any).state?.spellsCastThisTurn;
    if (!Array.isArray(raw)) return null;

    const spells = getSpellsCastThisTurn(ctx).filter((s: any) => String(s?.casterId || '') === controllerId);
    let instantCount = 0;
    let unknown = false;
    for (const s of spells) {
      const tl = String(s?.card?.type_line ?? s?.type_line ?? '').toLowerCase();
      if (!tl) {
        unknown = true;
        continue;
      }
      if (tl.includes('instant')) instantCount += 1;
    }

    if (!unknown) return instantCount === 1;
    if (instantCount > 1) return false;
    return null;
  }

  // "if you've cast a spell with mana value N or greater this turn" (conservative)
  {
    const m = clause.match(/^if\s+you'?ve\s+cast\s+a\s+spell\s+with\s+mana\s+value\s+([a-z0-9]+)\s+or\s+greater\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const raw = (ctx as any).state?.spellsCastThisTurn;
      if (!Array.isArray(raw)) return null;
      const spells = getSpellsCastThisTurn(ctx).filter((s: any) => String(s?.casterId || '') === controllerId);
      let unknown = false;
      for (const s of spells) {
        const mv = getManaValue((s as any)?.card ?? s);
        if (mv === null) {
          unknown = true;
          continue;
        }
        if (mv >= n) return true;
      }
      return unknown ? null : false;
    }
  }

  // "if you've cast N or more instant and sorcery spells this turn" (conservative)
  {
    const m = clause.match(/^if\s+you'?ve\s+cast\s+([a-z0-9]+)\s+or\s+more\s+instant\s+and\s+sorcery\s+spells\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const raw = (ctx as any).state?.spellsCastThisTurn;
      if (!Array.isArray(raw)) return null;
      const spells = getSpellsCastThisTurn(ctx).filter((s: any) => String(s?.casterId || '') === controllerId);
      let count = 0;
      let unknown = false;
      for (const s of spells) {
        const tl = String(s?.card?.type_line ?? s?.type_line ?? '').toLowerCase();
        if (!tl) {
          unknown = true;
          continue;
        }
        if (tl.includes('instant') || tl.includes('sorcery')) count += 1;
      }
      if (count >= n) return true;
      return unknown ? null : false;
    }
  }

  // "if they cast N or more spells this turn" (context-dependent; e.g. Because I Have Willed It)
  {
    const m = clause.match(/^if\s+they\s+cast\s+([a-z0-9]+)\s+or\s+more\s+spells\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const pid =
        refs?.theirPlayerId ??
        refs?.thatPlayerId ??
        refs?.referencedPlayerId ??
        (sourcePermanent as any)?.theirPlayerId ??
        (sourcePermanent as any)?.thatPlayerId ??
        (sourcePermanent as any)?.referencedPlayerId;
      if (typeof pid !== 'string' || !pid) return null;

      return getSpellsCastThisTurnByPlayerCount(ctx, String(pid)) >= n;
    }
  }

  // "if you've cast a spell this turn" / "if you cast a spell this turn"
  if (
    /^if\s+you'?ve\s+cast\s+a\s+spell\s+this\s+turn$/i.test(clause) ||
    /^if\s+you\s+cast\s+a\s+spell\s+this\s+turn$/i.test(clause)
  ) {
    return getSpellsCastThisTurnByPlayerCount(ctx, controllerId) >= 1;
  }

  // "if you cast two or more spells this turn"
  if (/^if\s+you\s+cast\s+two\s+or\s+more\s+spells\s+this\s+turn$/i.test(clause)) {
    return getSpellsCastThisTurnByPlayerCount(ctx, controllerId) >= 2;
  }

  // "if you've cast two or more spells this turn" / "if you have cast two or more spells this turn"
  if (
    /^if\s+you'?ve\s+cast\s+two\s+or\s+more\s+spells\s+this\s+turn$/i.test(clause) ||
    /^if\s+you\s+have\s+cast\s+two\s+or\s+more\s+spells\s+this\s+turn$/i.test(clause)
  ) {
    return getSpellsCastThisTurnByPlayerCount(ctx, controllerId) >= 2;
  }

  // "if you cast both a creature spell and a noncreature spell this turn"
  {
    const m = clause.match(/^if\s+you(?:\s+have|'?ve)?\s+cast\s+both\s+a\s+creature\s+spell\s+and\s+a\s+noncreature\s+spell\s+this\s+turn$/i);
    if (m) {
      const spells = getSpellsCastThisTurn(ctx).filter((s: any) => String(s?.casterId || "") === controllerId);
      let hasCreature = false;
      let hasNoncreature = false;
      let unknown = false;

      for (const s of spells) {
        const tl = String(s?.card?.type_line ?? s?.type_line ?? "").toLowerCase();
        if (!tl) {
          unknown = true;
          continue;
        }
        if (tl.includes("creature")) hasCreature = true;
        else hasNoncreature = true;
      }

      if (hasCreature && hasNoncreature) return true;
      if (!unknown) return false;
      return null;
    }
  }

  // "if you didn't cast a spell this turn" / "if you cast no spells this turn"
  if (
    /^if\s+you\s+(?:did\s+not|didn't)\s+cast\s+a\s+spell\s+this\s+turn$/i.test(clause) ||
    /^if\s+you\s+cast\s+no\s+spells\s+this\s+turn$/i.test(clause)
  ) {
    return getSpellsCastThisTurnByPlayerCount(ctx, controllerId) === 0;
  }

  // "if you haven't cast a spell from your hand this turn"
  if (/^if\s+you\s+haven'?t\s+cast\s+a\s+spell\s+from\s+your\s+hand\s+this\s+turn$/i.test(clause)) {
    return getSpellsCastFromHandThisTurnCount(ctx, controllerId) === 0;
  }

  // "if you (didn't|did not) play a card from exile this turn" (best-effort)
  if (
    /^if\s+you\s+(?:didn't|did\s+not)\s+play\s+a\s+card\s+from\s+exile\s+this\s+turn$/i.test(clause) ||
    /^if\s+you\s+(?:didn't|did\s+not)\s+play\s+a\s+card\s+from\s+exile\s+this\s+turn\.$/i.test(clause)
  ) {
    const stateAny = (ctx as any).state as any;
    const raw =
      stateAny?.playedFromExileThisTurn?.[controllerId] ??
      stateAny?.playedCardFromExileThisTurn?.[controllerId] ??
      stateAny?.cardsPlayedFromExileThisTurn?.[controllerId] ??
      stateAny?.castFromExileThisTurn?.[controllerId];
    if (typeof raw === 'boolean') return !raw;
    if (typeof raw === 'number') return raw === 0;
    return null;
  }

  // "if you played a card from exile this turn" (best-effort)
  if (/^if\s+you\s+played\s+a\s+card\s+from\s+exile\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const raw =
      stateAny?.playedFromExileThisTurn?.[controllerId] ??
      stateAny?.playedCardFromExileThisTurn?.[controllerId] ??
      stateAny?.cardsPlayedFromExileThisTurn?.[controllerId] ??
      stateAny?.castFromExileThisTurn?.[controllerId];
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw > 0;
    return null;
  }

  // "if a card left your graveyard this turn" (Gau, Feral Youth; Essence Anchor)
  if (
    /^if\s+a\s+card\s+left\s+your\s+graveyard\s+this\s+turn$/i.test(clause) ||
    /^if\s+a\s+card\s+left\s+your\s+graveyard\s+this\s+turn\.$/i.test(clause)
  ) {
    const stateAny = (ctx as any).state as any;
    const raw =
      stateAny?.cardLeftGraveyardThisTurn?.[controllerId] ??
      stateAny?.cardsLeftGraveyardThisTurn?.[controllerId] ??
      stateAny?.leftGraveyardThisTurn?.[controllerId];
    return typeof raw === 'boolean' ? raw : null;
  }

  // "if a creature card left your graveyard this turn" (Syrix, Carrier of the Flame)
  if (
    /^if\s+a\s+creature\s+card\s+left\s+your\s+graveyard\s+this\s+turn$/i.test(clause) ||
    /^if\s+a\s+creature\s+card\s+left\s+your\s+graveyard\s+this\s+turn\.$/i.test(clause)
  ) {
    const stateAny = (ctx as any).state as any;
    const raw =
      stateAny?.creatureCardLeftGraveyardThisTurn?.[controllerId] ??
      stateAny?.creatureCardsLeftGraveyardThisTurn?.[controllerId];
    return typeof raw === 'boolean' ? raw : null;
  }

  // "if you've cast a noncreature spell this turn"
  if (/^if\s+you'?ve\s+cast\s+a\s+noncreature\s+spell\s+this\s+turn$/i.test(clause) || /^if\s+you\s+have\s+cast\s+a\s+noncreature\s+spell\s+this\s+turn$/i.test(clause)) {
    return getNoncreatureSpellsCastThisTurnCount(ctx, controllerId) >= 1;
  }

  // "if an opponent cast a blue and/or black spell this turn" (Sandstalker Moloch)
  if (
    /^if\s+an\s+opponent\s+cast\s+a\s+(?:blue\s+and\/or\s+black|black\s+and\/or\s+blue)\s+spell\s+this\s+turn$/i.test(
      clause
    )
  ) {
    const opponentSpells = getSpellsCastThisTurn(ctx).filter((s: any) => String(s?.casterId || '') !== controllerId);
    if (opponentSpells.length === 0) return false;

    let unknown = false;
    for (const s of opponentSpells) {
      const colors = getSpellColorsThisTurnEntry(s);
      if (colors === null) {
        unknown = true;
        continue;
      }
      const set = new Set(colors);
      if (set.has('U') || set.has('B')) return true;
    }

    return unknown ? null : false;
  }

  // "if no spells were cast this turn"
  if (/^if\s+no\s+spells\s+were\s+cast\s+this\s+turn$/i.test(clause)) {
    return getSpellsCastThisTurn(ctx).length === 0;
  }

  // "if it was the second spell you cast this turn" (conservative; requires spell tracking)
  if (
    /^if\s+it\s+was\s+the\s+second\s+spell\s+you\s+cast\s+this\s+turn$/i.test(clause) ||
    /^if\s+it'?s\s+the\s+second\s+spell\s+you\s+cast\s+this\s+turn$/i.test(clause) ||
    /^if\s+it\s+is\s+the\s+second\s+spell\s+you\s+cast\s+this\s+turn$/i.test(clause) ||
    /^if\s+it'?s\s+the\s+second\s+spell\s+you'?ve\s+cast\s+this\s+turn$/i.test(clause) ||
    /^if\s+it\s+is\s+the\s+second\s+spell\s+you'?ve\s+cast\s+this\s+turn$/i.test(clause)
  ) {
    const raw = (ctx as any).state?.spellsCastThisTurn;
    if (!Array.isArray(raw)) return null;
    return getSpellsCastThisTurnByPlayerCount(ctx, controllerId) === 2;
  }

  // "if it's the second creature spell you cast this turn" (conservative; requires spell tracking)
  if (
    /^if\s+it'?s\s+the\s+second\s+creature\s+spell\s+you\s+cast\s+this\s+turn$/i.test(clause) ||
    /^if\s+it\s+is\s+the\s+second\s+creature\s+spell\s+you\s+cast\s+this\s+turn$/i.test(clause)
  ) {
    const raw = (ctx as any).state?.spellsCastThisTurn;
    if (!Array.isArray(raw)) return null;

    const spells = getSpellsCastThisTurn(ctx).filter((s: any) => String(s?.casterId || "") === controllerId);
    let creatureCount = 0;
    let unknown = false;

    for (const s of spells) {
      const tl = String(s?.card?.type_line ?? s?.type_line ?? "").toLowerCase();
      if (!tl) {
        unknown = true;
        continue;
      }
      if (tl.includes('creature')) creatureCount += 1;
    }

    if (!unknown) return creatureCount === 2;
    if (creatureCount > 2) return false;
    return null;
  }

  // "if it's the first spell you've cast this turn" / "if it's the first spell you cast this turn"
  if (
    /^if\s+it'?s\s+the\s+first\s+spell\s+you'?ve\s+cast\s+this\s+turn$/i.test(clause) ||
    /^if\s+it\s+is\s+the\s+first\s+spell\s+you'?ve\s+cast\s+this\s+turn$/i.test(clause) ||
    /^if\s+it'?s\s+the\s+first\s+spell\s+you\s+cast\s+this\s+turn$/i.test(clause) ||
    /^if\s+it\s+is\s+the\s+first\s+spell\s+you\s+cast\s+this\s+turn$/i.test(clause)
  ) {
    // At trigger time this typically runs after the spell has been recorded.
    return getSpellsCastThisTurnByPlayerCount(ctx, controllerId) === 1;
  }

  // "if no spells were cast last turn" (Werewolves / day-night style history)
  if (/^if\s+no\s+spells\s+were\s+cast\s+last\s+turn$/i.test(clause)) {
    const last = getSpellsCastLastTurnCount(ctx);
    return last === null ? null : last === 0;
  }

  // "if a player cast two or more spells last turn" (day/night style)
  if (/^if\s+a\s+player\s+cast\s+two\s+or\s+more\s+spells\s+last\s+turn$/i.test(clause)) {
    const counts = getSpellsCastLastTurnByPlayerCounts(ctx);
    if (!counts) return null;
    return Object.values(counts).some((n) => typeof n === 'number' && n >= 2);
  }

  // "if an opponent cast two or more spells last turn"
  if (/^if\s+an\s+opponent\s+cast\s+two\s+or\s+more\s+spells\s+last\s+turn$/i.test(clause)) {
    const counts = getSpellsCastLastTurnByPlayerCounts(ctx);
    if (!counts) return null;
    for (const [pid, n] of Object.entries(counts)) {
      if (pid === controllerId) continue;
      if (typeof n === 'number' && n >= 2) return true;
    }
    return false;
  }

  // "if you cast two or more spells last turn"
  if (/^if\s+you\s+cast\s+two\s+or\s+more\s+spells\s+last\s+turn$/i.test(clause)) {
    const counts = getSpellsCastLastTurnByPlayerCounts(ctx);
    if (!counts) return null;
    const n = typeof counts[controllerId] === 'number' ? counts[controllerId] : 0;
    return n >= 2;
  }

  // "if you cast no spells last turn"
  if (/^if\s+you\s+cast\s+no\s+spells\s+last\s+turn$/i.test(clause)) {
    const counts = getSpellsCastLastTurnByPlayerCounts(ctx);
    if (counts) {
      const n = typeof counts[controllerId] === 'number' ? counts[controllerId] : 0;
      return n === 0;
    }

    const last = getSpellsCastLastTurnCount(ctx);
    return last === null ? null : last === 0;
  }

  // "if you lost life last turn" (best-effort)
  if (/^if\s+you\s+lost\s+life\s+last\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const raw =
      stateAny?.lifeLostLastTurn?.[controllerId] ??
      stateAny?.lifeLostLastTurnByPlayer?.[controllerId] ??
      stateAny?.lifeLostLastTurnByPlayerCounts?.[controllerId];
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw > 0;
    return null;
  }

  // "if an opponent lost life last turn" (best-effort)
  if (/^if\s+an\s+opponent\s+lost\s+life\s+last\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const counts =
      stateAny?.lifeLostLastTurnByPlayerCounts ?? stateAny?.lifeLostLastTurnByPlayer ?? stateAny?.lifeLostLastTurn;
    if (!counts || typeof counts !== 'object') return null;

    const opps = getOpponentIds(ctx, controllerId);
    if (!opps.length) return false;

    for (const oid of opps) {
      const raw = (counts as any)[String(oid)];
      if (typeof raw === 'boolean') {
        if (raw) return true;
        continue;
      }
      if (typeof raw === 'number') {
        if (raw > 0) return true;
        continue;
      }
      // Unknown for this opponent => overall unknown.
      return null;
    }

    return false;
  }

  // Delirium: "if there are four or more card types among cards in your graveyard"
  if (/^if\s+there\s+are\s+four\s+or\s+more\s+card\s+types\s+among\s+cards\s+in\s+your\s+graveyard$/i.test(clause)) {
    return countCardTypesInGraveyard(ctx, controllerId) >= 4;
  }

  // "if N or more creature cards are in your graveyard"
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+creature\s+cards\s+are\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return countCreatureCardsInGraveyard(ctx, controllerId) >= n;
    }
  }

  // "if you're the defending player" (needs combat declaration context)
  if (/^if\s+you'?re\s+the\s+defending\s+player$/i.test(clause) || /^if\s+you\s+are\s+the\s+defending\s+player$/i.test(clause)) {
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(sourcePermanent, refs);
    if (!defendingPlayerId) return null;
    return String(controllerId) === String(defendingPlayerId);
  }

  // "if defending player controls more lands than you" (best-effort)
  if (/^if\s+defending\s+player\s+controls\s+more\s+lands\s+than\s+you$/i.test(clause)) {
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(sourcePermanent, refs);
    if (!defendingPlayerId) return null;
    const defLands = countByPermanentType(ctx, String(defendingPlayerId), 'land');
    const youLands = countByPermanentType(ctx, String(controllerId), 'land');
    return defLands > youLands;
  }

  // "if defending player controls no Walls" (best-effort)
  if (/^if\s+defending\s+player\s+controls\s+no\s+walls$/i.test(clause)) {
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(sourcePermanent, refs);
    if (!defendingPlayerId) return null;
    return countControlledCreatureSubtype(ctx, String(defendingPlayerId), 'wall') === 0;
  }

  // "if defending player has more cards in hand than you" (best-effort)
  if (/^if\s+defending\s+player\s+has\s+more\s+cards\s+in\s+hand\s+than\s+you$/i.test(clause)) {
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(sourcePermanent, refs);
    if (!defendingPlayerId) return null;
    return getHandCount(ctx, String(defendingPlayerId)) > getHandCount(ctx, String(controllerId));
  }

  // "if defending player has N or fewer cards in hand" (best-effort)
  {
    const m = clause.match(/^if\s+defending\s+player\s+has\s+([a-z0-9]+)\s+or\s+fewer\s+cards\s+in\s+hand$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const defendingPlayerId = getDefendingPlayerIdForInterveningIf(sourcePermanent, refs);
      if (!defendingPlayerId) return null;
      return getHandCount(ctx, String(defendingPlayerId)) <= n;
    }
  }

  // "if defending player is poisoned" (best-effort)
  if (/^if\s+defending\s+player\s+is\s+poisoned$/i.test(clause)) {
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(sourcePermanent, refs);
    if (!defendingPlayerId) return null;
    return getPoisonCounters(ctx, String(defendingPlayerId)) > 0;
  }

  // "if defending player controls no Glimmer creatures" (best-effort)
  if (/^if\s+defending\s+player\s+controls\s+no\s+glimmer\s+creatures$/i.test(clause)) {
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(sourcePermanent, refs);
    if (!defendingPlayerId) return null;
    return countControlledCreatureSubtype(ctx, String(defendingPlayerId), 'glimmer') === 0;
  }

  // "if defending player controls no black permanents" (best-effort, conservative)
  if (/^if\s+defending\s+player\s+controls\s+no\s+black\s+permanents$/i.test(clause)) {
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(sourcePermanent, refs);
    if (!defendingPlayerId) return null;
    const battlefield = (ctx as any).state?.battlefield || [];
    let sawUnknown = false;
    for (const p of Array.isArray(battlefield) ? battlefield : []) {
      if (!p || String(p.controller || '') !== String(defendingPlayerId)) continue;
      const isBlack = isPermanentBlack(p);
      if (isBlack === true) return false;
      if (isBlack === null) sawUnknown = true;
    }
    return sawUnknown ? null : true;
  }

  // "if defending player controls no black nontoken permanents" (best-effort, conservative)
  if (/^if\s+defending\s+player\s+controls\s+no\s+black\s+nontoken\s+permanents$/i.test(clause)) {
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(sourcePermanent, refs);
    if (!defendingPlayerId) return null;
    const battlefield = (ctx as any).state?.battlefield || [];
    let sawUnknown = false;
    for (const p of Array.isArray(battlefield) ? battlefield : []) {
      if (!p || String(p.controller || '') !== String(defendingPlayerId)) continue;
      if ((p as any).isToken === true) continue;
      const isBlack = isPermanentBlack(p);
      if (isBlack === true) return false;
      if (isBlack === null) sawUnknown = true;
    }
    return sawUnknown ? null : true;
  }

  // "if defending player controls an Enchanting Tale" (best-effort, conservative)
  if (/^if\s+defending\s+player\s+controls\s+an\s+enchanting\s+tale$/i.test(clause)) {
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(sourcePermanent, refs);
    if (!defendingPlayerId) return null;
    const battlefield = (ctx as any).state?.battlefield || [];
    let sawUnknown = false;
    for (const p of Array.isArray(battlefield) ? battlefield : []) {
      if (!p || String(p.controller || '') !== String(defendingPlayerId)) continue;
      const isET = isEnchantingTalePermanent(p);
      if (isET === true) return true;
      if (isET === null) sawUnknown = true;
    }
    return sawUnknown ? null : false;
  }

  // "if you're on the Mirran team" (Alchemy team assignment; best-effort)
  if (/^if\s+you'?re\s+on\s+the\s+mirran\s+team$/i.test(clause) || /^if\s+you\s+are\s+on\s+the\s+mirran\s+team$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const team = stateAny?.team?.[controllerId] ?? stateAny?.teams?.[controllerId] ?? stateAny?.playerTeam?.[controllerId];
    if (typeof team === 'string') return String(team).toLowerCase() === 'mirran';
    return null;
  }

  // "if you put a counter on a creature this turn" (best-effort)
  if (/^if\s+you\s+put\s+a\s+counter\s+on\s+a\s+creature\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const v =
      stateAny?.putCounterOnCreatureThisTurn?.[controllerId] ??
      stateAny?.placedCounterOnCreatureThisTurn?.[controllerId] ??
      stateAny?.countersPlacedOnCreaturesThisTurn?.[controllerId];
    return typeof v === 'boolean' ? v : null;
  }

  // "if a +1/+1 counter was put on a permanent under your control this turn" (Fairgrounds Trumpeter)
  if (
    /^if\s+a\s+\+1\/\+1\s+counter\s+was\s+put\s+on\s+a\s+permanent\s+under\s+your\s+control\s+this\s+turn$/i.test(
      clause
    )
  ) {
    const stateAny = (ctx as any).state as any;
    const v =
      stateAny?.putPlusOneCounterOnPermanentThisTurn?.[controllerId] ??
      stateAny?.placedPlusOneCounterOnPermanentThisTurn?.[controllerId] ??
      stateAny?.plusOneCounterPlacedOnPermanentThisTurn?.[controllerId];
    return typeof v === 'boolean' ? v : null;
  }

  // "if you sacrificed N or more Clues this turn" (best-effort)
  {
    const m = clause.match(/^if\s+you\s+sacrificed\s+([a-z0-9]+)\s+or\s+more\s+clues\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const stateAny = (ctx as any).state as any;
      const raw =
        stateAny?.cluesSacrificedThisTurn?.[controllerId] ??
        stateAny?.sacrificedCluesThisTurn?.[controllerId] ??
        stateAny?.cluesSacrificedThisTurnCount?.[controllerId];
      if (typeof raw === 'number') return raw >= n;
      return null;
    }
  }

  // "if that creature was dealt excess damage this turn" (needs specific excess-damage tracking)
  if (/^if\s+that\s+creature\s+was\s+dealt\s+excess\s+damage\s+this\s+turn$/i.test(clause)) {
    const thatId = (sourcePermanent as any)?.thatCreatureId ?? (sourcePermanent as any)?.referencedCreatureId;
    if (typeof thatId === 'string' && thatId) {
      const that = findBattlefieldPermanent(ctx, thatId);
      const v = (that as any)?.wasDealtExcessDamageThisTurn ?? (that as any)?.excessDamageThisTurn;
      return typeof v === 'boolean' ? v : null;
    }
    return null;
  }

  // Keyword shorthand: delirium
  if (/^if\s+you\s+have\s+delirium$/i.test(clause)) {
    return countCardTypesInGraveyard(ctx, controllerId) >= 4;
  }

  // Keyword shorthand: hellbent
  if (/^if\s+you\s+have\s+hellbent$/i.test(clause)) {
    return getHandCount(ctx, controllerId) === 0;
  }

  // Hand empty variants
  if (
    /^if\s+you\s+have\s+no\s+cards\s+in\s+your\s+hand$/i.test(clause) ||
    /^if\s+you\s+have\s+no\s+cards\s+in\s+hand$/i.test(clause)
  ) {
    return getHandCount(ctx, controllerId) === 0;
  }

  // Keyword shorthand: metalcraft
  if (/^if\s+you\s+have\s+metalcraft$/i.test(clause)) {
    return countByPermanentType(ctx, controllerId, 'artifact') >= 3;
  }

  // Threshold keyword shorthand
  if (/^if\s+you\s+have\s+threshold$/i.test(clause)) {
    return getGraveyardCount(ctx, controllerId) >= 7;
  }

  // Threshold template: "If seven or more cards are in your graveyard"
  if (/^if\s+seven\s+or\s+more\s+cards?\s+are\s+in\s+your\s+graveyard$/i.test(clause)) {
    return getGraveyardCount(ctx, controllerId) >= 7;
  }

  // Threshold template: "If N or more cards are in your graveyard"
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+cards?\s+are\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getGraveyardCount(ctx, controllerId) >= n;
    }
  }

  // Graveyard empty variants
  if (
    /^if\s+you\s+have\s+no\s+cards\s+in\s+your\s+graveyard$/i.test(clause) ||
    /^if\s+you\s+have\s+no\s+cards\s+in\s+graveyard$/i.test(clause) ||
    /^if\s+your\s+graveyard\s+is\s+empty$/i.test(clause)
  ) {
    return getGraveyardCount(ctx, controllerId) === 0;
  }

  // Graveyard count templates: "If you have N or more/fewer cards in your graveyard" / "If there are N or more/fewer cards in your graveyard"
  {
    const m = clause.match(/^if\s+(?:you\s+have|there\s+are)\s+([a-z0-9]+)\s+or\s+more\s+cards?\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getGraveyardCount(ctx, controllerId) >= n;
    }
  }
  {
    const m = clause.match(/^if\s+(?:you\s+have|there\s+are)\s+([a-z0-9]+)\s+or\s+(?:fewer|less)\s+cards?\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getGraveyardCount(ctx, controllerId) <= n;
    }
  }
  {
    const m = clause.match(/^if\s+(?:you\s+have|there\s+are)\s+exactly\s+([a-z0-9]+)\s+cards?\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getGraveyardCount(ctx, controllerId) === n;
    }
  }

  // Graveyard name check: "if <card name> is in your graveyard"
  {
    const m = clause.match(/^if\s+(.+?)\s+is\s+in\s+your\s+graveyard$/i);
    if (m) {
      const nameRaw = String(m[1] || "").trim();
      const name = nameRaw === "~" && sourcePermanent?.card?.name ? String(sourcePermanent.card.name) : nameRaw;
      if (!name) return null;
      const lowerName = name.toLowerCase();
      return getGraveyard(ctx, controllerId).some((c: any) => String(c?.name || "").toLowerCase() === lowerName);
    }
  }

  // Ferocious-style: "if you control a creature with power N or greater"
  {
    const m = clause.match(/^if\s+you\s+control\s+a\s+creature\s+with\s+power\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getControlledCreatures(ctx, controllerId).some((c: any) => getPermanentPower(c, ctx) >= n);
    }
  }

  // "if its power is N or greater" (best-effort: source permanent)
  {
    const m = clause.match(/^if\s+its\s+power\s+is\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      if (!sourcePermanent) return null;
      return getPermanentPower(sourcePermanent, ctx) >= n;
    }
  }

  // "if enchanted creature's power is N or greater" (best-effort: aura attachedTo)
  {
    const m = clause.match(/^if\s+enchanted\s+creature'?s\s+power\s+is\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      if (!sourcePermanent) return null;
      const attachedTo = String((sourcePermanent as any)?.attachedTo || '');
      if (!attachedTo) return null;
      const enchanted = findBattlefieldPermanent(ctx, attachedTo);
      if (!enchanted) return null;
      return getPermanentPower(enchanted, ctx) >= n;
    }
  }

  // "if enchanted creature has <keyword>" (best-effort: aura attachedTo)
  {
    const m = clause.match(/^if\s+enchanted\s+creature\s+has\s+(flying|toxic)$/i);
    if (m) {
      if (!sourcePermanent) return null;
      const attachedTo = String((sourcePermanent as any)?.attachedTo || '');
      if (!attachedTo) return null;
      const enchanted = findBattlefieldPermanent(ctx, attachedTo);
      if (!enchanted) return null;
      return permanentHasKeyword(enchanted, String(m[1] || '').toLowerCase());
    }
  }

  // "if enchanted creature is untapped" (best-effort: aura attachedTo)
  if (/^if\s+enchanted\s+creature\s+is\s+untapped$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const attachedTo = String((sourcePermanent as any)?.attachedTo || '');
    if (!attachedTo) return null;
    const enchanted = findBattlefieldPermanent(ctx, attachedTo);
    if (!enchanted) return null;
    if (typeof (enchanted as any).tapped !== 'boolean') return null;
    return !(enchanted as any).tapped;
  }

  // "if enchanted creature is red" (best-effort: aura attachedTo)
  if (/^if\s+enchanted\s+creature\s+is\s+red$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const attachedTo = String((sourcePermanent as any)?.attachedTo || '');
    if (!attachedTo) return null;
    const enchanted = findBattlefieldPermanent(ctx, attachedTo);
    if (!enchanted) return null;
    return isPermanentRed(enchanted);
  }

  // "if enchanted creature is a Wolf or Werewolf" (best-effort: aura attachedTo)
  if (/^if\s+enchanted\s+creature\s+is\s+a\s+wolf\s+or\s+werewolf$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const attachedTo = String((sourcePermanent as any)?.attachedTo || '');
    if (!attachedTo) return null;
    const enchanted = findBattlefieldPermanent(ctx, attachedTo);
    if (!enchanted) return null;
    const tl = String(enchanted?.card?.type_line || '');
    if (!tl) return null;
    return typeLineHasWord(tl, 'wolf') || typeLineHasWord(tl, 'werewolf');
  }

  // "if enchanted permanent is tapped" (best-effort: aura attachedTo)
  if (/^if\s+enchanted\s+permanent\s+is\s+tapped$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const attachedTo = String((sourcePermanent as any)?.attachedTo || '');
    if (!attachedTo) return null;
    const enchanted = findBattlefieldPermanent(ctx, attachedTo);
    if (!enchanted) return null;
    if (typeof (enchanted as any).tapped !== 'boolean') return null;
    return (enchanted as any).tapped;
  }

  // "if enchanted permanent is a creature with the greatest power among creatures on the battlefield" (conservative)
  if (
    /^if\s+enchanted\s+permanent\s+is\s+a\s+creature\s+with\s+the\s+greatest\s+power\s+among\s+creatures\s+on\s+the\s+battlefield$/i.test(
      clause
    )
  ) {
    if (!sourcePermanent) return null;
    const attachedTo = String((sourcePermanent as any)?.attachedTo || '');
    if (!attachedTo) return null;
    const enchanted = findBattlefieldPermanent(ctx, attachedTo);
    if (!enchanted) return null;

    const enchantedTl = String(enchanted?.card?.type_line || '').toLowerCase();
    if (!enchantedTl) return null;
    if (!enchantedTl.includes('creature')) return false;

    const battlefield = (ctx as any).state?.battlefield || [];
    if (!Array.isArray(battlefield)) return null;

    const powerMaybe = (p: any): number | null => {
      const candidates = [p?.effectivePower, p?.power, p?.basePower, p?.card?.power];
      for (const c of candidates) {
        const parsed = parseMaybeNumber(c);
        if (parsed !== null) return parsed;
      }
      return null;
    };

    const enchantedPower = powerMaybe(enchanted);
    if (enchantedPower === null) return null;

    let unknownOtherCreaturePower = false;
    for (const p of battlefield) {
      if (!p) continue;
      const tl = String(p?.card?.type_line || '').toLowerCase();
      if (!tl) {
        // If we can't even tell whether this is a creature, we can't decide a global "greatest power among creatures" check.
        unknownOtherCreaturePower = true;
        continue;
      }
      if (!tl.includes('creature')) continue;

      const pow = powerMaybe(p);
      if (pow === null) {
        unknownOtherCreaturePower = true;
        continue;
      }
      if (pow > enchantedPower) return false;
    }

    return unknownOtherCreaturePower ? null : true;
  }

  // "if enchanted Equipment is attached to a creature" (best-effort: aura attachedTo)
  if (/^if\s+enchanted\s+equipment\s+is\s+attached\s+to\s+a\s+creature$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const attachedTo = String((sourcePermanent as any)?.attachedTo || '');
    if (!attachedTo) return null;
    const enchantedEquipment = findBattlefieldPermanent(ctx, attachedTo);
    if (!enchantedEquipment) return null;

    const tl = String(enchantedEquipment?.card?.type_line || '').toLowerCase();
    if (!tl.includes('equipment')) return false;

    const eqAttachedTo = String((enchantedEquipment as any)?.attachedTo || '');
    if (!eqAttachedTo) return false;
    const creature = findBattlefieldPermanent(ctx, eqAttachedTo);
    if (!creature) return null;
    const creatureTl = String(creature?.card?.type_line || '').toLowerCase();
    if (!creatureTl) return null;
    return creatureTl.includes('creature');
  }

  // "if its toughness is N or less" (best-effort: source permanent)
  {
    const m = clause.match(/^if\s+its\s+toughness\s+is\s+([a-z0-9]+)\s+or\s+less$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      if (!sourcePermanent) return null;
      return getPermanentToughness(sourcePermanent, ctx) <= n;
    }
  }

  // "if its power is N or less" (best-effort: source permanent)
  {
    const m = clause.match(/^if\s+its\s+power\s+is\s+([a-z0-9]+)\s+or\s+less$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      if (!sourcePermanent) return null;
      const pow = getPermanentPowerMaybe(sourcePermanent);
      if (pow === null) return null;
      return pow <= n;
    }
  }

  // "if its power is greater than N" (best-effort: source permanent)
  {
    const m = clause.match(/^if\s+its\s+power\s+is\s+greater\s+than\s+([a-z0-9]+)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      if (!sourcePermanent) return null;
      const pow = getPermanentPowerMaybe(sourcePermanent);
      if (pow === null) return null;
      return pow > n;
    }
  }

  // "if its power was N or greater" (best-effort: current/attached power snapshot)
  {
    const m = clause.match(/^if\s+its\s+power\s+was\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      if (!sourcePermanent) return null;
      const pow = getPermanentPowerMaybe(sourcePermanent);
      if (pow === null) return null;
      return pow >= n;
    }
  }

  // "if its toughness was less than N" (best-effort: current/attached toughness snapshot)
  {
    const m = clause.match(/^if\s+its\s+toughness\s+was\s+less\s+than\s+([a-z0-9]+)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      if (!sourcePermanent) return null;
      const tou = getPermanentToughnessMaybe(sourcePermanent, ctx);
      if (tou === null) return null;
      return tou < n;
    }
  }

  // "if it wasn't blocking" (best-effort)
  if (/^if\s+it\s+wasn't\s+blocking$/i.test(clause) || /^if\s+it\s+was\s+not\s+blocking$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return !isPermanentBlocking(sourcePermanent);
  }

  // "if it isn't being declared as an attacker" (best-effort)
  if (/^if\s+it\s+isn't\s+being\s+declared\s+as\s+an\s+attacker$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return !isPermanentAttacking(sourcePermanent);
  }

  // "if it was enchanted or equipped" (best-effort)
  if (/^if\s+it\s+was\s+enchanted\s+or\s+equipped$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return isPermanentEnchanted(ctx, sourcePermanent) || isPermanentEquipped(ctx, sourcePermanent);
  }

  // "if it was enchanted" (best-effort)
  if (/^if\s+it\s+was\s+enchanted$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return isPermanentEnchanted(ctx, sourcePermanent);
  }

  // "if it was equipped" (best-effort)
  if (/^if\s+it\s+was\s+equipped$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return isPermanentEquipped(ctx, sourcePermanent);
  }

  // "if it was a <subtype>" (best-effort: source permanent type_line)
  {
    const m = clause.match(/^if\s+it\s+was\s+a\s+([a-z0-9-]+)$/i);
    if (m) {
      if (!sourcePermanent) return null;
      const subtype = String(m[1] || '').toLowerCase();
      const tl = String(sourcePermanent?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      return new RegExp(`\\b${subtype.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i').test(tl);
    }
  }

  // "if it wasn't a/an <subtype>" (best-effort: source permanent type_line)
  {
    const m = clause.match(/^if\s+it\s+(?:wasn't|was\s+not)\s+(?:a|an)\s+([a-z0-9-]+)$/i);
    if (m) {
      if (!sourcePermanent) return null;
      const subtype = String(m[1] || '').toLowerCase();
      const tl = String(sourcePermanent?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      return !new RegExp(`\\b${subtype.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i').test(tl);
    }
  }

  // "if he wasn't a/an <subtype>" (same as "it"; best-effort)
  {
    const m = clause.match(/^if\s+he\s+(?:wasn't|was\s+not)\s+(?:a|an)\s+([a-z0-9-]+)$/i);
    if (m) {
      if (!sourcePermanent) return null;
      const subtype = String(m[1] || '').toLowerCase();
      const tl = String(sourcePermanent?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      return !new RegExp(`\\b${subtype.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i').test(tl);
    }
  }

  // "if it's not a/an <subtype>" (best-effort: source permanent type_line)
  {
    const m = clause.match(/^if\s+it'?s\s+not\s+(?:(?:a|an)\s+)?([a-z0-9-]+)$/i);
    if (m) {
      if (!sourcePermanent) return null;
      const subtype = String(m[1] || '').toLowerCase();
      const tl = String(sourcePermanent?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      return !new RegExp(`\\b${subtype.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i').test(tl);
    }
  }

  // "if it is not a/an <subtype>" (same as "it's not"; best-effort)
  {
    const m = clause.match(/^if\s+it\s+is\s+not\s+(?:(?:a|an)\s+)?([a-z0-9-]+)$/i);
    if (m) {
      if (!sourcePermanent) return null;
      const subtype = String(m[1] || '').toLowerCase();
      const tl = String(sourcePermanent?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      return !new RegExp(`\\b${subtype.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i').test(tl);
    }
  }

  // Guardian Project-style uniqueness:
  // "if it doesn't have the same name as another creature you control or a creature card in your graveyard" (conservative)
  if (
    /^if\s+it\s+doesn't\s+have\s+the\s+same\s+name\s+as\s+another\s+creature\s+you\s+control\s+or\s+a\s+creature\s+card\s+in\s+your\s+graveyard$/i.test(
      clause
    ) ||
    /^if\s+it\s+does\s+not\s+have\s+the\s+same\s+name\s+as\s+another\s+creature\s+you\s+control\s+or\s+a\s+creature\s+card\s+in\s+your\s+graveyard$/i.test(
      clause
    )
  ) {
    if (!sourcePermanent) return null;
    const name = String(sourcePermanent?.card?.name || sourcePermanent?.name || '').trim();
    if (!name) return null;

    // Graveyard evidence can prove false even if battlefield tracking is missing.
    const zones = (ctx as any).state?.zones;
    const yourZones = zones && typeof zones === 'object' ? (zones as any)[String(controllerId)] : null;
    const graveyard = yourZones?.graveyard;
    if (!Array.isArray(graveyard)) return null;
    for (const c of graveyard) {
      if (!c) continue;
      const cn = String(c?.name || c?.card?.name || '').trim();
      if (!cn) continue;
      if (cn !== name) continue;
      const tl = String(c?.type_line || c?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      if (tl.includes('creature')) return false;
    }

    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    for (const p of battlefield) {
      if (!p) continue;
      if (String(p.controller || '') !== String(controllerId)) continue;
      if (String(p.id || '') === String(sourcePermanent.id || '')) continue;
      const tl = String(p?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      if (!tl.includes('creature')) continue;
      const otherName = String(p?.card?.name || p?.name || '').trim();
      if (!otherName) return null;
      if (otherName === name) return false;
    }

    return true;
  }

  // "if a/an/another <type> entered the battlefield under your control this turn" (best-effort)
  {
    const m = clause.match(
      /^if\s+(a|an|another)\s+(artifact|creature|enchantment|planeswalker|land|battle)\s+entered\s+(?:the\s+)?battlefield\s+under\s+your\s+control\s+this\s+turn$/i
    );
    if (m) {
      const kind = String(m[1] || '').toLowerCase();
      const typeLower = String(m[2] || '').toLowerCase();
      const exclude = kind === 'another' ? String((sourcePermanent as any)?.id || '') : '';
      const c = countControlledEnteredThisTurn(ctx, controllerId, typeLower, exclude || undefined);
      if (c === null) return null;
      return c > 0;
    }
  }

  // "if N or more artifacts/creatures entered the battlefield under your control this turn" (best-effort)
  {
    const m = clause.match(
      /^if\s+([a-z0-9]+)\s+or\s+more\s+(artifacts|creatures)\s+entered\s+(?:the\s+)?battlefield\s+under\s+your\s+control\s+this\s+turn\s*[,.]?$/i
    );
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const subject = String(m[2] || '').toLowerCase();
      const typeLower = subject === 'artifacts' ? 'artifact' : 'creature';
      const c = countControlledEnteredThisTurn(ctx, controllerId, typeLower);
      if (c === null) return null;
      return c >= n;
    }
  }

  // "if two or more artifacts entered under your control this turn" (variant without "the battlefield")
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+artifacts\s+entered\s+under\s+your\s+control\s+this\s+turn\s*[,.]?$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const c = countControlledEnteredThisTurn(ctx, controllerId, 'artifact');
      if (c === null) return null;
      return c >= n;
    }
  }

  // "if no creatures entered the battlefield under your control this turn" (best-effort)
  if (/^if\s+no\s+creatures\s+entered\s+(?:the\s+)?battlefield\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {
    const c = countControlledEnteredThisTurn(ctx, controllerId, 'creature');
    if (c === null) return null;
    return c === 0;
  }

  // Pack tactics / total power: "if you attacked with creatures with total power N or greater"
  {
    const m = clause.match(/^if\s+you\s+attacked\s+with\s+creatures\s+with\s+total\s+power\s+([a-z0-9]+)\s+or\s+greater(?:\s+this\s+combat)?$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getAttackingTotalPower(ctx, controllerId) >= n;
    }
  }

  // "if creatures you control have total power N or greater"
  {
    const m = clause.match(/^if\s+creatures\s+you\s+control\s+have\s+total\s+power\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const total = getControlledCreatures(ctx, controllerId).reduce((sum: number, p: any) => sum + getPermanentPower(p), 0);
      return total >= n;
    }
  }

  // "if creatures you control have total toughness N or greater" (best-effort)
  {
    const m = clause.match(/^if\s+creatures\s+you\s+control\s+have\s+total\s+toughness\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const battlefield = (ctx as any).state?.battlefield || [];
      if (!Array.isArray(battlefield)) return null;

      let total = 0;
      let unknown = false;
      for (const p of getControlledCreatures(ctx, controllerId)) {
        const candidates = [p?.effectiveToughness, p?.toughness, p?.baseToughness, p?.card?.toughness];
        let found: number | null = null;
        for (const c of candidates) {
          const parsed = parseMaybeNumber(c);
          if (parsed !== null) {
            found = parsed;
            break;
          }
        }

        if (found === null) {
          unknown = true;
          // Still use best-effort computed toughness to avoid undercounting when bonuses are tracked.
          total += getPermanentToughness(p, ctx);
        } else {
          total += found;
        }
      }

      if (total >= n) return true;
      return unknown ? null : false;
    }
  }

  // "if it was attacking or blocking alone" (best-effort; only checks current combat state)
  if (/^if\s+(?:it|this\s+creature)\s+was\s+attacking\s+or\s+blocking\s+alone$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const battlefield = (ctx as any).state?.battlefield || [];
    if (!Array.isArray(battlefield)) return null;

    const sourceActive = isPermanentAttacking(sourcePermanent) || isPermanentBlocking(sourcePermanent);
    if (!sourceActive) return null;

    const sourceId = String((sourcePermanent as any)?.id || '');
    const othersActive = getControlledCreatures(ctx, controllerId).some((p: any) => {
      if (!p) return false;
      if (sourceId && String(p?.id || '') === sourceId) return false;
      return isPermanentAttacking(p) || isPermanentBlocking(p);
    });

    return othersActive ? false : true;
  }

  // "if it's attacking alone" / "if it is attacking alone" / "if you attacked with exactly one creature"
  if (/^if\s+(?:it'?s|it\s+is)\s+attacking\s+alone$/i.test(clause)) {
    return getAttackingCreatures(ctx, controllerId).length === 1;
  }
  if (/^if\s+you\s+attacked\s+with\s+exactly\s+one\s+creature$/i.test(clause)) {
    return getAttackingCreatures(ctx, controllerId).length === 1;
  }
  if (/^if\s+exactly\s+one\s+creature\s+attacked$/i.test(clause)) {
    // Global check: any player. Approximate via total attacking creatures on battlefield.
    const battlefield = (ctx as any).state?.battlefield || [];
    const attacking = (Array.isArray(battlefield) ? battlefield : []).filter((p: any) => {
      if (!p) return false;
      const tl = String(p.card?.type_line || "").toLowerCase();
      if (!tl.includes("creature")) return false;
      return !!p.attacking || p.isAttacking === true;
    });
    return attacking.length === 1;
  }

  // Equipped / tapped checks (source permanent)
  if (/^if\s+it\s+is\s+equipped$/i.test(clause) || /^if\s+it'?s\s+equipped$/i.test(clause)) {
    if (!sourcePermanent) return null;
    if (sourcePermanent.isEquipped === true) return true;
    const attachedEquipment = sourcePermanent.attachedEquipment;
    if (Array.isArray(attachedEquipment)) return attachedEquipment.length > 0;
    const attachments = sourcePermanent.attachments;
    if (Array.isArray(attachments)) {
      // Best-effort: consider any attachment as "equipped" only if that attachment looks like equipment.
      const battlefield = (ctx as any).state?.battlefield || [];
      return attachments.some((id: any) => {
        const a = (Array.isArray(battlefield) ? battlefield : []).find((p: any) => p?.id === id);
        const tl = String(a?.card?.type_line || "").toLowerCase();
        return tl.includes("equipment");
      });
    }
    return false;
  }

  if (/^if\s+it\s+is\s+tapped$/i.test(clause) || /^if\s+it'?s\s+tapped$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return sourcePermanent.tapped === true;
  }

  // Combat state checks (source permanent)
  if (/^if\s+it\s+is\s+attacking$/i.test(clause) || /^if\s+it'?s\s+attacking$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return isPermanentAttacking(sourcePermanent);
  }

  if (/^if\s+it\s+is\s+blocking$/i.test(clause) || /^if\s+it'?s\s+blocking$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return isPermanentBlocking(sourcePermanent);
  }

  if (/^if\s+it\s+is\s+blocked$/i.test(clause) || /^if\s+it'?s\s+blocked$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return isPermanentBlocked(sourcePermanent);
  }

  if (
    /^if\s+it\s+isn'?t\s+blocked$/i.test(clause) ||
    /^if\s+it\s+is\s+not\s+blocked$/i.test(clause) ||
    /^if\s+it'?s\s+not\s+blocked$/i.test(clause) ||
    /^if\s+it'?s\s+unblocked$/i.test(clause) ||
    /^if\s+it\s+is\s+unblocked$/i.test(clause)
  ) {
    if (!sourcePermanent) return null;
    return !isPermanentBlocked(sourcePermanent);
  }

  if (/^if\s+it\s+is\s+untapped$/i.test(clause) || /^if\s+it'?s\s+untapped$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return sourcePermanent.tapped !== true;
  }

  if (/^if\s+it\s+is\s+enchanted$/i.test(clause) || /^if\s+it'?s\s+enchanted$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return isPermanentEnchanted(ctx, sourcePermanent);
  }

  if (
    /^if\s+it\s+is\s+enchanted\s+or\s+equipped$/i.test(clause) ||
    /^if\s+it'?s\s+enchanted\s+or\s+equipped$/i.test(clause)
  ) {
    if (!sourcePermanent) return null;
    return isPermanentEnchanted(ctx, sourcePermanent) || isPermanentEquipped(ctx, sourcePermanent);
  }

  // Covenant (Coven): "if you control three or more creatures with different powers"
  if (/^if\s+you\s+control\s+three\s+or\s+more\s+creatures\s+with\s+different\s+powers$/i.test(clause)) {
    const powers = new Set<number>();
    for (const c of getControlledCreatures(ctx, controllerId)) {
      powers.add(getPermanentPower(c));
      if (powers.size >= 3) return true;
    }
    return false;
  }

  // Biovisionary: "if you control four or more creatures named <name>"
  {
    const m = clause.match(/^if\s+you\s+control\s+four\s+or\s+more\s+creatures\s+named\s+(.+?)$/i);
    if (m) {
      const name = String(m[1] || "").trim();
      if (!name) return null;
      const lower = name.toLowerCase();
      const count = getControlledCreatures(ctx, controllerId).filter((c: any) => String(c?.card?.name || "").toLowerCase() === lower).length;
      return count >= 4;
    }
  }

  // Battle of Wits: "if you have 200 or more cards in your library"
  {
    const m = clause.match(/^if\s+you\s+have\s+([a-z0-9]+)\s+or\s+more\s+cards?\s+in\s+your\s+library$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getLibraryCount(ctx, controllerId) >= n;
    }
  }

  // Library count variants: "N or fewer" / "exactly N"
  {
    const m = clause.match(/^if\s+you\s+have\s+([a-z0-9]+)\s+or\s+(?:fewer|less)\s+cards?\s+in\s+your\s+library$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getLibraryCount(ctx, controllerId) <= n;
    }
  }
  {
    const m = clause.match(/^if\s+you\s+have\s+exactly\s+([a-z0-9]+)\s+cards?\s+in\s+your\s+library$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getLibraryCount(ctx, controllerId) === n;
    }
  }

  // Mortal Combat-style: "if there are N or more creature cards in your graveyard"
  {
    const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+creature\s+cards\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const count = getGraveyard(ctx, controllerId).filter((c: any) => String(c?.type_line || "").toLowerCase().includes("creature")).length;
      return count >= n;
    }
  }

  // "if there's a lesson card in your graveyard"
  if (/^if\s+there'?s\s+a\s+lesson\s+card\s+in\s+your\s+graveyard$/i.test(clause)) {
    return getGraveyard(ctx, controllerId).some((c: any) => String(c?.type_line || '').toLowerCase().includes('lesson'));
  }

  // Spell/ability structure checks that require stack-item context (not currently threaded into this evaluator).
  if (/^if\s+it\s+has\s+a\s+single\s+target$/i.test(clause)) {
    const c = getInterveningIfTargetCount(ctx, refs, sourcePermanent);
    if (c === null) return null;
    return c === 1;
  }
  if (/^if\s+it\s+has\s+madness$/i.test(clause)) return null;
  if (/^if\s+that\s+spell\s+was\s+kicked$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const wasKicked = (sourcePermanent as any)?.wasKicked === true || (sourcePermanent as any)?.card?.wasKicked === true;
    return wasKicked;
  }

  // Alternate cost paid templates (recognized; requires cast metadata)
  if (/^if\s+its\s+prowl\s+cost\s+was\s+paid$/i.test(clause)) return null;
  if (/^if\s+its\s+surge\s+cost\s+was\s+paid$/i.test(clause)) return null;

  // Unearth templates (best-effort: cast metadata)
  if (/^if\s+it\s+was\s+unearthed$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const v = (sourcePermanent as any)?.wasUnearthed ?? (sourcePermanent as any)?.card?.wasUnearthed ?? (sourcePermanent as any)?.unearthed;
    return typeof v === 'boolean' ? v : null;
  }

  // "if it wasn't cast" (recognized; requires cast metadata)
  if (/^if\s+it\s+wasn't\s+cast$/i.test(clause) || /^if\s+it\s+was\s+not\s+cast$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const wasCast = (sourcePermanent as any)?.wasCast ?? (sourcePermanent as any)?.card?.wasCast;
    if (typeof wasCast === 'boolean') return !wasCast;
    return null;
  }

  // "if it shares a card type with the exiled card" (recognized; requires linking the exiled card)
  if (/^if\s+it\s+shares\s+a\s+card\s+type\s+with\s+the\s+exiled\s+card$/i.test(clause)) {
    if (!sourcePermanent) return null;

    const srcId = String((sourcePermanent as any)?.id ?? (sourcePermanent as any)?.permanentId ?? '');
    if (!srcId) return null;

    // Find the exiled card linked to the source permanent.
    // Best-effort: look for exile-zone tags written by common "exile ..." templates.
    let exiledCard: any = null;
    const zones = (ctx as any).state?.zones;
    if (zones && typeof zones === 'object') {
      for (const z of Object.values(zones as any)) {
        const exile = (z as any)?.exile;
        if (!Array.isArray(exile)) continue;
        const found = exile.find((c: any) => String(c?.exiledWithSourceId ?? '') === srcId);
        if (found) {
          exiledCard = found;
          break;
        }
      }
    }
    if (!exiledCard) return null;

    // Find the triggering spell/land/etc represented by "it".
    // Prefer explicit stackItem ref; otherwise use triggering stack id lookup.
    const refStackItemCard = (refs as any)?.stackItem?.card;
    const stackId = refs?.triggeringStackItemId ?? (sourcePermanent as any)?.triggeringStackItemId ?? (sourcePermanent as any)?.triggeringSpellStackItemId;
    const stack: any[] = Array.isArray((ctx as any).state?.stack) ? (ctx as any).state.stack : [];
    const triggeringStackItem = !refStackItemCard && stackId ? stack.find((it: any) => it && String(it.id) === String(stackId)) : null;
    const triggeringCard = refStackItemCard ?? triggeringStackItem?.card;

    const exiledTypeLine = String(exiledCard?.type_line || exiledCard?.card?.type_line || '').toLowerCase();
    const triggeringTypeLine = String(triggeringCard?.type_line || '').toLowerCase();
    if (!exiledTypeLine || !triggeringTypeLine) return null;

    const toCardTypeSet = (typeLineLower: string): Set<string> => {
      const base = String(typeLineLower.split('—')[0] || '').trim();
      const types = ['artifact', 'creature', 'enchantment', 'land', 'planeswalker', 'instant', 'sorcery', 'tribal', 'battle'];
      const out = new Set<string>();
      for (const t of types) {
        if (base.includes(t)) out.add(t);
      }
      return out;
    };

    const exiledTypes = toCardTypeSet(exiledTypeLine);
    const triggeringTypes = toCardTypeSet(triggeringTypeLine);
    if (exiledTypes.size === 0 || triggeringTypes.size === 0) return null;

    for (const t of exiledTypes) {
      if (triggeringTypes.has(t)) return true;
    }
    return false;
  }

  // "if it shares a creature type with <Named Creature>" (best-effort: requires source permanent and the named creature on battlefield)
  {
    const m = clause.match(/^if\s+it\s+shares\s+a\s+creature\s+type\s+with\s+(.+)$/i);
    if (m) {
      if (!sourcePermanent) return null;
      const targetName = String(m[1] || '').trim();
      if (!targetName) return null;

      const getCreatureTypeSet = (typeLine: string): Set<string> | null => {
        const tl = String(typeLine || '').trim();
        if (!tl) return null;
        const lower = tl.toLowerCase();
        if (!lower.includes('creature')) return null;

        const parts = tl.includes('—') ? tl.split('—') : tl.split(' - ');
        const right = String(parts[1] || '').trim();
        if (!right) return null;
        const tokens = right
          .split(/\s+/g)
          .map((t) => String(t || '').trim())
          .filter(Boolean);
        if (!tokens.length) return null;
        return new Set(tokens.map((t) => t.toLowerCase()));
      };

      const srcTypeLine = String(sourcePermanent?.card?.type_line || '').trim();
      const srcTypes = getCreatureTypeSet(srcTypeLine);
      if (!srcTypes) return null;

      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;

      const nameMatches = (perm: any): boolean => {
        const n = String(perm?.card?.name || perm?.name || '').trim();
        return n.toLowerCase() === targetName.toLowerCase();
      };

      const candidates = battlefield.filter((p: any) => p && nameMatches(p));
      if (!candidates.length) return null;

      let sawComparable = false;
      for (const p of candidates) {
        const types = getCreatureTypeSet(String(p?.card?.type_line || '').trim());
        if (!types) continue;
        sawComparable = true;
        for (const t of types) {
          if (srcTypes.has(t)) return true;
        }
      }
      return sawComparable ? false : null;
    }
  }

  // Newer mechanics / multiplayer-specific templates (recognized; engine may not model these yet)
  if (/^if\s+evidence\s+was\s+collected$/i.test(clause)) {
    const map = (ctx as any).state?.evidenceCollectedThisTurn;
    const v = map?.[controllerId];
    return typeof v === 'boolean' ? v : null;
  }
  if (/^if\s+all\s+your\s+commanders\s+have\s+been\s+revealed$/i.test(clause)) return null;
  if (/^if\s+play\s+had\s+proceeded\s+clockwise\s+around\s+the\s+table$/i.test(clause)) return null;
  if (/^if\s+the\s+gift\s+was\s+promised$/i.test(clause)) return null;
  if (/^if\s+this\s+card\s+is\s+exiled$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const z = String((sourcePermanent as any)?.zone ?? (sourcePermanent as any)?.card?.zone ?? '').toLowerCase();
    if (z) return z === 'exile';
    return null;
  }
  if (/^if\s+this\s+card\s+is\s+in\s+your\s+graveyard\s+with\s+a\s+creature\s+card\s+directly\s+above\s+it$/i.test(clause)) return null;

  // ===== Additional scalable fallback burn-down patterns =====

  // Snow mana templates (recognized; we don't currently track snow payment)
  if (/^if\s+\{s\}\s+of\s+any\s+of\s+that\s+spell'?s\s+colors\s+was\s+spent\s+to\s+cast\s+it$/i.test(clause)) return null;

  // Graveyard event counters (recognized; best-effort if tracking exists)
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+cards\s+were\s+put\s+into\s+your\s+graveyard\s+this\s+turn\s+from\s+anywhere$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const map = (ctx as any).state?.cardsPutIntoYourGraveyardThisTurn;
      if (map && typeof map === 'object') {
        const v = (map as any)?.[controllerId];
        const count = typeof v === 'number' ? v : 0;
        return count >= n;
      }
      return null;
    }
  }
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+cards\s+were\s+put\s+into\s+your\s+graveyard\s+from\s+anywhere\s+other\s+than\s+the\s+battlefield\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const map = (ctx as any).state?.cardsPutIntoYourGraveyardFromNonBattlefieldThisTurn;
      if (map && typeof map === 'object') {
        const v = (map as any)?.[controllerId];
        const count = typeof v === 'number' ? v : 0;
        return count >= n;
      }
      return null;
    }
  }
  if (/^if\s+a\s+card\s+left\s+your\s+graveyard\s+this\s+turn$/i.test(clause)) {
    const map = (ctx as any).state?.cardLeftYourGraveyardThisTurn;
    const v = map?.[controllerId] ?? (ctx as any).state?.cardLeftGraveyardThisTurn?.[controllerId];
    return typeof v === 'boolean' ? v : null;
  }
  if (/^if\s+a\s+creature\s+card\s+left\s+your\s+graveyard\s+this\s+turn$/i.test(clause)) {
    const map = (ctx as any).state?.creatureCardLeftYourGraveyardThisTurn;
    const v = map?.[controllerId];
    return typeof v === 'boolean' ? v : null;
  }
  if (/^if\s+a\s+creature\s+card\s+was\s+put\s+into\s+your\s+graveyard\s+from\s+anywhere\s+this\s+turn$/i.test(clause)) {
    const map = (ctx as any).state?.creatureCardPutIntoYourGraveyardThisTurn;
    const v = map?.[controllerId];
    return typeof v === 'boolean' ? v : null;
  }

  // Death-count templates (recognized; depends on tracking)
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+creatures\s+died\s+under\s+your\s+control\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const map = (ctx as any).state?.creaturesDiedUnderYourControlThisTurn;
      const v = map?.[controllerId];
      if (typeof v === 'number') return v >= n;

      const v2 = getCreaturesDiedThisTurnByController(ctx, controllerId);
      if (typeof v2 === 'number') return v2 >= n;

      return null;
    }
  }
  if (/^if\s+a\s+creature\s+died\s+under\s+an\s+opponent'?s\s+control\s+this\s+turn$/i.test(clause)) {
    const map = (ctx as any).state?.creaturesDiedThisTurnByController;
    if (!map) return null;
    const opps = getOpponentIds(ctx, controllerId);
    if (!opps.length) return false;
    return opps.some((oid) => ((map as any)[String(oid)] || 0) > 0);
  }
  if (/^if\s+a\s+phyrexian\s+died\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {
    const n = getCreatureSubtypeDiedThisTurnCount(ctx, controllerId, 'phyrexian');
    return typeof n === 'number' ? n > 0 : null;
  }

  // Generic subtype death templates (recognized; depends on subtype death tracking)
  {
    const m = clause.match(/^if\s+another\s+([a-z0-9-]+)\s+died\s+under\s+your\s+control\s+this\s+turn$/i);
    if (m) {
      const subtype = String(m[1] || '').toLowerCase();
      if (!isLikelyCreatureSubtypeToken(subtype)) return null;
      const nRaw = getCreatureSubtypeDiedThisTurnCount(ctx, controllerId, subtype);
      if (typeof nRaw !== 'number') return nRaw;

      // Best-effort exclusion for "another": if the source is itself a matching creature,
      // require at least 2 total deaths to satisfy "another".
      let n = nRaw;
      if (sourcePermanent?.card?.type_line) {
        const tl = String(sourcePermanent?.card?.type_line || '').toLowerCase();
        if (tl.includes('creature') && new RegExp(`\\b${subtype.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i').test(tl)) {
          n = Math.max(0, n - 1);
        }
      }

      return n > 0;
    }
  }
  {
    const m = clause.match(/^if\s+an?\s+([a-z0-9-]+)\s+died\s+under\s+your\s+control\s+this\s+turn$/i);
    if (m) {
      const subtype = String(m[1] || '').toLowerCase();
      if (!isLikelyCreatureSubtypeToken(subtype)) return null;
      const n = getCreatureSubtypeDiedThisTurnCount(ctx, controllerId, subtype);
      return typeof n === 'number' ? n > 0 : null;
    }
  }
  {
    const m = clause.match(/^if\s+an?\s+([a-z0-9-]+)\s+died\s+under\s+an\s+opponent'?s\s+control\s+this\s+turn$/i);
    if (m) {
      const subtype = String(m[1] || '').toLowerCase();
      if (!isLikelyCreatureSubtypeToken(subtype)) return null;
      const opps = getOpponentIds(ctx, controllerId);
      if (!opps.length) return false;
      const total = getCreatureSubtypeDiedThisTurnSum(ctx, opps.map(String), subtype);
      return total === null ? null : total > 0;
    }
  }
  {
    const m = clause.match(/^if\s+an?\s+([a-z0-9-]+)\s+died\s+this\s+turn$/i);
    if (m) {
      const subtype = String(m[1] || '').toLowerCase();
      if (!isLikelyCreatureSubtypeToken(subtype)) return null;
      const ids = getAllPlayerIds(ctx, controllerId);
      if (!ids.length) return null;
      const total = getCreatureSubtypeDiedThisTurnSum(ctx, ids.map(String), subtype);
      return total === null ? null : total > 0;
    }
  }
  if (/^if\s+a\s+creature\s+dealt\s+damage\s+by\s+this\s+creature\s+this\s+turn\s+died$/i.test(clause)) return null;

  // ETB under opponent control (recognized; depends on tracking)
  if (/^if\s+a\s+creature\s+entered\s+the\s+battlefield\s+under\s+an\s+opponent'?s\s+control\s+this\s+turn$/i.test(clause)) {
    const map = (ctx as any).state?.creaturesEnteredBattlefieldThisTurnByController;
    if (!map) return null;
    const opps = getOpponentIds(ctx, controllerId);
    if (!opps.length) return false;
    return opps.some((oid) => ((map as any)[String(oid)] || 0) > 0);
  }

  // Generic subtype ETB templates (recognized; depends on subtype ETB tracking)
  {
    const m = clause.match(/^if\s+another\s+([a-z0-9-]+)\s+entered\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn$/i);
    if (m) {
      const subtype = String(m[1] || '').toLowerCase();
      if (!isLikelyCreatureSubtypeToken(subtype)) return null;
      const nRaw = getCreatureSubtypeEnteredThisTurnCount(ctx, controllerId, subtype);
      if (typeof nRaw !== 'number') return nRaw;

      // Best-effort exclusion for "another": if the source permanent is itself that subtype and entered this turn,
      // decrement the aggregate counter to avoid counting itself.
      let n = nRaw;
      if (sourcePermanent && String(sourcePermanent?.controller || '') === String(controllerId) && sourcePermanent?.enteredThisTurn === true) {
        const tl = String(sourcePermanent?.card?.type_line || '').toLowerCase();
        if (tl.includes('creature') && new RegExp(`\\b${subtype.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i').test(tl)) {
          n = Math.max(0, n - 1);
        }
      }

      return n > 0;
    }
  }
  {
    const m = clause.match(/^if\s+an?\s+([a-z0-9-]+)\s+entered\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn$/i);
    if (m) {
      const subtype = String(m[1] || '').toLowerCase();
      if (!isLikelyCreatureSubtypeToken(subtype)) return null;
      const n = getCreatureSubtypeEnteredThisTurnCount(ctx, controllerId, subtype);
      return typeof n === 'number' ? n > 0 : null;
    }
  }
  {
    const m = clause.match(/^if\s+an?\s+([a-z0-9-]+)\s+entered\s+the\s+battlefield\s+under\s+an\s+opponent'?s\s+control\s+this\s+turn$/i);
    if (m) {
      const subtype = String(m[1] || '').toLowerCase();
      if (!isLikelyCreatureSubtypeToken(subtype)) return null;
      const opps = getOpponentIds(ctx, controllerId);
      if (!opps.length) return false;
      const total = getCreatureSubtypeEnteredThisTurnSum(ctx, opps.map(String), subtype);
      return total === null ? null : total > 0;
    }
  }
  {
    const m = clause.match(/^if\s+an?\s+([a-z0-9-]+)\s+entered\s+the\s+battlefield\s+this\s+turn$/i);
    if (m) {
      const subtype = String(m[1] || '').toLowerCase();
      if (!isLikelyCreatureSubtypeToken(subtype)) return null;
      const ids = getAllPlayerIds(ctx, controllerId);
      if (!ids.length) return null;
      const total = getCreatureSubtypeEnteredThisTurnSum(ctx, ids.map(String), subtype);
      return total === null ? null : total > 0;
    }
  }

  // Zone movement into hand (recognized; depends on tracking)
  if (/^if\s+a\s+permanent\s+was\s+put\s+into\s+your\s+hand\s+from\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {
    const map = (ctx as any).state?.permanentPutIntoHandFromBattlefieldThisTurn;
    const v = map?.[controllerId];
    return typeof v === 'boolean' ? v : null;
  }

  // Tribal shorthand like "if a giant" (context-dependent; recognize but unknown)
  if (/^if\s+a\s+giant$/i.test(clause)) return null;

  // Global battlefield color/type constraints
  if (/^if\s+all\s+lands\s+on\s+the\s+battlefield\s+are\s+islands$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield || [];
    if (!Array.isArray(battlefield)) return null;
    const lands = battlefield.filter((p: any) => String(p?.card?.type_line || '').toLowerCase().includes('land'));
    if (!lands.length) return true;
    for (const land of lands) {
      const tl = String(land?.card?.type_line || '');
      if (!tl) return null;
      if (!typeLineHasWord(tl, 'island')) return false;
    }
    return true;
  }
  {
    const m = clause.match(/^if\s+all\s+nonland\s+permanents\s+you\s+control\s+are\s+(white|blue|black|red|green)$/i);
    if (m) {
      const expected = normalizeColorToken(m[1]);
      if (!expected) return null;
      const battlefield = (ctx as any).state?.battlefield || [];
      if (!Array.isArray(battlefield)) return null;
      const yours = battlefield.filter((p: any) => p && String(p.controller || '') === String(controllerId));
      const nonlands = yours.filter((p: any) => {
        const tl = String(p?.card?.type_line || '').toLowerCase();
        return tl && !tl.includes('land');
      });
      for (const p of nonlands) {
        const colors = (p as any)?.card?.colors ?? (p as any)?.colors;
        if (!Array.isArray(colors)) return null;
        const normalized = colors.map((c: any) => normalizeColorToken(String(c || ''))).filter(Boolean) as string[];
        if (!normalized.length) return null;
        if (!normalized.includes(expected)) return false;
      }
      return true;
    }
  }

  // Subtype ETB templates: "if another elf/human ... entered ... this turn" (best-effort via enteredThisTurn)
  {
    const m = clause.match(/^if\s+another\s+([a-z0-9-]+)\s+entered\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn$/i);
    if (m) {
      const subtype = String(m[1] || '').toLowerCase();

      // Prefer deterministic per-turn subtype tracking when available.
      if (isLikelyCreatureSubtypeToken(subtype)) {
        const total = getCreatureSubtypeEnteredThisTurnCount(ctx, controllerId, subtype);
        if (total !== null) {
          // If the source is of the same subtype (common in ETB templates like "when this creature enters"),
          // require at least 2 to satisfy "another".
          if (sourcePermanent && typeLineHasWord(String(sourcePermanent?.card?.type_line || ''), subtype)) {
            return total >= 2;
          }
          return total >= 1;
        }
      }

      const excludeId = String((sourcePermanent as any)?.id || '');
      const battlefield = (ctx as any).state?.battlefield || [];
      const hasEnteredTracking = Array.isArray(battlefield) && battlefield.some((p: any) => p?.enteredThisTurn === true);
      if (!hasEnteredTracking) return null;
      if (!Array.isArray(battlefield)) return null;
      return battlefield.some((p: any) => {
        if (!p) return false;
        if (excludeId && String(p.id || '') === excludeId) return false;
        if (String(p.controller || '') !== String(controllerId)) return false;
        if (p.enteredThisTurn !== true) return false;
        return typeLineHasWord(String(p.card?.type_line || ''), subtype);
      });
    }
  }
  {
    const m = clause.match(/^if\s+another\s+([a-z0-9-]+)\s+died\s+under\s+your\s+control\s+this\s+turn$/i);
    if (m) {
      const subtype = String(m[1] || '').toLowerCase();
      const total = getCreatureSubtypeDiedThisTurnCount(ctx, controllerId, subtype);
      if (total === null) return null;

      // If the source is of the same subtype (common in "when this creature dies" templates),
      // require at least 2 to satisfy "another".
      if (sourcePermanent && typeLineHasWord(String(sourcePermanent?.card?.type_line || ''), subtype)) {
        return total >= 2;
      }
      return total >= 1;
    }
  }

  // Generic "a face-down creature entered ..." (best-effort)
  if (/^if\s+a\s+face-down\s+creature\s+entered\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {
    const map = (ctx as any).state?.faceDownCreaturesEnteredBattlefieldThisTurnByController;
    const key = String(controllerId);
    if (map && typeof map === 'object') {
      if (Object.prototype.hasOwnProperty.call(map, key)) {
        const n = (map as any)[key];
        if (typeof n === 'number') return n > 0;
      } else {
        // If the map exists (it is reset each turn), missing key implies zero.
        return false;
      }
    }

    // Best-effort positive evidence from battlefield. We only return true if we can see a face-down creature
    // that entered this turn under your current control.
    const battlefield = (ctx as any).state?.battlefield || [];
    if (Array.isArray(battlefield)) {
      const anyFaceDown = battlefield.some((p: any) => {
        if (!p) return false;
        if (String(p.controller || '') !== key) return false;
        if (p.enteredThisTurn !== true) return false;
        const tl = String(p.card?.type_line || '').toLowerCase();
        if (!tl.includes('creature')) return false;
        return p.faceDown === true || p.isFaceDown === true || p.faceDownCreature === true;
      });
      if (anyFaceDown) return true;

      // Avoid false negatives: without deterministic tracking, the creature could have entered under your control
      // and then changed controller.
      const hasEnteredTracking = battlefield.some((p: any) => p?.enteredThisTurn === true);
      if (hasEnteredTracking) return null;
    }

    return null;
  }

  // Player/opponent comparative checks
  if (/^if\s+a\s+player\s+controls\s+more\s+creatures\s+than\s+each\s+other\s+player$/i.test(clause)) {
    const ids = getAllPlayerIds(ctx, controllerId);
    if (!ids.length) return null;
    for (const pid of ids) {
      const c = countByPermanentType(ctx, pid, 'creature');
      if (ids.every((other) => other === pid || c > countByPermanentType(ctx, other, 'creature'))) return true;
    }
    return false;
  }
  if (/^if\s+a\s+player\s+controls\s+more\s+wizards\s+than\s+each\s+other\s+player$/i.test(clause)) {
    const ids = getAllPlayerIds(ctx, controllerId);
    if (!ids.length) return null;
    for (const pid of ids) {
      const c = countControlledCreatureSubtype(ctx, pid, 'wizard');
      if (ids.every((other) => other === pid || c > countControlledCreatureSubtype(ctx, other, 'wizard'))) return true;
    }
    return false;
  }
  if (/^if\s+a\s+player\s+controls\s+no\s+creatures$/i.test(clause)) {
    const ids = getAllPlayerIds(ctx, controllerId);
    if (!ids.length) return null;
    return ids.some((pid) => countByPermanentType(ctx, pid, 'creature') === 0);
  }
  if (/^if\s+a\s+player\s+has\s+more\s+cards\s+in\s+hand\s+than\s+each\s+other\s+player$/i.test(clause)) {
    const ids = getAllPlayerIds(ctx, controllerId);
    if (!ids.length) return null;
    for (const pid of ids) {
      const c = getHandCount(ctx, pid);
      if (ids.every((other) => other === pid || c > getHandCount(ctx, other))) return true;
    }
    return false;
  }
  if (/^if\s+an\s+opponent\s+has\s+no\s+cards\s+in\s+hand$/i.test(clause)) {
    const opps = getOpponentIds(ctx, controllerId);
    if (!opps.length) return false;
    return opps.some((oid) => getHandCount(ctx, oid) === 0);
  }
  {
    const m = clause.match(/^if\s+an\s+opponent\s+controls\s+([a-z0-9]+)\s+or\s+more\s+creatures$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const opps = getOpponentIds(ctx, controllerId);
      if (!opps.length) return false;
      return opps.some((oid) => countByPermanentType(ctx, oid, 'creature') >= n);
    }
  }
  if (/^if\s+a\s+player\s+is\s+the\s+monarch$/i.test(clause)) return Boolean((ctx as any).state?.monarch);
  if (/^if\s+an\s+opponent\s+is\s+the\s+monarch$/i.test(clause)) {
    const monarch = (ctx as any).state?.monarch;
    if (!monarch) return false;
    return String(monarch) !== controllerId;
  }

  // Prime-number landfall template (already handled earlier too; keep for safety)
  if (/^if\s+a\s+land\s+entered\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn\s+and\s+you\s+control\s+a\s+prime\s+number\s+of\s+lands$/i.test(clause)) {
    if (getLandsEnteredBattlefieldThisTurn(ctx, controllerId) <= 0) return false;
    return isPrimeNumber(countByPermanentType(ctx, controllerId, 'land'));
  }

  // Turn-tracking: discard happened this turn
  if (/^if\s+a\s+player\s+discarded\s+a\s+card\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const anyFlag = stateAny?.anyPlayerDiscardedCardThisTurn;
    if (typeof anyFlag === 'boolean') return anyFlag;
    const map = stateAny?.discardedCardThisTurn;
    if (!map || typeof map !== 'object') return null;
    return Object.values(map).some((v: any) => v === true);
  }
  if (/^if\s+you\s+discarded\s+a\s+card\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const map = stateAny?.discardedCardThisTurn;
    if (!map || typeof map !== 'object') return null;
    const v = map[String(controllerId)];
    return v === true;
  }
  if (/^if\s+an\s+opponent\s+discarded\s+a\s+card\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const map = stateAny?.discardedCardThisTurn;
    if (!map || typeof map !== 'object') return null;
    const opps = getOpponentIds(ctx, controllerId);
    if (!opps.length) return false;
    return opps.some((oid) => map[String(oid)] === true);
  }

  // Misc context-dependent templates we explicitly recognize (null)
  if (
    /^if\s+a\s+source\s+would\s+deal\s+damage$/i.test(clause) ||
    /^if\s+a\s+source\s+would\s+deal\s+damage\s+to\s+that\s+player\s+or\s+a\s+permanent\s+that\s+player\s+controls$/i.test(clause) ||
    /^if\s+a\s+player\s+would\s+planeswalk\s+as\s+a\s+result\s+of\s+rolling\s+the\s+planar\s+die$/i.test(clause) ||
    /^if\s+an\s+assassin\s+crewed\s+it\s+this\s+turn$/i.test(clause) ||
    /^if\s+an\s+aura\s+you\s+controlled\s+was\s+attached\s+to\s+it$/i.test(clause) ||
    /^if\s+any\s+of\s+that\s+damage\s+was\s+dealt\s+by\s+a\s+warrior$/i.test(clause) ||
    /^if\s+any\s+of\s+those\s+creatures\s+have\s+power\s+or\s+toughness\s+equal\s+to\s+the\s+chosen\s+number$/i.test(clause) ||
    /^if\s+another\s+opponent\s+controls\s+([a-z0-9]+)\s+or\s+more\s+nonland\s+permanents\s+that\s+spell\s+could\s+target$/i.test(clause) ||
    /^if\s+an\s+opponent\s+cast\s+a\s+(white|blue|black|red|green)\s+and\/or\s+(white|blue|black|red|green)\s+spell\s+this\s+turn$/i.test(clause) ||
    /^if\s+a\s+player\s+was\s+dealt\s+([a-z0-9]+)\s+or\s+more\s+combat\s+damage\s+this\s+turn$/i.test(clause) ||
    /^if\s+a\s+player\s+was\s+dealt\s+combat\s+damage\s+by\s+a\s+zombie\s+this\s+turn$/i.test(clause) ||
    /^if\s+an\s+opponent\s+was\s+dealt\s+([a-z0-9]+)\s+or\s+more\s+damage\s+this\s+turn$/i.test(clause) ||
    /^if\s+an\s+opponent\s+was\s+dealt\s+damage\s+this\s+turn$/i.test(clause)
  ) {
    return null;
  }

  // ===== Targeted handlers for last fallback-only clauses =====

  // "if this creature ... +1/+1 counters"
  {
    const m = clause.match(/^if\s+this\s+creature\s+has\s+([a-z0-9]+)\s+or\s+more\s+\+1\/\+1\s+counters\s+on\s+it$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const c = sourcePermanent?.counters?.['+1/+1'];
      if (typeof c === 'number') return c >= n;
      return null;
    }
  }
  {
    const m = clause.match(/^if\s+this\s+creature\s+has\s+fewer\s+than\s+([a-z0-9]+)\s+\+1\/\+1\s+counters\s+on\s+it$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const c = sourcePermanent?.counters?.['+1/+1'];
      if (typeof c === 'number') return c < n;
      return null;
    }
  }
  if (/^if\s+this\s+creature\s+doesn't\s+have\s+a\s+\+1\/\+1\s+counter\s+on\s+it$/i.test(clause)) {
    const c = sourcePermanent?.counters?.['+1/+1'];
    if (typeof c === 'number') return c <= 0;
    return null;
  }

  // Named variant: "if Sarulf has (one|N) or more +1/+1 counters on it" (conservative)
  {
    const m = clause.match(/^if\s+sarulf\s+has\s+([a-z0-9]+)\s+or\s+more\s+\+1\/\+1\s+counters\s+on\s+it$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const sourceNameLower = toLower(sourcePermanent?.card?.name || sourcePermanent?.name || '');
      const candidates = nameMatchesClauseName(sourceNameLower, 'sarulf')
        ? [sourcePermanent]
        : findBattlefieldPermanentsByName(ctx, 'sarulf');
      if (!Array.isArray(candidates) || candidates.length === 0) return null;

      let anyUnknown = false;
      let anyKnown = false;
      for (const p of candidates) {
        const c = getCounterCountCaseInsensitiveFromPerm(p, '+1/+1');
        if (c === null) {
          anyUnknown = true;
          continue;
        }
        anyKnown = true;
        if (c >= n) return true;
      }

      if (anyKnown && !anyUnknown) return false;
      return null;
    }
  }
  {
    const m = clause.match(/^if\s+sarulf\s+has\s+one\s+or\s+more\s+\+1\/\+1\s+counters\s+on\s+it$/i);
    if (m) {
      const sourceNameLower = toLower(sourcePermanent?.card?.name || sourcePermanent?.name || '');
      const candidates = nameMatchesClauseName(sourceNameLower, 'sarulf')
        ? [sourcePermanent]
        : findBattlefieldPermanentsByName(ctx, 'sarulf');
      if (!Array.isArray(candidates) || candidates.length === 0) return null;

      let anyUnknown = false;
      let anyKnown = false;
      for (const p of candidates) {
        const c = getCounterCountCaseInsensitiveFromPerm(p, '+1/+1');
        if (c === null) {
          anyUnknown = true;
          continue;
        }
        anyKnown = true;
        if (c > 0) return true;
      }

      if (anyKnown && !anyUnknown) return false;
      return null;
    }
  }

  // Named variant: "if Katara is tapped" / "if Kona is tapped" (conservative)
  {
    const m = clause.match(/^if\s+(katara|kona)\s+is\s+tapped$/i);
    if (m) {
      const nameLower = String(m[1] || '').toLowerCase();
      const sourceNameLower = toLower(sourcePermanent?.card?.name || sourcePermanent?.name || '');
      const candidates = nameMatchesClauseName(sourceNameLower, nameLower)
        ? [sourcePermanent]
        : findBattlefieldPermanentsByName(ctx, nameLower);
      if (!Array.isArray(candidates) || candidates.length === 0) return null;

      let anyUnknown = false;
      let anyKnown = false;
      for (const p of candidates) {
        const t = (p as any)?.tapped;
        if (typeof t !== 'boolean') {
          anyUnknown = true;
          continue;
        }
        anyKnown = true;
        if (t === true) return true;
      }

      if (anyKnown && !anyUnknown) return false;
      return null;
    }
  }

  // "if you control a creature with a +1/+1 counter on it" (+ "another")
  if (/^if\s+you\s+control\s+a\s+creature\s+with\s+a\s+\+1\/\+1\s+counter\s+on\s+it$/i.test(clause)) {
    const creatures = getControlledCreatures(ctx, controllerId);
    return creatures.some((p: any) => typeof p?.counters?.['+1/+1'] === 'number' && p.counters['+1/+1'] > 0);
  }
  if (/^if\s+you\s+control\s+another\s+creature\s+with\s+a\s+\+1\/\+1\s+counter\s+on\s+it$/i.test(clause)) {
    const excludeId = String((sourcePermanent as any)?.id || '');
    const creatures = getControlledCreatures(ctx, controllerId);
    return creatures.some((p: any) => {
      if (!p) return false;
      if (excludeId && String(p.id || '') === excludeId) return false;
      return typeof p?.counters?.['+1/+1'] === 'number' && p.counters['+1/+1'] > 0;
    });
  }

  // "if you control N or more <tribe> and/or <tribe>"
  {
    const m = clause.match(/^if\s+you\s+control\s+([a-z0-9]+)\s+or\s+more\s+snakes\s+and\/or\s+serpents$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const creatures = getControlledCreatures(ctx, controllerId);
      const count = creatures.filter((p: any) => {
        const tl = String(p?.card?.type_line || '');
        return typeLineHasWord(tl, 'snake') || typeLineHasWord(tl, 'serpent');
      }).length;
      return count >= n;
    }
  }
  {
    const m = clause.match(/^if\s+you\s+control\s+([a-z0-9]+)\s+or\s+more\s+wolves\s+and\/or\s+werewolves$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const creatures = getControlledCreatures(ctx, controllerId);
      const count = creatures.filter((p: any) => {
        const tl = String(p?.card?.type_line || '');
        return typeLineHasWord(tl, 'wolf') || typeLineHasWord(tl, 'werewolf');
      }).length;
      return count >= n;
    }
  }

  // "if there are N or more instant and/or sorcery cards (among cards) in your graveyard"
  {
    const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+instant\s+and\/or\s+sorcery\s+cards\s+(?:among\s+cards\s+in\s+your\s+graveyard|in\s+your\s+graveyard)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const graveyard = getGraveyard(ctx, controllerId);
      if (!Array.isArray(graveyard)) return null;
      const count = graveyard.filter((c: any) => {
        const tl = String(c?.type_line || '').toLowerCase();
        return tl.includes('instant') || tl.includes('sorcery');
      }).length;
      return count >= n;
    }
  }

  // "if there is an elf card in your graveyard and this creature has a -1/-1 counter on it"
  if (/^if\s+there\s+is\s+an\s+elf\s+card\s+in\s+your\s+graveyard\s+and\s+this\s+creature\s+has\s+a\s+-1\/\-1\s+counter\s+on\s+it$/i.test(clause)) {
    const graveyard = getGraveyard(ctx, controllerId);
    if (!Array.isArray(graveyard)) return null;
    const hasElf = graveyard.some((c: any) => typeLineHasWord(String(c?.type_line || ''), 'elf'));
    const c = sourcePermanent?.counters?.['-1/-1'];
    if (!hasElf) return false;
    if (typeof c === 'number') return c > 0;
    return null;
  }

  // "if you cast them and there are N or more dragon and/or lesson cards in your graveyard" (partial)
  {
    const m = clause.match(/^if\s+you\s+cast\s+them\s+and\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+dragon\s+and\/or\s+lesson\s+cards\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const graveyard = getGraveyard(ctx, controllerId);
      if (!Array.isArray(graveyard)) return null;
      const count = graveyard.filter((c: any) => {
        const tl = String(c?.type_line || '');
        return typeLineHasWord(tl, 'dragon') || typeLineHasWord(tl, 'lesson');
      }).length;
      if (count < n) return false;
      return null;
    }
  }

  // Misc: "if you have an {e}" (energy)
  if (/^if\s+you\s+have\s+an\s+\{e\}$/i.test(clause)) {
    const e = (ctx as any).state?.energy?.[controllerId] ?? (ctx as any).state?.energyCounters?.[controllerId] ?? (ctx as any).energy?.[controllerId];
    if (typeof e === 'number') return e >= 1;
    return null;
  }

  // Context-dependent, targeted stubs
  if (/^if\s+that\s+creature\s+is\s+1\/1$/i.test(clause)) return null;
  if (/^if\s+that\s+spell'?s\s+mana\s+cost\s+or\s+that\s+ability'?s\s+activation\s+cost\s+contains\s+\{x\}$/i.test(clause)) return null;

  // ===== Additional targeted handlers (batch) =====

  // Generic "it ..." keyword/counter templates (must run before the broad "if it" umbrella)
  if (/^if\s+it\s+doesn'?t\s+have\s+first\s+strike$/i.test(clause)) {
    const has = permanentHasKeyword(sourcePermanent, 'first strike');
    if (has === null) return null;
    return !has;
  }
  if (/^if\s+it\s+doesn'?t\s+have\s+an\s+indestructible\s+counter\s+on\s+it$/i.test(clause)) {
    const n = getCounterCountCaseInsensitiveFromPerm(sourcePermanent, 'indestructible');
    if (n === null) return null;
    return n <= 0;
  }
  if (/^if\s+it\s+(?:had|has)\s+no\s+counters\s+on\s+it$/i.test(clause)) {
    const hasAny = hasAnyCountersOnPermanent(sourcePermanent);
    if (hasAny === null) return null;
    return !hasAny;
  }
  {
    const m = clause.match(/^if\s+it\s+has\s+([a-z0-9]+)\s+or\s+more\s+([a-z][a-z0-9'’\- ]*)\s+counters\s+on\s+it$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const counterTypeLower = toLower(m[2]);
      // Only opt into a small whitelist to avoid accidental mismatches.
      const supported = new Set(['oil', 'quest']);
      if (!supported.has(counterTypeLower)) return null;
      const c = getCounterCountCaseInsensitiveFromPerm(sourcePermanent, counterTypeLower);
      if (c === null) return null;
      return c >= n;
    }
  }

  // Battlefield-count templates
  {
    const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+creatures\s+on\s+the\s+battlefield$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;
      const count = battlefield.filter((p: any) => String(p?.card?.type_line || '').toLowerCase().includes('creature')).length;
      return count >= n;
    }
  }
  {
    const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+lands\s+on\s+the\s+battlefield$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;
      const count = battlefield.filter((p: any) => String(p?.card?.type_line || '').toLowerCase().includes('land')).length;
      return count >= n;
    }
  }
  if (/^if\s+there\s+are\s+no\s+zombies\s+on\s+the\s+battlefield$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    const anyZombie = battlefield.some((p: any) => typeLineHasWord(String(p?.card?.type_line || ''), 'zombie'));
    return !anyZombie;
  }
  if (/^if\s+another\s+creature\s+is\s+on\s+the\s+battlefield$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    const excludeId = String((sourcePermanent as any)?.id || '');
    if (!excludeId) return null;
    return battlefield.some((p: any) => {
      if (!p) return false;
      if (String(p.id || '') === excludeId) return false;
      return String(p?.card?.type_line || '').toLowerCase().includes('creature');
    });
  }
  {
    const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+other\s+creatures\s+on\s+the\s+battlefield$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;
      const excludeId = String((sourcePermanent as any)?.id || '');
      if (!excludeId) return null;
      const count = battlefield.filter((p: any) => {
        if (!p) return false;
        if (String(p.id || '') === excludeId) return false;
        return String(p?.card?.type_line || '').toLowerCase().includes('creature');
      }).length;
      return count >= n;
    }
  }

  // "there are <threshold> <counterType> counters on this <permanentType>" templates
  {
    const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+([a-z][a-z0-9'’\- ]*)\s+counters\s+on\s+this\s+(?:artifact|creature|enchantment)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const counterTypeLower = toLower(m[2]);
      const c = getCounterCountCaseInsensitiveFromPerm(sourcePermanent, counterTypeLower);
      if (c === null) return null;
      return c >= n;
    }
  }
  {
    const m = clause.match(/^if\s+there\s+are\s+no\s+([a-z][a-z0-9'’\- ]*)\s+counters\s+on\s+this\s+(?:artifact|creature|enchantment)$/i);
    if (m) {
      const counterTypeLower = toLower(m[1]);
      const c = getCounterCountCaseInsensitiveFromPerm(sourcePermanent, counterTypeLower);
      if (c === null) return null;
      return c <= 0;
    }
  }

  // "this <permanentType> has ... <counterType> counter(s)"
  {
    const m = clause.match(/^if\s+this\s+artifact\s+has\s+a\s+([a-z][a-z0-9'’\- ]*)\s+counter\s+on\s+it$/i);
    if (m) {
      const counterTypeLower = toLower(m[1]);
      const c = getCounterCountCaseInsensitiveFromPerm(sourcePermanent, counterTypeLower);
      if (c === null) return null;
      return c > 0;
    }
  }
  {
    const m = clause.match(/^if\s+this\s+artifact\s+has\s+fewer\s+than\s+([a-z0-9]+)\s+([a-z][a-z0-9'’\- ]*)\s+counters\s+on\s+it$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const counterTypeLower = toLower(m[2]);
      const c = getCounterCountCaseInsensitiveFromPerm(sourcePermanent, counterTypeLower);
      if (c === null) return null;
      return c < n;
    }
  }
  {
    const m = clause.match(/^if\s+this\s+enchantment\s+has\s+no\s+([a-z][a-z0-9'’\- ]*)\s+counters\s+on\s+it$/i);
    if (m) {
      const counterTypeLower = toLower(m[1]);
      const c = getCounterCountCaseInsensitiveFromPerm(sourcePermanent, counterTypeLower);
      if (c === null) return null;
      return c <= 0;
    }
  }
  {
    const m = clause.match(/^if\s+this\s+enchantment\s+has\s+([a-z0-9]+)\s+or\s+more\s+([a-z][a-z0-9'’\- ]*)\s+counters\s+on\s+it$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const counterTypeLower = toLower(m[2]);
      const c = getCounterCountCaseInsensitiveFromPerm(sourcePermanent, counterTypeLower);
      if (c === null) return null;
      return c >= n;
    }
  }

  // "there are thirty or more counters among artifacts and creatures you control"
  if (/^if\s+there\s+are\s+thirty\s+or\s+more\s+counters\s+among\s+artifacts\s+and\s+creatures\s+you\s+control$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    let total = 0;
    let sawCountersObject = false;
    for (const p of battlefield) {
      if (!p || String(p.controller || '') !== String(controllerId)) continue;
      const tl = String(p?.card?.type_line || '').toLowerCase();
      if (!(tl.includes('artifact') || tl.includes('creature'))) continue;
      const counters = (p as any).counters;
      if (counters && typeof counters === 'object') sawCountersObject = true;
      const sum = sumAllCounters(p);
      if (sum === null) continue;
      total += sum;
    }
    if (!sawCountersObject) return null;
    return total >= 30;
  }

  // "there are five colors among permanents you control"
  if (/^if\s+there\s+are\s+five\s+colors\s+among\s+permanents\s+you\s+control$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    const colors = new Set<string>();
    let sawUnknown = false;
    for (const p of battlefield) {
      if (!p || String(p.controller || '') !== String(controllerId)) continue;
      const c = (p as any)?.card;
      const arr = c?.colors ?? c?.color_identity;
      if (Array.isArray(arr)) {
        for (const col of arr) {
          const u = String(col || '').toUpperCase();
          if (['W', 'U', 'B', 'R', 'G'].includes(u)) colors.add(u);
        }
      } else if (typeof c?.color === 'string' && c.color) {
        const u = String(c.color).toUpperCase();
        if (['W', 'U', 'B', 'R', 'G'].includes(u)) colors.add(u);
      } else {
        // Colorless or missing metadata; treat as unknown (conservative) unless we already have 5.
        sawUnknown = true;
      }
      if (colors.size >= 5) return true;
    }
    if (colors.size >= 5) return true;
    return sawUnknown ? null : false;
  }

  // Graveyard numeric templates
  {
    const m = clause.match(/^if\s+there\s+are\s+fewer\s+than\s+([a-z0-9]+)\s+creature\s+cards\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const zones = (ctx as any).state?.zones;
      if (!zones || typeof zones !== 'object') return null;
      const gy = getGraveyard(ctx, controllerId);
      const count = gy.filter((c: any) => String(c?.type_line || '').toLowerCase().includes('creature')).length;
      return count < n;
    }
  }
  if (/^if\s+there\s+are\s+five\s+or\s+more\s+mana\s+values\s+among\s+cards\s+in\s+your\s+graveyard$/i.test(clause)) {
    const zones = (ctx as any).state?.zones;
    if (!zones || typeof zones !== 'object') return null;
    const gy = getGraveyard(ctx, controllerId);
    const set = new Set<number>();
    for (const c of gy) {
      const mv = (c as any)?.mana_value ?? (c as any)?.manaValue ?? (c as any)?.cmc;
      if (typeof mv !== 'number') return null;
      set.add(mv);
      if (set.size >= 5) return true;
    }
    return set.size >= 5;
  }
  if (/^if\s+this\s+card\s+is\s+the\s+only\s+creature\s+card\s+in\s+your\s+graveyard$/i.test(clause)) {
    const zones = (ctx as any).state?.zones;
    if (!zones || typeof zones !== 'object') return null;
    const gy = getGraveyard(ctx, controllerId);
    const creatureCards = gy.filter((c: any) => String(c?.type_line || '').toLowerCase().includes('creature'));
    if (creatureCards.length !== 1) return false;

    const srcName = toLower((sourcePermanent as any)?.card?.name ?? (sourcePermanent as any)?.name ?? '');
    if (!srcName) return null;
    return toLower(creatureCards[0]?.name || '') === srcName;
  }

  // "this creature/enchantment is on the battlefield" (best-effort)
  if (/^if\s+this\s+creature\s+is\s+on\s+the\s+battlefield$/i.test(clause)) {
    return sourcePermanent ? true : null;
  }
  if (/^if\s+this\s+enchantment\s+is\s+on\s+the\s+battlefield$/i.test(clause)) {
    return sourcePermanent ? true : null;
  }

  // Broad umbrella recognizers:
  // These intentionally return `null` (recognized-but-unknown) to avoid the fallback marker
  // for common Oracle templating we don't yet track in game state.
  if (/^if\s+defending\s+player\b/i.test(clause)) return null;
  if (/^if\s+enchanted\b/i.test(clause)) return null;
  if (/^if\s+equipped\b/i.test(clause)) return null;
  if (/^if\s+(?:it|he|she|they)\b/i.test(clause)) return null;

  // Numeric lead-ins tend to correspond to event/cost counters.
  if (/^if\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+or\s+more\b/i.test(clause)) {
    return null;
  }
  if (/^if\s+at\s+least\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i.test(clause)) {
    return null;
  }

  // Cost / mana payment templates (not currently tracked reliably)
  if (/\bwas\s+spent\s+to\s+cast\s+it$/i.test(clause)) return null;
  if (/\bwere\s+sacrificed\s+to\s+activate\s+it$/i.test(clause)) return null;

  // Counter templates (generic)
  if (/\bcounter\b/i.test(clause) && /\bthis\s+turn\b/i.test(clause)) return null;

  // Combat templates (generic)
  // Card-name-specific templates (best-effort with public-zone lookups)
  {
    const m = clause.match(/^if\s+([a-z0-9][a-z0-9'’\- ]+)\s+is\s+in\s+the\s+command\s+zone\s+or\s+on\s+the\s+battlefield$/i);
    if (m) {
      const nameLower = toLower(m[1]);
      const onBf = findBattlefieldPermanentsByName(ctx, nameLower).length > 0;
      if (onBf) return true;

      const info = getCommandZoneInfo(ctx, controllerId);
      if (!info) return null;
      const inCZ: string[] = Array.isArray((info as any).inCommandZone) ? (info as any).inCommandZone : [];
      const cards: any[] = Array.isArray((info as any).commanderCards) ? (info as any).commanderCards : [];
      const idsForName = cards
        .filter((c: any) => nameMatchesClauseName(toLower(c?.name || ''), nameLower))
        .map((c: any) => String(c?.id || ''))
        .filter(Boolean);
      if (!idsForName.length) {
        // If we can't map name to commander ids, stay conservative.
        return null;
      }
      return idsForName.some((id) => inCZ.includes(id));
    }
  }
  {
    const m = clause.match(/^if\s+([a-z0-9][a-z0-9'’\- ]+)\s+is\s+in\s+the\s+command\s+zone$/i);
    if (m) {
      const nameLower = toLower(m[1]);
      const info = getCommandZoneInfo(ctx, controllerId);
      if (!info) return null;
      const inCZ: string[] = Array.isArray((info as any).inCommandZone) ? (info as any).inCommandZone : [];
      const cards: any[] = Array.isArray((info as any).commanderCards) ? (info as any).commanderCards : [];
      const idsForName = cards
        .filter((c: any) => nameMatchesClauseName(toLower(c?.name || ''), nameLower))
        .map((c: any) => String(c?.id || ''))
        .filter(Boolean);
      if (!idsForName.length) return null;
      return idsForName.some((id) => inCZ.includes(id));
    }
  }
  {
    const m = clause.match(/^if\s+([a-z0-9][a-z0-9'’\- ]+)\s+is\s+in\s+your\s+graveyard\s+or\s+on\s+the\s+battlefield$/i);
    if (m) {
      const zones = (ctx as any).state?.zones;
      if (!zones || typeof zones !== 'object') return null;
      const nameLower = toLower(m[1]);
      const onBf = findBattlefieldPermanentsByName(ctx, nameLower).length > 0;
      if (onBf) return true;
      const gy = getGraveyard(ctx, controllerId);
      return gy.some((c: any) => nameMatchesClauseName(toLower(c?.name || ''), nameLower));
    }
  }
  {
    const m = clause.match(/^if\s+([a-z0-9][a-z0-9'’\- ]+)\s+is\s+exiled$/i);
    if (m) {
      const zones = (ctx as any).state?.zones;
      if (!zones || typeof zones !== 'object') return null;
      const nameLower = toLower(m[1]);
      const ids = getAllPlayerIds(ctx, controllerId);
      if (!ids.length) return null;
      for (const pid of ids) {
        const exile: any[] = Array.isArray((zones as any)?.[pid]?.exile) ? (zones as any)[pid].exile : [];
        if (exile.some((c: any) => nameMatchesClauseName(toLower(c?.name || ''), nameLower))) return true;
      }
      return false;
    }
  }
  {
    const m = clause.match(/^if\s+([a-z0-9][a-z0-9'’\- ]+)\s+entered\s+this\s+turn$/i);
    if (m) {
      const nameLower = toLower(m[1]);
      // If sourcePermanent matches, use it.
      if (sourcePermanent && toLower(sourcePermanent?.card?.name || '') === nameLower) {
        const v = (sourcePermanent as any).enteredThisTurn;
        return typeof v === 'boolean' ? v : null;
      }

      const matches = findBattlefieldPermanentsByName(ctx, nameLower);
      if (!matches.length) return null;
      // If any matching perm has explicit enteredThisTurn, decide conservatively.
      const anyTrue = matches.some((p: any) => p?.enteredThisTurn === true);
      if (anyTrue) return true;
      const anyBool = matches.some((p: any) => typeof p?.enteredThisTurn === 'boolean');
      return anyBool ? false : null;
    }
  }
  {
    const m = clause.match(/^if\s+([a-z0-9][a-z0-9'’\- ]+)\s+has\s+counters\s+on\s+it$/i);
    if (m) {
      const nameLower = toLower(m[1]);
      if (sourcePermanent && toLower(sourcePermanent?.card?.name || '') === nameLower) {
        const v = hasAnyCountersOnPermanent(sourcePermanent);
        return v;
      }
      const matches = findBattlefieldPermanentsByName(ctx, nameLower);
      if (!matches.length) return null;
      const vals = matches.map((p: any) => hasAnyCountersOnPermanent(p));
      if (vals.some((v) => v === true)) return true;
      if (vals.some((v) => v === null)) return null;
      return false;
    }
  }
  {
    const m = clause.match(/^if\s+([a-z0-9][a-z0-9'’\- ]+)\s+is\s+tapped$/i);
    if (m) {
      const nameLower = toLower(m[1]);
      if (sourcePermanent && toLower(sourcePermanent?.card?.name || '') === nameLower) {
        const v = (sourcePermanent as any).tapped;
        return typeof v === 'boolean' ? v : null;
      }
      const matches = findBattlefieldPermanentsByName(ctx, nameLower);
      if (!matches.length) return null;
      if (matches.some((p: any) => p?.tapped === true)) return true;
      const anyBool = matches.some((p: any) => typeof p?.tapped === 'boolean');
      return anyBool ? false : null;
    }
  }
  {
    const m = clause.match(/^if\s+([a-z0-9][a-z0-9'’\- ]+)\s+is\s+untapped$/i);
    if (m) {
      const nameLower = toLower(m[1]);
      if (sourcePermanent && toLower(sourcePermanent?.card?.name || '') === nameLower) {
        const v = (sourcePermanent as any).tapped;
        return typeof v === 'boolean' ? !v : null;
      }
      const matches = findBattlefieldPermanentsByName(ctx, nameLower);
      if (!matches.length) return null;
      if (matches.some((p: any) => p?.tapped === false)) return true;
      const anyBool = matches.some((p: any) => typeof p?.tapped === 'boolean');
      return anyBool ? false : null;
    }
  }

  // Named-counter threshold: "there are one or more <counter> counters on <Name>"
  {
    const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+([a-z][a-z0-9'’\- ]*)\s+counters\s+on\s+([a-z0-9][a-z0-9'’\- ]+)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const counterTypeLower = toLower(m[2]);
      const nameLower = toLower(m[3]);
      const matches = findBattlefieldPermanentsByName(ctx, nameLower);
      if (!matches.length) return null;
      const vals = matches.map((p: any) => getCounterCountCaseInsensitiveFromPerm(p, counterTypeLower));
      if (vals.some((v) => v === null)) return null;
      return (vals as number[]).some((v) => v >= n);
    }
  }
  if (/^if\s+[a-z0-9][a-z0-9'’\- ]+\s+has\s+counters\s+on\s+it$/i.test(clause)) return null;
  if (/^if\s+[a-z0-9][a-z0-9'’\- ]+\s+is\s+tapped$/i.test(clause)) return null;
  if (/^if\s+[a-z0-9][a-z0-9'’\- ]+\s+is\s+untapped$/i.test(clause)) return null;

  // Extremely context-dependent shorthand (often card-specific): "if <name>" / "if <tribe>"
  if (/^if\s+[a-z0-9][a-z0-9'’\- ]+$/i.test(clause)) return null;

  // Generic fallback:
  // Many intervening-if templates exist in Oracle text, but the engine may not track the required state yet.
  // To keep trigger handling conservative (don't miss triggers), treat any remaining leading "if ..." clause
  // as recognized-but-unknown.
  if (clause.startsWith('if ')) return FALLBACK_INTERVENING_IF;

  return UNMATCHED_INTERVENING_IF;
}

export function evaluateInterveningIfClause(
  ctx: GameContext,
  controllerId: string,
  clauseText: string,
  sourcePermanent?: any,
  refs?: InterveningIfRefs
): boolean | null {
  const v = evaluateInterveningIfClauseInternal(ctx, controllerId, clauseText, sourcePermanent, refs);
  if (v === UNMATCHED_INTERVENING_IF) return null;
  if (v === FALLBACK_INTERVENING_IF) return null;
  return v;
}

export function evaluateInterveningIfClauseDetailed(
  ctx: GameContext,
  controllerId: string,
  clauseText: string,
  sourcePermanent?: any,
  refs?: InterveningIfRefs
): InterveningIfEvaluation {
  const v = evaluateInterveningIfClauseInternal(ctx, controllerId, clauseText, sourcePermanent, refs);
  if (v === UNMATCHED_INTERVENING_IF) return { matched: false, value: null };
  if (v === FALLBACK_INTERVENING_IF) return { matched: true, value: null, fallback: true };
  return { matched: true, value: v };
}

/**
 * Convenience: parse and evaluate the leading intervening-if from a description.
 */
export function isInterveningIfSatisfied(
  ctx: GameContext,
  controllerId: string,
  descriptionOrEffect: string,
  sourcePermanent?: any,
  refs?: InterveningIfRefs
): boolean | null {
  const clause = extractInterveningIfClause(descriptionOrEffect);
  if (!clause) return null;
  return evaluateInterveningIfClause(ctx, controllerId, clause, sourcePermanent, refs);
}
