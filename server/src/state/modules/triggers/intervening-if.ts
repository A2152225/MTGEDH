import type { GameContext } from "../context.js";

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

function getLandsEnteredBattlefieldThisTurn(ctx: GameContext, playerId: string): number {
  const map = (ctx as any).state?.landsEnteredBattlefieldThisTurn;
  const v = map?.[playerId];
  return typeof v === 'number' ? v : 0;
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

function getPermanentPower(perm: any): number {
  const candidates = [perm?.effectivePower, perm?.power, perm?.basePower, perm?.card?.power];
  for (const c of candidates) {
    const n = parseMaybeNumber(c);
    if (n !== null) return n;
  }
  return 0;
}

function getPermanentToughness(perm: any): number {
  const candidates = [perm?.effectiveToughness, perm?.toughness, perm?.baseToughness, perm?.card?.toughness];
  for (const c of candidates) {
    const n = parseMaybeNumber(c);
    if (n !== null) return n;
  }
  return 0;
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
 * - `null`  => condition not recognized (caller should conservatively treat as "unknown")
 */
export function evaluateInterveningIfClause(
  ctx: GameContext,
  controllerId: string,
  clauseText: string,
  sourcePermanent?: any
): boolean | null {
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
      return evaluateInterveningIfClause(ctx, controllerId, `if ${rest}`, sourcePermanent);
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
      return evaluateInterveningIfClause(ctx, controllerId, `if ${rest}`, sourcePermanent);
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
      return evaluateInterveningIfClause(ctx, controllerId, `if ${rest}`, sourcePermanent);
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
      return evaluateInterveningIfClause(ctx, controllerId, `if ${rest}`, sourcePermanent);
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

  // "...if you've cast two or more spells this turn..." is already covered elsewhere; keep it below.

  // "...if a land entered the battlefield under your control this turn..." (landfall-adjacent)
  if (/^if\s+a\s+land\s+(?:you\s+control\s+)?entered(?:\s+the\s+battlefield)?\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {
    return getLandsEnteredBattlefieldThisTurn(ctx, controllerId) > 0;
  }

  // "...if it/this source dealt damage to an opponent this turn..."
  if (/^if\s+(?:it|this\s+(?:creature|permanent|source))\s+dealt\s+damage\s+to\s+an\s+opponent\s+this\s+turn$/i.test(clause)) {
    if (!sourcePermanent?.id) return null;
    return didSourceDealDamageToOpponentThisTurn(ctx, controllerId, String(sourcePermanent.id));
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

  // "if it isn't renowned" / "if it's not renowned" (Renown)
  // This refers to the source permanent.
  if (/^if\s+(?:it\s+is\s+not|it\s+isn'?t|it'?s\s+not)\s+renowned$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return sourcePermanent.renowned !== true;
  }

  // "if it is renowned"
  if (/^if\s+it\s+is\s+renowned$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return sourcePermanent.renowned === true;
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
      const thatPlayerId = getTurnPlayerId(ctx);
      if (!thatPlayerId) return null;

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

  // "if a creature died this turn" (Morbid)
  if (/^if\s+a\s+creature\s+died\s+this\s+turn$/i.test(clause)) {
    const v = isCreatureDiedThisTurn(ctx);
    return v;
  }

  // "if a permanent you controlled left the battlefield this turn" (Revolt)
  if (/^if\s+a\s+permanent\s+you\s+controlled\s+left\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {
    return didPermanentLeaveBattlefieldThisTurn(ctx, controllerId);
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

  // ===== Cast-modification flags (kicker/foretell etc.) =====
  // "if it was kicked"
  if (/^if\s+it\s+was\s+kicked$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const wasKicked = sourcePermanent?.wasKicked === true || sourcePermanent?.card?.wasKicked === true;
    return wasKicked;
  }

  // "if it/that spell was foretold"
  if (/^if\s+(?:it|that\s+spell)\s+was\s+foretold$/i.test(clause)) {
    return isCastFromForetell(sourcePermanent);
  }

  // "if {R} was spent to cast it" / "if red mana was spent to cast this spell" etc.
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
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+colors\s+of\s+mana\s+were\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const spent = getManaColorsSpentFromSource(sourcePermanent);
      if (!spent) return null;
      return new Set(spent).size >= n;
    }
  }

  // ===== Counter / modification checks =====
  // "if this creature is modified" / "if it is modified"
  if (/^if\s+(?:this\s+creature|it)\s+is\s+modified$/i.test(clause)) {
    if (!sourcePermanent) return null;
    return isPermanentModified(ctx, sourcePermanent);
  }

  // "if it has a +1/+1 counter on it"
  if (/^if\s+it\s+has\s+(?:a|one\s+or\s+more)\s+\+1\/\+1\s+counter\s+on\s+it$/i.test(clause)) {
    if (!sourcePermanent) return null;
    const n = sourcePermanent?.counters?.['+1/+1'];
    return typeof n === 'number' ? n > 0 : false;
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

  if (
    /^if\s+it\s+isn'?t\s+tapped$/i.test(clause) ||
    /^if\s+it\s+is\s+not\s+tapped$/i.test(clause)
  ) {
    if (!sourcePermanent) return null;
    return sourcePermanent.tapped !== true;
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
  if (/^if\s+you\s+completed\s+a\s+dungeon(\s+this\s+turn)?$/i.test(clause)) {
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

  // "if you've cast another spell this turn"
  if (/^if\s+you'?ve\s+cast\s+another\s+spell\s+this\s+turn$/i.test(clause)) {
    return getSpellsCastThisTurnByPlayerCount(ctx, controllerId) >= 2;
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

  // "if you didn't cast a spell this turn" / "if you cast no spells this turn"
  if (
    /^if\s+you\s+(?:did\s+not|didn't)\s+cast\s+a\s+spell\s+this\s+turn$/i.test(clause) ||
    /^if\s+you\s+cast\s+no\s+spells\s+this\s+turn$/i.test(clause)
  ) {
    return getSpellsCastThisTurnByPlayerCount(ctx, controllerId) === 0;
  }

  // "if no spells were cast this turn"
  if (/^if\s+no\s+spells\s+were\s+cast\s+this\s+turn$/i.test(clause)) {
    return getSpellsCastThisTurn(ctx).length === 0;
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

  // Delirium: "if there are four or more card types among cards in your graveyard"
  if (/^if\s+there\s+are\s+four\s+or\s+more\s+card\s+types\s+among\s+cards\s+in\s+your\s+graveyard$/i.test(clause)) {
    return countCardTypesInGraveyard(ctx, controllerId) >= 4;
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
      return getControlledCreatures(ctx, controllerId).some((c: any) => getPermanentPower(c) >= n);
    }
  }

  // Pack tactics / total power: "if you attacked with creatures with total power N or greater"
  {
    const m = clause.match(/^if\s+you\s+attacked\s+with\s+creatures\s+with\s+total\s+power\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getAttackingTotalPower(ctx, controllerId) >= n;
    }
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

  return null;
}

/**
 * Convenience: parse and evaluate the leading intervening-if from a description.
 */
export function isInterveningIfSatisfied(
  ctx: GameContext,
  controllerId: string,
  descriptionOrEffect: string,
  sourcePermanent?: any
): boolean | null {
  const clause = extractInterveningIfClause(descriptionOrEffect);
  if (!clause) return null;
  return evaluateInterveningIfClause(ctx, controllerId, clause, sourcePermanent);
}
