/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: evaluateInterveningIfClauseInternal cast-modification / kicker / foretell / mana-spent clauses
 * Public: tryEvaluateInterveningIfKickerManaClauses
 */

import { sourceWasKicked, sourceWasKickedWithCost } from "../kickerCostUtils.js";
import { parseCountToken } from "./intervening-if-this-turn-counts.js";
import { findBattlefieldPermanent, parseMaybeNumber, sumManaSpentTotal } from "./intervening-if-zone-lookups.js";
import {
  getManaSpentAmountForToken,
  getManaColorsSpentFromSource,
  normalizeColorToken,
  resolveManaSpentBreakdown,
  isCastFromForetell,
} from "./intervening-if-mana-spent.js";
import type { ManaSpentBreakdownResolution } from "./intervening-if-mana-spent.js";
import { getTriggeringStackItemForInterveningIf } from "./intervening-if-eval-support.js";
import type { InterveningIfPhaseArgs, InterveningIfInternalResult } from "./intervening-if-eval-support.js";

export function tryEvaluateInterveningIfKickerManaClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
  const { ctx, controllerId, clause, sourcePermanent, refs } = args;
  // ===== Cast-modification flags (kicker/foretell etc.) =====
  // "if you cast it" / "if you cast this spell" (often on ETB triggers)
  if (/^if\s+you\s+cast\s+(?:it|this\s+spell)$/i.test(clause)) {
    const p: any =
      sourcePermanent ??
      (() => {
        const id = String(
          (refs as any)?.thisPermanentId ??
            (refs as any)?.thisCreatureId ??
            (refs as any)?.thisId ??
            (refs as any)?.sourcePermanentId ??
            ''
        ).trim();
        if (!id) return null;
        return findBattlefieldPermanent(ctx, id);
      })();
    if (!p) return null;
    const direct = p?.enteredFromCast ?? p?.wasCast ?? p?.card?.enteredFromCast ?? p?.card?.wasCast;
    if (typeof direct === 'boolean') return direct;
    // If we at least know the source zone of the cast, that's enough to conclude it was cast.
    const sourceZone = p?.castSourceZone ?? p?.source ?? p?.card?.castSourceZone ?? p?.card?.source;
    if (typeof sourceZone === 'string' && sourceZone.length > 0) return true;
    const fromHand = p?.castFromHand ?? p?.card?.castFromHand;
    if (typeof fromHand === 'boolean') return true;
    return null;
  }

  // "if you cast it from your hand" / "if this spell was cast from your hand"
  if (
    /^if\s+you\s+cast\s+it\s+from\s+your\s+hand$/i.test(clause) ||
    /^if\s+this\s+spell\s+was\s+cast\s+from\s+your\s+hand$/i.test(clause)
  ) {
    const p: any =
      sourcePermanent ??
      (() => {
        const id = String(
          (refs as any)?.thisPermanentId ??
            (refs as any)?.thisCreatureId ??
            (refs as any)?.thisId ??
            (refs as any)?.sourcePermanentId ??
            ''
        ).trim();
        if (!id) return null;
        return findBattlefieldPermanent(ctx, id);
      })();
    if (!p) return null;
    const fromHand = p?.castFromHand ?? p?.card?.castFromHand;
    if (typeof fromHand === 'boolean') return fromHand;
    const sourceZone = p?.castSourceZone ?? p?.source ?? p?.card?.castSourceZone ?? p?.card?.source;
    if (typeof sourceZone === 'string') return String(sourceZone).toLowerCase() === 'hand';
    return null;
  }

  // "if you didn't cast it from your hand"
  if (/^if\s+you\s+didn't\s+cast\s+it\s+from\s+your\s+hand$/i.test(clause) || /^if\s+you\s+did\s+not\s+cast\s+it\s+from\s+your\s+hand$/i.test(clause)) {
    const p: any =
      sourcePermanent ??
      (() => {
        const id = String(
          (refs as any)?.thisPermanentId ??
            (refs as any)?.thisCreatureId ??
            (refs as any)?.thisId ??
            (refs as any)?.sourcePermanentId ??
            ''
        ).trim();
        if (!id) return null;
        return findBattlefieldPermanent(ctx, id);
      })();
    if (!p) return null;
    const fromHand = p?.castFromHand ?? p?.card?.castFromHand;
    if (typeof fromHand === 'boolean') return !fromHand;
    const sourceZone = p?.castSourceZone ?? p?.source ?? p?.card?.castSourceZone ?? p?.card?.source;
    if (typeof sourceZone === 'string') return String(sourceZone).toLowerCase() !== 'hand';
    return null;
  }

  // "if it entered from your graveyard or you cast it from your graveyard" (best-effort)
  if (/^if\s+it\s+entered\s+from\s+your\s+graveyard\s+or\s+you\s+cast\s+it\s+from\s+your\s+graveyard$/i.test(clause)) {
    const p: any =
      sourcePermanent ??
      (() => {
        const id = String(
          (refs as any)?.thisPermanentId ??
            (refs as any)?.thisCreatureId ??
            (refs as any)?.thisId ??
            (refs as any)?.sourcePermanentId ??
            ''
        ).trim();
        if (!id) return null;
        return findBattlefieldPermanent(ctx, id);
      })();
    if (!p) return null;
    const enteredFrom = p?.enteredFromZone ?? p?.card?.enteredFromZone;
    const castFrom = p?.castSourceZone ?? p?.source ?? p?.card?.castSourceZone ?? p?.card?.source;

    const okEntered = typeof enteredFrom === "string" && String(enteredFrom).toLowerCase() === "graveyard";
    const okCast = typeof castFrom === "string" && String(castFrom).toLowerCase() === "graveyard";
    if (okEntered || okCast) return true;

    if (typeof enteredFrom === "string" || typeof castFrom === "string") return false;
    return null;
  }

  // "if it was cast from your graveyard" / "if this spell was cast from your graveyard" (best-effort)
  if (/^if\s+(?:it|this\s+spell)\s+was\s+cast\s+from\s+your\s+graveyard$/i.test(clause)) {
    const p: any =
      sourcePermanent ??
      (() => {
        const id = String(
          (refs as any)?.thisPermanentId ??
            (refs as any)?.thisCreatureId ??
            (refs as any)?.thisId ??
            (refs as any)?.sourcePermanentId ??
            ''
        ).trim();
        if (!id) return null;
        return findBattlefieldPermanent(ctx, id);
      })();
    if (!p) return null;
    const castFrom = p?.castSourceZone ?? p?.source ?? p?.card?.castSourceZone ?? p?.card?.source;
    if (typeof castFrom === 'string') return String(castFrom).toLowerCase() === 'graveyard';
    const v = p?.castFromGraveyard ?? p?.card?.castFromGraveyard;
    return typeof v === 'boolean' ? v : null;
  }

  // "if one or more of them entered from a graveyard or was cast from a graveyard" (needs plural-context tracking)
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+of\s+them\s+entered\s+from\s+a\s+graveyard\s+or\s+was\s+cast\s+from\s+a\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const thoseIdsRaw = refs?.thoseCreatureIds ?? (sourcePermanent as any)?.thoseCreatureIds;
      if (!Array.isArray(thoseIdsRaw) || thoseIdsRaw.length === 0) return null;
      const thoseIds = thoseIdsRaw.map((id) => String(id));

      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;

      let matchCount = 0;
      let knownCount = 0;
      for (const id of thoseIds) {
        const p = battlefield.find((perm: any) => perm && String(perm.id) === id);
        if (!p) continue;

        const enteredFrom = (p as any)?.enteredFromZone ?? (p as any)?.card?.enteredFromZone;
        const castFrom = (p as any)?.castSourceZone ?? (p as any)?.source ?? (p as any)?.card?.castSourceZone ?? (p as any)?.card?.source;
        const castFromG = (p as any)?.castFromGraveyard ?? (p as any)?.card?.castFromGraveyard;
        const enteredFromG = (p as any)?.enteredFromGraveyard ?? (p as any)?.card?.enteredFromGraveyard;

        let known = false;
        let ok = false;

        if (typeof enteredFrom === 'string') {
          known = true;
          ok = ok || String(enteredFrom).toLowerCase() === 'graveyard';
        }
        if (typeof castFrom === 'string') {
          known = true;
          ok = ok || String(castFrom).toLowerCase() === 'graveyard';
        }
        if (typeof castFromG === 'boolean') {
          known = true;
          ok = ok || castFromG;
        }
        if (typeof enteredFromG === 'boolean') {
          known = true;
          ok = ok || enteredFromG;
        }

        if (known) {
          knownCount++;
          if (ok) matchCount++;
        }
      }

      // If we can already meet the threshold with known matches, conclude true.
      if (matchCount >= n) return true;

      // If even assuming all unknowns are matches we still can't hit the threshold, conclude false.
      const unknownCount = thoseIds.length - knownCount;
      if (matchCount + unknownCount < n) return false;

      // Otherwise we don't have enough tracked data yet.
      return null;
    }
  }

  // "if one or more of them entered from exile or was cast from exile" (needs plural-context tracking)
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+of\s+them\s+entered\s+from\s+exile\s+or\s+was\s+cast\s+from\s+exile$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const thoseIdsRaw = refs?.thoseCreatureIds ?? (sourcePermanent as any)?.thoseCreatureIds;
      if (!Array.isArray(thoseIdsRaw) || thoseIdsRaw.length === 0) return null;
      const thoseIds = thoseIdsRaw.map((id) => String(id));

      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;

      let matchCount = 0;
      let knownCount = 0;
      for (const id of thoseIds) {
        const p = battlefield.find((perm: any) => perm && String(perm.id) === id);
        if (!p) continue;

        const enteredFrom = (p as any)?.enteredFromZone ?? (p as any)?.card?.enteredFromZone;
        const castFrom = (p as any)?.castSourceZone ?? (p as any)?.source ?? (p as any)?.card?.castSourceZone ?? (p as any)?.card?.source;

        let known = false;
        let ok = false;
        if (typeof enteredFrom === 'string') {
          known = true;
          ok = ok || String(enteredFrom).toLowerCase() === 'exile';
        }
        if (typeof castFrom === 'string') {
          known = true;
          ok = ok || String(castFrom).toLowerCase() === 'exile';
        }

        if (known) {
          knownCount++;
          if (ok) matchCount++;
        }
      }

      if (matchCount >= n) return true;
      const unknownCount = thoseIds.length - knownCount;
      if (matchCount + unknownCount < n) return false;
      return null;
    }
  }

  // "if it was kicked"
  if (/^if\s+it\s+was\s+kicked$/i.test(clause)) {
    const item = (refs as any)?.stackItem ?? sourcePermanent ?? refs;
    const result = sourceWasKicked(item) ?? sourceWasKicked(refs);
    return result;
  }

  // "if this creature wasn't kicked" / "if this creature was not kicked" (best-effort)
  if (/^if\s+this\s+creature\s+was\s+not\s+kicked$/i.test(clause) || /^if\s+this\s+creature\s+wasn'?t\s+kicked$/i.test(clause)) {
    const explicit = (refs as any)?.wasKicked ?? (refs as any)?.card?.wasKicked;
    if (typeof explicit === 'boolean') return !explicit;

    const item = (refs as any)?.stackItem ?? sourcePermanent;
    if (!item) return null;

    const v = (item as any)?.wasKicked ?? (item as any)?.card?.wasKicked;
    if (typeof v === 'boolean') return !v;

    const count =
      (refs as any)?.kickerPaidCount ??
      (refs as any)?.timesKicked ??
      (refs as any)?.kickedTimes ??
      (refs as any)?.card?.kickerPaidCount ??
      (refs as any)?.card?.timesKicked ??
      (refs as any)?.card?.kickedTimes ??
      (item as any)?.kickerPaidCount ??
      (item as any)?.timesKicked ??
      (item as any)?.kickedTimes ??
      (item as any)?.card?.kickerPaidCount ??
      (item as any)?.card?.timesKicked ??
      (item as any)?.card?.kickedTimes;
    if (typeof count === 'number') {
      // If we have positive evidence it was kicked at least once, this clause is false.
      if (count > 0) return false;
      // Otherwise (0) we don't assume not-kicked unless explicitly tracked.
      return null;
    }

    return null;
  }

  // "if it was kicked with its {..} kicker"
  {
    const specificKickerMatch = clause.match(
      /^if\s+it\s+was\s+kicked\s+with\s+its\s+((?:\{[^}]+\})+)\s+kicker$/i,
    );
    if (specificKickerMatch) {
      const costText = String(specificKickerMatch[1] || '');
      const item = (refs as any)?.stackItem ?? sourcePermanent ?? refs;
      const result = sourceWasKickedWithCost(item, costText) ?? sourceWasKickedWithCost(refs, costText);
      return result;
    }
  }

  // "if it was bargained" (best-effort)
  if (/^if\s+it\s+was\s+bargained$/i.test(clause)) {
    const item = (refs as any)?.stackItem;
    const src = item || sourcePermanent;
    if (!src) return null;

    const resolved = (src as any)?.bargainResolved ?? (src as any)?.card?.bargainResolved;
    const v = (src as any)?.wasBargained ?? (src as any)?.card?.wasBargained;

    // Deterministic only when explicitly marked resolved.
    if (resolved === true && typeof v === 'boolean') return v;

    // Positive-only evidence path.
    if (v === true) return true;
    return null;
  }

  // "if it/this <thing>/that spell was cast" (best-effort)
  if (
    /^if\s+it\s+was\s+cast$/i.test(clause) ||
    /^if\s+this\s+(?:spell|creature|permanent|artifact|enchantment|planeswalker|instant|sorcery|card)\s+was\s+cast$/i.test(clause) ||
    /^if\s+that\s+spell\s+was\s+cast$/i.test(clause)
  ) {
    const explicit = (refs as any)?.wasCast ?? (refs as any)?.card?.wasCast;
    if (typeof explicit === 'boolean') return explicit;

    const item = (refs as any)?.stackItem ?? sourcePermanent;
    if (!item) return null;

    const v =
      (item as any)?.enteredFromCast ??
      (item as any)?.wasCast ??
      (item as any)?.card?.enteredFromCast ??
      (item as any)?.card?.wasCast;
    if (typeof v === 'boolean') return v;

    // If we at least know the source zone of the cast, that's enough to conclude it was cast.
    const sourceZone =
      (item as any)?.castSourceZone ??
      (item as any)?.fromZone ??
      (item as any)?.source ??
      (item as any)?.card?.castSourceZone ??
      (item as any)?.card?.fromZone ??
      (item as any)?.card?.source;
    if (typeof sourceZone === 'string' && sourceZone.trim().length > 0) return true;

    const fromHand = (item as any)?.castFromHand ?? (item as any)?.card?.castFromHand;
    const fromExile = (item as any)?.castFromExile ?? (item as any)?.card?.castFromExile;
    const fromGraveyard = (item as any)?.castFromGraveyard ?? (item as any)?.card?.castFromGraveyard;
    if (typeof fromHand === 'boolean' || typeof fromExile === 'boolean' || typeof fromGraveyard === 'boolean') return true;

    // Presence of a foretell-cast flag (even false) implies a cast happened.
    const fromForetell = (item as any)?.castFromForetell ?? (item as any)?.card?.castFromForetell;
    if (typeof fromForetell === 'boolean') return true;

    return null;
  }

  // "if it/that spell was foretold"
  if (/^if\s+(?:it|that\s+spell)\s+was\s+foretold$/i.test(clause)) {
    const isThatSpell = /\bthat\s+spell\b/i.test(clause);
    const src = isThatSpell ? getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs) ?? sourcePermanent : sourcePermanent;
    return isCastFromForetell(src);
  }

  // Mana-spend-to-cast templates frequently refer to the triggering spell on the stack ("it").
  // Prefer the triggering stack item when provided; fall back to the passed source for spell-self templates.
  const manaSpendCastSource: any = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs) ?? sourcePermanent;

  // "if {R} was spent to cast it" / "if red mana was spent to cast this spell" etc.
  {
    const m = clause.match(/^if\s+((?:\{[wubrg]\}){2,})\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const groups = Array.from(String(m[1]).matchAll(/\{([wubrg])\}/gi)).map((mm) => String(mm[1]).toLowerCase());
      if (!groups.length) return null;
      if (!groups.every((c) => c === groups[0])) return null;
      const normalized = normalizeColorToken(groups[0]);
      if (!normalized) return null;
      const amount = getManaSpentAmountForToken(manaSpendCastSource, normalized);
      if (amount === null) return null;
      return amount >= groups.length;
    }
  }
  {
    const m = clause.match(/^if\s+((?:\{c\}){2,})\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const groups = Array.from(String(m[1]).matchAll(/\{c\}/gi));
      if (!groups.length) return null;
      const amount = getManaSpentAmountForToken(manaSpendCastSource, 'colorless');
      if (amount === null) return null;
      return amount >= groups.length;
    }
  }
  {
    const m = clause.match(/^if\s+\{([wubrg])\}\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const color = normalizeColorToken(m[1]);
      if (!color) return null;
      const amount = getManaSpentAmountForToken(manaSpendCastSource, color);
      if (typeof amount === 'number') return amount > 0;

      // Positive-only fallback: if we have an explicit lower-bound list, honor it.
      const spent = getManaColorsSpentFromSource(manaSpendCastSource);
      if (Array.isArray(spent)) return spent.includes(color);
      return null;
    }
  }
  {
    const m = clause.match(/^if\s+\{c\}\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const amount = getManaSpentAmountForToken(manaSpendCastSource, 'colorless');
      if (amount === null) return null;
      return amount > 0;
    }
  }
  {
    const m = clause.match(/^if\s+\{c\}\s+(?:wasn't|was\s+not)\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const amount = getManaSpentAmountForToken(manaSpendCastSource, 'colorless');
      if (amount === null) return null;
      return amount === 0;
    }
  }
  {
    const m = clause.match(/^if\s+((?:\{s\}){2,})\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const groups = Array.from(String(m[1]).matchAll(/\{s\}/gi));
      if (!groups.length) return null;

      const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
      const src: any = item || sourcePermanent;

      const snowKnown = src?.snowManaSpentKnown ?? src?.card?.snowManaSpentKnown;
      const snowSpent = src?.snowManaSpent ?? src?.card?.snowManaSpent;
      if (snowKnown === true && typeof snowSpent === 'boolean' && snowSpent === false) return false;

      const snowByColor =
        src?.snowManaSpentByColor ??
        src?.snowSpentByColor ??
        src?.manaSpentSnowByColor ??
        src?.card?.snowManaSpentByColor;
      if (!snowByColor || typeof snowByColor !== 'object') return null;

      const keys = ['white', 'blue', 'black', 'red', 'green', 'colorless', 'w', 'u', 'b', 'r', 'g', 'c'];
      let total = 0;
      for (const k of keys) {
        const n = parseMaybeNumber((snowByColor as any)[k]);
        if (n === null) continue;
        total += n;
      }

      return total >= groups.length ? true : null;
    }
  }
  {
    const m = clause.match(/^if\s+\{s\}\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
      const src: any = item || sourcePermanent;

      const snowKnown = src?.snowManaSpentKnown ?? src?.card?.snowManaSpentKnown;
      const snowSpent = src?.snowManaSpent ?? src?.card?.snowManaSpent;
      if (snowKnown === true && typeof snowSpent === 'boolean') return snowSpent;

      const snowByColor =
        src?.snowManaSpentByColor ??
        src?.snowSpentByColor ??
        src?.manaSpentSnowByColor ??
        src?.card?.snowManaSpentByColor;
      if (!snowByColor || typeof snowByColor !== 'object') return null;
      const keys = ['white', 'blue', 'black', 'red', 'green', 'colorless', 'w', 'u', 'b', 'r', 'g', 'c'];
      for (const k of keys) {
        const n = parseMaybeNumber((snowByColor as any)[k]);
        if (n !== null && n > 0) return true;
      }
      return null;
    }
  }
  {
    const m = clause.match(/^if\s+snow\s+mana\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
      const src: any = item || sourcePermanent;

      const snowKnown = src?.snowManaSpentKnown ?? src?.card?.snowManaSpentKnown;
      const snowSpent = src?.snowManaSpent ?? src?.card?.snowManaSpent;
      if (snowKnown === true && typeof snowSpent === 'boolean') return snowSpent;

      const snowByColor =
        src?.snowManaSpentByColor ??
        src?.snowSpentByColor ??
        src?.manaSpentSnowByColor ??
        src?.card?.snowManaSpentByColor;
      if (!snowByColor || typeof snowByColor !== 'object') return null;
      const keys = ['white', 'blue', 'black', 'red', 'green', 'colorless', 'w', 'u', 'b', 'r', 'g', 'c'];
      for (const k of keys) {
        const n = parseMaybeNumber((snowByColor as any)[k]);
        if (n !== null && n > 0) return true;
      }
      return null;
    }
  }
  {
    const m = clause.match(/^if\s+(white|blue|black|red|green)\s+mana\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const color = normalizeColorToken(m[1]);
      if (!color) return null;
      const amount = getManaSpentAmountForToken(manaSpendCastSource, color);
      if (typeof amount === 'number') return amount > 0;

      const spent = getManaColorsSpentFromSource(manaSpendCastSource);
      if (Array.isArray(spent)) return spent.includes(color);
      return null;
    }
  }
  {
    const m = clause.match(/^if\s+colorless\s+mana\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const amount = getManaSpentAmountForToken(manaSpendCastSource, 'colorless');
      if (amount === null) return null;
      return amount > 0;
    }
  }
  {
    const m = clause.match(/^if\s+colorless\s+mana\s+(?:wasn't|was\s+not)\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const amount = getManaSpentAmountForToken(manaSpendCastSource, 'colorless');
      if (amount === null) return null;
      return amount === 0;
    }
  }
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+colors\s+of\s+mana\s+were\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const resolved = resolveManaSpentBreakdown(manaSpendCastSource);
      if (resolved) {
        const colorsSpent = ['white', 'blue', 'black', 'red', 'green'].filter((k) => (resolved.amounts as any)[k] !== null && (resolved.amounts as any)[k] > 0);
        if (resolved.complete) return new Set(colorsSpent).size >= n;
        if (new Set(colorsSpent).size >= n) return true;
      }

      // Positive-only fallback: if we have an explicit lower-bound list, honor it.
      const spent = getManaColorsSpentFromSource(manaSpendCastSource);
      if (spent && new Set(spent).size >= n) return true;
      return null;
    }
  }

  // "if no colored mana was spent to cast it" (conservative)
  {
    const m = clause.match(/^if\s+no\s+colored\s+mana\s+was\s+spent\s+to\s+cast\s+(?:this\s+spell|it)$/i);
    if (m) {
      if (!manaSpendCastSource) return null;

      const resolved = resolveManaSpentBreakdown(manaSpendCastSource);
      if (resolved) {
        const colorKeys: Array<keyof ManaSpentBreakdownResolution['amounts']> = ['white', 'blue', 'black', 'red', 'green'];
        const allColoredKnown = colorKeys.every((k) => typeof resolved.amounts[k] === 'number');
        for (const k of colorKeys) {
          const v = resolved.amounts[k];
          if (typeof v === 'number' && v > 0) return false;
        }
        if (resolved.complete || allColoredKnown) return true;
      }

      // Positive-only fallback: if we explicitly tracked any colored spend, we can conclude false.
      const spent = getManaColorsSpentFromSource(manaSpendCastSource);
      if (Array.isArray(spent)) return spent.length === 0;
      return null;
    }
  }

  // "if at least N mana was spent to cast it"
  {
    const m = clause.match(/^if\s+at\s+least\s+([a-z0-9]+)\s+mana\s+was\s+spent\s+to\s+cast\s+it$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const total = sumManaSpentTotal(manaSpendCastSource);
      if (total === null) return null;
      return total >= n;
    }
  }

  // "if no mana was spent to cast that spell" (refers to the triggering spell on the stack)
  if (/^if\s+no\s+mana\s+was\s+spent\s+to\s+cast\s+that\s+spell$/i.test(clause)) {
    const refStackItem = (refs as any)?.stackItem;
    const stackId =
      refs?.triggeringStackItemId ??
      (sourcePermanent as any)?.triggeringStackItemId ??
      (sourcePermanent as any)?.triggeringSpellStackItemId;
    const stack: any[] = Array.isArray((ctx as any).state?.stack) ? (ctx as any).state.stack : [];
    const triggeringStackItem = refStackItem ?? (stackId ? stack.find((it: any) => it && String(it.id) === String(stackId)) : null);
    const total = sumManaSpentTotal(triggeringStackItem);
    if (total === null) return null;
    return total === 0;
  }

  // "if no mana was spent to cast it"
  if (/^if\s+no\s+mana\s+was\s+spent\s+to\s+cast\s+it$/i.test(clause)) {
    const total = sumManaSpentTotal(manaSpendCastSource);
    if (total === null) return null;
    return total === 0;
  }

  // "if mana from a Treasure was spent to cast it" (positive-only: true when explicitly tracked)
  if (
    /^if\s+mana\s+from\s+a\s+treasure\s+was\s+spent\s+to\s+cast\s+it$/i.test(clause) ||
    /^if\s+mana\s+from\s+a\s+treasure\s+was\s+spent\s+to\s+cast\s+it\s+or\s+activate\s+it$/i.test(clause)
  ) {
    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
    const src: any = item || sourcePermanent;
    if (!src) return null;
    const known = src?.manaFromTreasureSpentKnown ?? src?.card?.manaFromTreasureSpentKnown;
    const v = src?.manaFromTreasureSpent ?? src?.card?.manaFromTreasureSpent;

    // Deterministic only when explicitly marked known.
    if (known === true && typeof v === 'boolean') return v;

    // Preserve positive-only evidence path.
    if (v === true) return true;
    return null;
  }

  return undefined;
}
