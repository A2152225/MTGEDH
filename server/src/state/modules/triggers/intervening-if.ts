import type { GameContext } from "../context.js";

function normalizeText(text: string): string {
  return String(text || "")
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

    const youMoreThanEach = clause.match(/^if\s+you\s+have\s+more\s+life\s+than\s+each\s+opponent$/i);
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

  // "if you attacked this turn" (Raid and similar)
  if (/^if\s+you\s+attacked\s+this\s+turn$/i.test(clause)) {
    return didPlayerAttackThisTurn(ctx, controllerId);
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

  // "if N or more spells were cast this turn" (Archenemy/Planechase and similar)
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+spells\s+were\s+cast\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getSpellsCastThisTurnCount(ctx) >= n;
    }
  }

  // "if you control no X"
  {
    const m = clause.match(/^if\s+you\s+control\s+no\s+([a-z0-9\-\s']+)$/i);
    if (m) {
      const nounRaw = m[1].trim();
      if (nounRaw === "cards in hand") {
        return getHandCount(ctx, controllerId) === 0;
      }

      // Special case: "no basic lands" / "no lands" etc.
      if (nounRaw === "basic lands") return countBasicLands(ctx, controllerId) === 0;

      const noun = nounRaw.replace(/\s+/g, " ");
      const nounSingular = noun.endsWith("s") ? noun.slice(0, -1) : noun;

      // Heuristic: check type line contains the noun (covers permanent types and creature types).
      return countByPermanentType(ctx, controllerId, nounSingular) === 0;
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
      const noun = nounRaw.endsWith("s") ? nounRaw.slice(0, -1) : nounRaw;
      return countByPermanentType(ctx, controllerId, noun) >= 1;
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

  // "if you have no cards in hand"
  if (/^if\s+you\s+have\s+no\s+cards\s+in\s+hand$/i.test(clause)) {
    return getHandCount(ctx, controllerId) === 0;
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
