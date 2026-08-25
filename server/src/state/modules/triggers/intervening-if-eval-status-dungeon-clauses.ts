/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: evaluateInterveningIfClauseInternal counter/modified, permanent-type, combat status,
 * party, ownership, chosen color, dungeon clauses
 * Public: tryEvaluateInterveningIfStatusDungeonClauses
 */

import {
  parseCountToken,
  countLandsWithSubtype,
  countControlledPermanents,
  hasFullParty,
  hasLandsOfAllBasicTypes,
} from "./intervening-if-this-turn-counts.js";
import {
  getCounterCount,
  getCounterCountCaseInsensitiveFromPerm,
  hasAnyCounters,
  findBattlefieldPermanent,
  parseMaybeNumber,
  sumAllCounters,
} from "./intervening-if-zone-lookups.js";
import { normalizeColorToken, getChosenColorFromSource, countControlledPermanentsBySubtype } from "./intervening-if-mana-spent.js";
import {
  permanentHasKeyword,
  getAuraCountConservative,
  isPermanentModified,
  getControlledCreatures,
  getAttackingCreatures,
  isEquippedConservative,
  isPermanentWhite,
  isPermanentAttacking,
} from "./intervening-if-permanent-and-player.js";
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

export function tryEvaluateInterveningIfStatusDungeonClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
  const { ctx, controllerId, clause, sourcePermanent, refs } = args;

  // ===== Counter / modification checks =====
  // "if this creature is modified" / "if it is modified"
  if (/^if\s+(?:this\s+creature|it|it'?s)\s+is\s+modified$/i.test(clause) || /^if\s+it'?s\s+modified$/i.test(clause)) {
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
    if (!perm) return null;
    return isPermanentModified(ctx, perm);
  }

  const thisPermanentForSelfClauses =
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

  // "if it didn't have decayed" / "if this creature didn't have decayed" (keyword; best-effort)
  if (
    /^if\s+it\s+did\s+not\s+have\s+decayed$/i.test(clause) ||
    /^if\s+it\s+didn'?t\s+have\s+decayed$/i.test(clause) ||
    /^if\s+this\s+creature\s+did\s+not\s+have\s+decayed$/i.test(clause) ||
    /^if\s+this\s+creature\s+didn'?t\s+have\s+decayed$/i.test(clause)
  ) {
    const has = permanentHasKeyword(thisPermanentForSelfClauses, 'decayed');
    return has === null ? null : !has;
  }

  // "if this creature has defender" (keyword)
  if (/^if\s+this\s+creature\s+has\s+defender$/i.test(clause)) {
    return permanentHasKeyword(thisPermanentForSelfClauses, 'defender');
  }

  // "if it/this creature has first strike" (keyword)
  if (/^if\s+(?:it|this\s+creature)\s+has\s+first\s+strike$/i.test(clause)) {
    return permanentHasKeyword(thisPermanentForSelfClauses, 'first strike');
  }

  // "if it/this creature has mutate" (keyword)
  if (/^if\s+(?:it|this\s+creature)\s+has\s+mutate$/i.test(clause)) {
    return permanentHasKeyword(thisPermanentForSelfClauses, 'mutate');
  }

  // "if this creature is enchanted" / "if this creature is equipped" (attachments)
  if (/^if\s+this\s+creature\s+is\s+equipped$/i.test(clause)) {
    return isEquippedConservative(ctx, thisPermanentForSelfClauses);
  }
  if (/^if\s+this\s+creature\s+is\s+enchanted$/i.test(clause)) {
    const info = getAuraCountConservative(ctx, thisPermanentForSelfClauses);
    if (!info) return null;
    if (info.count > 0) return true;
    return info.unknown ? null : false;
  }
  if (/^if\s+this\s+creature\s+is\s+enchanted\s+by\s+two\s+or\s+more\s+auras$/i.test(clause)) {
    const info = getAuraCountConservative(ctx, thisPermanentForSelfClauses);
    if (!info) return null;
    if (info.count >= 2) return true;
    return info.unknown ? null : false;
  }

  // "if this creature is monstrous" (status flag)
  if (/^if\s+this\s+creature\s+is\s+monstrous$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const raw =
      (thisPermanentForSelfClauses as any)?.isMonstrous ??
      (thisPermanentForSelfClauses as any)?.monstrous ??
      (thisPermanentForSelfClauses as any)?.card?.isMonstrous ??
      (thisPermanentForSelfClauses as any)?.card?.monstrous;
    return typeof raw === 'boolean' ? raw : null;
  }

  // "if this creature is renowned" (status flag)
  if (/^if\s+this\s+creature\s+is\s+renowned$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    return (thisPermanentForSelfClauses as any).renowned === true;
  }

  // "if this creature is suspected" (status flag; best-effort)
  if (/^if\s+this\s+creature\s+is\s+suspected$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const raw =
      (thisPermanentForSelfClauses as any)?.suspected ??
      (thisPermanentForSelfClauses as any)?.isSuspected ??
      (thisPermanentForSelfClauses as any)?.card?.suspected ??
      (thisPermanentForSelfClauses as any)?.card?.isSuspected;
    return typeof raw === 'boolean' ? raw : null;
  }

  // "if it's not suspected" / "if it isn't suspected" (status flag; best-effort)
  if (
    /^if\s+(?:it'?s\s+not|it\s+is\s+not|it\s+isn'?t|this\s+creature\s+is\s+not|this\s+creature\s+isn'?t)\s+suspected$/i.test(
      clause
    )
  ) {
    if (!thisPermanentForSelfClauses) return null;
    const raw =
      (thisPermanentForSelfClauses as any)?.suspected ??
      (thisPermanentForSelfClauses as any)?.isSuspected ??
      (thisPermanentForSelfClauses as any)?.card?.suspected ??
      (thisPermanentForSelfClauses as any)?.card?.isSuspected;
    return typeof raw === 'boolean' ? !raw : null;
  }

  // "if this creature doesn't have a +1/+1 counter on it"
  if (/^if\s+this\s+creature\s+doesn'?t\s+have\s+a\s+\+1\/\+1\s+counter\s+on\s+it$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const n = getCounterCount(thisPermanentForSelfClauses, '+1/+1');
    if (n === null) return null;
    return n <= 0;
  }

  // "if this creature has one or more +1/+1 counters on it"
  if (/^if\s+this\s+creature\s+has\s+one\s+or\s+more\s+\+1\/\+1\s+counters\s+on\s+it$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const n = getCounterCount(thisPermanentForSelfClauses, '+1/+1');
    if (n === null) return null;
    return n >= 1;
  }

  // "if this creature has fewer than three +1/+1 counters on it"
  if (/^if\s+this\s+creature\s+has\s+fewer\s+than\s+three\s+\+1\/\+1\s+counters\s+on\s+it$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const n = getCounterCount(thisPermanentForSelfClauses, '+1/+1');
    if (n === null) return null;
    return n < 3;
  }

  // "if it has a +1/+1 counter on it"
  if (/^if\s+it\s+has\s+(?:a|one\s+or\s+more)\s+\+1\/\+1\s+counter\s+on\s+it$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const n = getCounterCount(thisPermanentForSelfClauses, '+1/+1');
    if (n === null) return null;
    return n >= 1;
  }

  // "if it had counters on it"
  if (/^if\s+it\s+had\s+counters\s+on\s+it$/i.test(clause)) {
    return hasAnyCounters(thisPermanentForSelfClauses);
  }

  // "if it had one or more counters on it"
  if (/^if\s+it\s+had\s+(?:one\s+or\s+more|a)\s+counters\s+on\s+it$/i.test(clause)) {
    return hasAnyCounters(thisPermanentForSelfClauses);
  }

  // "if it had a -1/-1 counter on it"
  if (/^if\s+it\s+had\s+a\s+-1\/-1\s+counter\s+on\s+it$/i.test(clause)) {
    const n = getCounterCount(thisPermanentForSelfClauses, '-1/-1');
    if (n === null) return null;
    return n >= 1;
  }

  // "if it had no -1/-1 counters on it"
  if (/^if\s+it\s+had\s+no\s+-1\/-1\s+counters\s+on\s+it$/i.test(clause)) {
    const n = getCounterCount(thisPermanentForSelfClauses, '-1/-1');
    if (n === null) return null;
    return n <= 0;
  }

  // "if it had one or more -1/-1 counters on it"
  if (/^if\s+it\s+had\s+one\s+or\s+more\s+-1\/-1\s+counters\s+on\s+it$/i.test(clause)) {
    const n = getCounterCount(thisPermanentForSelfClauses, '-1/-1');
    if (n === null) return null;
    return n >= 1;
  }

  // "if it had N or more counters on it" (generic total)
  {
    const m = clause.match(/^if\s+it\s+had\s+([a-z0-9]+)\s+or\s+more\s+counters\s+on\s+it$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const total = sumAllCounters(thisPermanentForSelfClauses);
      if (total === null) return null;
      return total >= n;
    }
  }

  // "if it had a +1/+1 counter on it"
  if (/^if\s+it\s+had\s+a\s+\+1\/\+1\s+counter\s+on\s+it$/i.test(clause)) {
    const n = getCounterCount(thisPermanentForSelfClauses, '+1/+1');
    if (n === null) return null;
    return n >= 1;
  }

  // "if it had N or more +1/+1 counters on it"
  {
    const m = clause.match(/^if\s+it\s+had\s+([a-z0-9]+)\s+or\s+more\s+\+1\/\+1\s+counters\s+on\s+it$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const count = getCounterCount(thisPermanentForSelfClauses, '+1/+1');
      if (count === null) return null;
      return count >= n;
    }
  }

  // "if it has fewer than four +1/+1 counters on it"
  if (/^if\s+it\s+has\s+fewer\s+than\s+four\s+\+1\/\+1\s+counters\s+on\s+it$/i.test(clause)) {
    const n = getCounterCount(thisPermanentForSelfClauses, '+1/+1');
    if (n === null) return null;
    return n < 4;
  }

  // "if it has an egg counter on it"
  if (/^if\s+it\s+has\s+an\s+egg\s+counter\s+on\s+it$/i.test(clause)) {
    const n = getCounterCountCaseInsensitiveFromPerm(thisPermanentForSelfClauses, 'egg');
    if (n === null) return null;
    return n >= 1;
  }

  // "if it had a revival counter on it"
  if (/^if\s+it\s+had\s+a\s+revival\s+counter\s+on\s+it$/i.test(clause)) {
    const n = getCounterCountCaseInsensitiveFromPerm(thisPermanentForSelfClauses, 'revival');
    if (n === null) return null;
    return n >= 1;
  }

  // "if there are N or more ki counters on this creature"
  {
    const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+ki\s+counters\s+on\s+this\s+creature$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const count = getCounterCount(thisPermanentForSelfClauses, 'ki');
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
      const c = getCounterCountCaseInsensitiveFromPerm(thisPermanentForSelfClauses, counterTypeLower);
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
      const c = getCounterCountCaseInsensitiveFromPerm(thisPermanentForSelfClauses, counterTypeLower);
      if (c === null) return null;
      return c <= n;
    }
  }

  // "if it had no time counters on it" (suspend/vanishing)
  if (/^if\s+it\s+had\s+no\s+time\s+counters\s+on\s+it$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const p: any = thisPermanentForSelfClauses as any;
    const direct = parseMaybeNumber(p?.timeCounters ?? p?.card?.timeCounters);
    if (direct !== null) return direct <= 0;
    const count = getCounterCount(p, 'time');
    if (count === null) return null;
    return count <= 0;
  }

  // "if this enchantment has N or more quest counters on it"
  {
    const m = clause.match(/^if\s+this\s+enchantment\s+has\s+([a-z0-9]+)\s+or\s+more\s+quest\s+counters\s+on\s+it$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const count = getCounterCount(thisPermanentForSelfClauses, 'quest');
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
    const m = clause.match(/^if\s+you\s+control\s+(?:a|an)\s+(plains|island|swamp|mountain|forest)$/i);
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
    const p: any = thisPermanentForSelfClauses as any;
    if (!p?.id) return null;
    if (!isPermanentAttacking(p)) return false;
    const attackers = getAttackingCreatures(ctx, controllerId);
    const hasSource = attackers.some((a: any) => String(a?.id || '') === String(p.id));
    if (!hasSource) return false;
    return attackers.length >= 3;
  }

  // "if it's blocking a <color> creature" / "if it is blocking a <type> creature"
  {
    const m = clause.match(/^if\s+(?:it'?s|it\s+is)\s+blocking\s+an?\s+([a-z]+)\s+creature$/i);
    if (m) {
      const p: any = thisPermanentForSelfClauses as any;
      if (!p) return null;
      const word = String(m[1] || '').toLowerCase();
      const blockedIdsRaw = p?.blocking;
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
    if (!thisPermanentForSelfClauses) return null;
    return (thisPermanentForSelfClauses as any).tapped === true;
  }

  if (/^if\s+it\s+is\s+untapped$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    return (thisPermanentForSelfClauses as any).tapped !== true;
  }

  if (/^if\s+this\s+(?:permanent|creature|artifact|enchantment|land|planeswalker|battle)\s+is\s+tapped$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    return (thisPermanentForSelfClauses as any).tapped === true;
  }

  if (/^if\s+this\s+(?:permanent|creature|artifact|enchantment|land|planeswalker|battle)\s+is\s+untapped$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    return (thisPermanentForSelfClauses as any).tapped !== true;
  }

  if (
    /^if\s+it\s+isn'?t\s+tapped$/i.test(clause) ||
    /^if\s+it\s+is\s+not\s+tapped$/i.test(clause)
  ) {
    if (!thisPermanentForSelfClauses) return null;
    return (thisPermanentForSelfClauses as any).tapped !== true;
  }

  if (
    /^if\s+this\s+(?:permanent|creature|artifact|enchantment|land|planeswalker|battle)\s+isn'?t\s+tapped$/i.test(clause) ||
    /^if\s+this\s+(?:permanent|creature|artifact|enchantment|land|planeswalker|battle)\s+is\s+not\s+tapped$/i.test(clause)
  ) {
    if (!thisPermanentForSelfClauses) return null;
    return (thisPermanentForSelfClauses as any).tapped !== true;
  }

  // "if this permanent is an enchantment" (and similar type checks)
  {
    const m = clause.match(/^if\s+this\s+(?:permanent|creature|artifact|enchantment|land|planeswalker|battle)\s+is\s+an?\s+(artifact|creature|enchantment|land|planeswalker|battle)$/i);
    if (m) {
      const want = String(m[1] || '').toLowerCase();
      const tl = String((thisPermanentForSelfClauses as any)?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      return tl.includes(want);
    }
  }

  // "if tribute was(n't) paid" (recognized; best-effort when the state tracks it)
  if (/^if\s+tribute\s+was\s+paid$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const p: any = thisPermanentForSelfClauses as any;
    const v = p?.tributePaid ?? p?.tributeWasPaid ?? p?.card?.tributePaid ?? p?.card?.tributeWasPaid;
    if (typeof v === 'boolean') return v;
    return null;
  }

  if (/^if\s+tribute\s+wasn'?t\s+paid$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const p: any = thisPermanentForSelfClauses as any;
    const v = p?.tributePaid ?? p?.tributeWasPaid ?? p?.card?.tributePaid ?? p?.card?.tributeWasPaid;
    if (typeof v === 'boolean') return !v;
    return null;
  }

  if (/^if\s+it\s+is\s+a\s+token$/i.test(clause) || /^if\s+it'?s\s+a\s+token$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    return (thisPermanentForSelfClauses as any).isToken === true;
  }

  if (
    /^if\s+it\s+isn'?t\s+a\s+token$/i.test(clause) ||
    /^if\s+it\s+is\s+not\s+a\s+token$/i.test(clause) ||
    /^if\s+it'?s\s+not\s+a\s+token$/i.test(clause)
  ) {
    if (!thisPermanentForSelfClauses) return null;
    return (thisPermanentForSelfClauses as any).isToken !== true;
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
      const nameRaw = normalizeText(m[2]).replace(/[.]+$/, '').replace(/^"|"$/g, '').trim();
      const expected = nameRaw.toLowerCase();
      const p: any = thisPermanentForSelfClauses as any;
      if (!p) return null;
      const actual = String(p?.card?.name || p?.name || '').toLowerCase();
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
      const chosen = getChosenColorFromSource(thisPermanentForSelfClauses);
      if (!chosen) return null;
      const expected = normalizeColorToken(m[1]);
      if (!expected) return null;
      return chosen === expected;
    }
  }
  {
    const m = clause.match(/^if\s+the\s+chosen\s+color\s+is\s+(white|blue|black|red|green)$/i);
    if (m) {
      const chosen = getChosenColorFromSource(thisPermanentForSelfClauses);
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
      const a = stateAny?.completedDungeonThisTurn;
      const b = stateAny?.dungeonCompletedThisTurn;
      const thisTurn = a?.[controllerId] ?? b?.[controllerId];
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

  return undefined;
}
