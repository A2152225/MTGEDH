/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: evaluateInterveningIfClauseInternal targeted handlers for last fallback-only clauses
 * (this-creature counters through sole-attacker-of-that-player)
 * Public: tryEvaluateInterveningIfTargetedLastFallbackClauses
 */

import { getEffectiveBasicLandTypes } from "../mana-abilities.js";
import { parseCountToken } from "./intervening-if-this-turn-counts.js";
import {
  getCounterCountCaseInsensitiveFromPerm,
  typeLineHasWord,
  getGraveyard,
  findBattlefieldPermanentsByName,
  nameMatchesClauseName,
  findBattlefieldPermanent,
  sumAllCounters,
  hasAnyCountersOnPermanent,
} from "./intervening-if-zone-lookups.js";
import { getControlledCreatures, permanentHasKeyword } from "./intervening-if-permanent-and-player.js";
import type { InterveningIfPhaseArgs, InterveningIfInternalResult } from "./intervening-if-eval-support.js";

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

export function tryEvaluateInterveningIfTargetedLastFallbackClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
  const { ctx, controllerId, clause, sourcePermanent, refs } = args;
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
    const perm =
      sourcePermanent ??
      (() => {
        const id = String(
          (refs as any)?.thisCreatureId ??
            (refs as any)?.thisPermanentId ??
            (refs as any)?.thisId ??
            (refs as any)?.sourcePermanentId ??
            ''
        ).trim();
        if (!id) return null;
        return findBattlefieldPermanent(ctx, id);
      })();
    const has = permanentHasKeyword(perm, 'first strike');
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

  // "this creature/enchantment is on the battlefield"
  if (/^if\s+this\s+creature\s+is\s+on\s+the\s+battlefield$/i.test(clause)) {
    return sourcePermanent ? true : null;
  }
  if (/^if\s+this\s+enchantment\s+is\s+on\s+the\s+battlefield$/i.test(clause)) {
    return sourcePermanent ? true : null;
  }

  // --- Targeted patterns that would otherwise be swallowed by broad recognizers below ---

  // "if Sarulf has one or more +1/+1 counters on it"
  if (/^if\s+sarulf\s+has\s+one\s+or\s+more\s+\+1\/\+1\s+counters\s+on\s+it$/i.test(clause)) {
    const nameLower = 'sarulf';
    const candidates: any[] = [];
    if (sourcePermanent && nameMatchesClauseName(toLower(sourcePermanent?.card?.name || sourcePermanent?.name || ''), nameLower)) {
      candidates.push(sourcePermanent);
    }
    candidates.push(...findBattlefieldPermanentsByName(ctx, nameLower));
    if (!candidates.length) return null;
    for (const p of candidates) {
      const n = getCounterCountCaseInsensitiveFromPerm(p, '+1/+1');
      if (n === null) return null;
      if (n > 0) return true;
    }
    return false;
  }

  // "if that player controls one or more lands with contested counters on them"
  if (/^if\s+that\s+player\s+controls\s+one\s+or\s+more\s+lands\s+with\s+contested\s+counters\s+on\s+them$/i.test(clause)) {
    const thatPlayerId = String((refs as any)?.thatPlayerId ?? (refs as any)?.referencedPlayerId ?? (refs as any)?.theirPlayerId ?? '').trim();
    if (!thatPlayerId) return null;
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;

    let sawCountersObjectForAny = false;
    for (const p of battlefield) {
      if (!p || String(p.controller || '') !== String(thatPlayerId)) continue;
      const tl = String(p?.card?.type_line || '').toLowerCase();
      if (!tl.includes('land')) continue;
      if ((p as any).counters && typeof (p as any).counters === 'object') sawCountersObjectForAny = true;
      const n = getCounterCountCaseInsensitiveFromPerm(p, 'contested');
      if (n === null) continue;
      if (n > 0) return true;
    }
    return sawCountersObjectForAny ? false : null;
  }

  // "if two or more permanents you don't control have an aim counter on them"
  if (/^if\s+two\s+or\s+more\s+permanents\s+you\s+don'?t\s+control\s+have\s+an\s+aim\s+counter\s+on\s+them$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    let count = 0;
    let allHaveCountersObjects = true;
    for (const p of battlefield) {
      if (!p || String(p.controller || '') === String(controllerId)) continue;
      if (!(p as any).counters || typeof (p as any).counters !== 'object') allHaveCountersObjects = false;
      const n = getCounterCountCaseInsensitiveFromPerm(p, 'aim');
      if (n === null) continue;
      if (n > 0) count++;
      if (count >= 2) return true;
    }
    return allHaveCountersObjects ? false : null;
  }

  // "if that player doesn't control a creature named Yargle"
  if (/^if\s+that\s+player\s+doesn'?t\s+control\s+a\s+creature\s+named\s+yargle$/i.test(clause)) {
    const thatPlayerId = String((refs as any)?.thatPlayerId ?? (refs as any)?.referencedPlayerId ?? (refs as any)?.theirPlayerId ?? '').trim();
    if (!thatPlayerId) return null;
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    const hasYargle = battlefield.some((p: any) => {
      if (!p || String(p.controller || '') !== String(thatPlayerId)) return false;
      const tl = String(p?.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return false;
      return nameMatchesClauseName(toLower(p?.card?.name || p?.name || ''), 'yargle');
    });
    return !hasYargle;
  }

  // "if that player has no cards in hand and this enchantment has two or more quest counters on it"
  if (/^if\s+that\s+player\s+has\s+no\s+cards\s+in\s+hand\s+and\s+this\s+enchantment\s+has\s+two\s+or\s+more\s+quest\s+counters\s+on\s+it$/i.test(clause)) {
    const thatPlayerId = String((refs as any)?.thatPlayerId ?? (refs as any)?.referencedPlayerId ?? (refs as any)?.theirPlayerId ?? '').trim();
    if (!thatPlayerId) return null;
    const enchantmentId = String(
      (sourcePermanent as any)?.id ??
        (refs as any)?.thisEnchantmentId ??
        (refs as any)?.thisPermanentId ??
        (refs as any)?.sourcePermanentId ??
        ''
    ).trim();
    const enchantment = sourcePermanent ?? (enchantmentId ? findBattlefieldPermanent(ctx, enchantmentId) : null);
    if (!enchantment) return null;

    const zones = (ctx as any).state?.zones;
    if (!zones || typeof zones !== 'object') return null;
    const z = (zones as any)[thatPlayerId];
    if (!z || typeof z !== 'object') return null;
    const handKnown = typeof z.handCount === 'number' || Array.isArray(z.hand);
    if (!handKnown) return null;
    const handCount = typeof z.handCount === 'number' ? z.handCount : Array.isArray(z.hand) ? z.hand.length : 0;

    const qc = getCounterCountCaseInsensitiveFromPerm(enchantment, 'quest');
    if (qc === null) return null;
    return handCount === 0 && qc >= 2;
  }

  // "if there are four or more basic land types among lands that player controls"
  if (/^if\s+there\s+are\s+four\s+or\s+more\s+basic\s+land\s+types\s+among\s+lands\s+that\s+player\s+controls$/i.test(clause)) {
    const thatPlayerId = String((refs as any)?.thatPlayerId ?? (refs as any)?.referencedPlayerId ?? (refs as any)?.theirPlayerId ?? '').trim();
    if (!thatPlayerId) return null;
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    const set = new Set<string>();
    let sawLand = false;
    for (const p of battlefield) {
      if (!p || String(p.controller || '') !== String(thatPlayerId)) continue;
      const tl = String(p?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      if (!tl.includes('land')) continue;
      sawLand = true;
      for (const t of getEffectiveBasicLandTypes((ctx as any).state, p)) {
        set.add(t);
      }
      if (set.size >= 4) return true;
    }
    if (!sawLand) return false;
    return set.size >= 4;
  }

  // "if there are four or more land cards in your graveyard and you both own and control Titania"
  if (/^if\s+there\s+are\s+four\s+or\s+more\s+land\s+cards\s+in\s+your\s+graveyard\s+and\s+you\s+both\s+own\s+and\s+control\s+titania$/i.test(clause)) {
    const zones = (ctx as any).state?.zones;
    if (!zones || typeof zones !== 'object') return null;
    const gy = getGraveyard(ctx, controllerId);
    let landCount = 0;
    let unknownTypeCount = 0;
    for (const c of gy) {
      const tl = (c as any)?.type_line;
      if (typeof tl !== 'string') {
        unknownTypeCount++;
        continue;
      }
      if (String(tl).toLowerCase().includes('land')) landCount++;
      if (landCount >= 4) break;
    }
    if (landCount < 4 && unknownTypeCount > 0) return null;
    if (landCount < 4) return false;

    const titania = findBattlefieldPermanentsByName(ctx, 'titania');
    if (!titania.length) return false;
    let sawOwner = false;
    for (const p of titania) {
      if (!p) continue;
      if (String(p.controller || '') !== String(controllerId)) continue;
      if (typeof (p as any).owner === 'string') {
        sawOwner = true;
        if (String((p as any).owner) === String(controllerId)) return true;
      }
    }
    return sawOwner ? false : null;
  }

  // "if there are three or more cards exiled with The Mysterious Sphere"
  if (/^if\s+there\s+are\s+three\s+or\s+more\s+cards\s+exiled\s+with\s+the\s+mysterious\s+sphere$/i.test(clause)) {
    // Primary: explicit refs from the resolving effect.
    const exiledCards = (refs as any)?.exiledCards;
    if (Array.isArray(exiledCards)) return exiledCards.length >= 3;

    // Secondary: linked-exile bookkeeping (replay-stable when present).
    const linked = (ctx as any)?.state?.linkedExiles;
    if (!Array.isArray(linked)) return null;

    const spheres = findBattlefieldPermanentsByName(ctx, 'the mysterious sphere');
    if (spheres.length !== 1) return null;
    const sphereId = String((spheres[0] as any)?.id ?? '').trim();
    if (!sphereId) return null;

    const count = linked.filter((le: any) => String(le?.exilingPermanentId ?? '') === sphereId).length;
    return count >= 3;
  }

  // "if there is an Elf card in your graveyard and this creature has a -1/-1 counter on it"
  if (/^if\s+there\s+is\s+an\s+elf\s+card\s+in\s+your\s+graveyard\s+and\s+this\s+creature\s+has\s+a\s+-1\/\-1\s+counter\s+on\s+it$/i.test(clause)) {
    const thisId = String(
      (sourcePermanent as any)?.id ??
        (refs as any)?.thisCreatureId ??
        (refs as any)?.thisPermanentId ??
        (refs as any)?.sourcePermanentId ??
        ''
    ).trim();
    const p = sourcePermanent ?? (thisId ? findBattlefieldPermanent(ctx, thisId) : null);
    if (!p) return null;
    const zones = (ctx as any).state?.zones;
    if (!zones || typeof zones !== 'object') return null;
    const gy = getGraveyard(ctx, controllerId);
    let hasElf = false;
    let sawUnknown = false;
    for (const c of gy) {
      const tl = (c as any)?.type_line;
      if (typeof tl !== 'string') {
        sawUnknown = true;
        continue;
      }
      if (typeLineHasWord(String(tl).toLowerCase(), 'elf')) {
        hasElf = true;
        break;
      }
    }
    if (!hasElf && sawUnknown) return null;
    if (!hasElf) return false;

    const c = getCounterCountCaseInsensitiveFromPerm(p, '-1/-1');
    if (c === null) return null;
    return c > 0;
  }

  // "if no other creatures are attacking that player" (best-effort; needs explicit attack-target info)
  if (/^if\s+no\s+other\s+creatures\s+are\s+attacking\s+that\s+player$/i.test(clause)) {
    const thisId = String(
      (sourcePermanent as any)?.id ??
        (refs as any)?.thisCreatureId ??
        (refs as any)?.thisPermanentId ??
        (refs as any)?.sourcePermanentId ??
        ''
    ).trim();
    const self = sourcePermanent ?? (thisId ? findBattlefieldPermanent(ctx, thisId) : null);
    if (!self) return null;
    const thatPlayerId = String((refs as any)?.thatPlayerId ?? (refs as any)?.defendingPlayerId ?? (refs as any)?.referencedPlayerId ?? '').trim();
    if (!thatPlayerId) return null;
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;

    const sourceId = String((self as any)?.id ?? '').trim();
    if (!sourceId) return null;

    const getAttackTargetId = (p: any): string | null => {
      const v = (p as any).attackingTargetId ?? (p as any).attackedPlayerId ?? (p as any).defendingPlayerId;
      if (typeof v === 'string' && v) return String(v).trim();
      if (typeof (p as any).attacking === 'string' && (p as any).attacking) return String((p as any).attacking).trim();
      return null;
    };

    const sourceTarget = getAttackTargetId(self);
    if (sourceTarget !== thatPlayerId) return null;

    // Prefer per-combat declared-attacker tracking when available, since it provides a complete list of attackers.
    // This lets us safely answer `true` even when there are other attackers (as long as none attack that player).
    try {
      const declaredMap = (ctx as any).state?.attackersDeclaredThisCombatByPlayer;
      const declaredRaw = declaredMap && typeof declaredMap === 'object' ? (declaredMap as any)[String(controllerId)] : null;
      if (Array.isArray(declaredRaw) && declaredRaw.length > 0) {
        const attackerIds = declaredRaw
          .map((a: any) => String((a as any)?.id ?? a ?? '').trim())
          .filter((id: string) => Boolean(id));

        if (attackerIds.includes(sourceId)) {
          for (const attackerId of attackerIds) {
            if (attackerId === sourceId) continue;
            const perm = battlefield.find((p: any) => p && String(p?.id ?? '').trim() === attackerId);
            if (!perm) return null;
            const t = getAttackTargetId(perm);
            if (!t) return null;
            if (t === thatPlayerId) return false;
          }

          return true;
        }
      }
    } catch {
      // best-effort only; fall through to battlefield scan
    }

    // Fallback: scan battlefield for other attackers that clearly attack that player.
    let sawAttackerWithUnknownTarget = false;
    for (const p of battlefield) {
      if (!p) continue;
      const pid = String((p as any)?.id ?? '').trim();
      if (pid && pid === sourceId) continue;

      const isAttacking =
        (p as any).attacking === true ||
        (p as any).isAttacking === true ||
        typeof (p as any).attacking === 'string' ||
        typeof (p as any).attackingTargetId === 'string';
      if (!isAttacking) continue;

      const t = getAttackTargetId(p);
      if (!t) {
        sawAttackerWithUnknownTarget = true;
        continue;
      }
      if (t === thatPlayerId) return false;
    }

    return sawAttackerWithUnknownTarget ? null : true;
  }

  return undefined;
}
