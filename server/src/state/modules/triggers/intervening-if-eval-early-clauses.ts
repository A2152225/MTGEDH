/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: early evaluateInterveningIfClauseInternal clauses (day/night, die rolls, turn-history,
 * control/it-was-a-creature) through "if it was a creature"
 * Public: tryEvaluateInterveningIfEarlyClauses
 */

import {
  parseCountToken,
  getLifeLostThisTurn,
  getLifeGainedThisTurn,
  getCardsDrawnThisTurn,
  countByPermanentType,
  getNonlandPermanentsEnteredBattlefieldThisTurn,
} from "./intervening-if-this-turn-counts.js";
import { parseMaybeNumber, findBattlefieldPermanent, getCounterCountCaseInsensitiveFromPerm, isPrimeNumber } from "./intervening-if-zone-lookups.js";
import { countControlledEnteredThisTurn } from "./intervening-if-entered-this-turn.js";
import { getDieRollResultsThisTurn, didCastDuringOwnMainPhase } from "./intervening-if-mana-spent.js";
import {
  getControlledCreatures,
  permanentHasKeyword,
  didSourceDealDamageToOpponentThisTurn,
  didSourceDealDamageToAnyPlayerThisTurn,
  isPermanentEquipped,
  isPermanentEnchanted,
  isPermanentRed,
  getOpponentInfo,
  getTeamMemberIds,
} from "./intervening-if-permanent-and-player.js";
import {
  getDayNightStatusForInterveningIf,
  getDefendingPlayerIdForInterveningIf,
} from "./intervening-if-eval-support.js";
import type { InterveningIfPhaseArgs, InterveningIfInternalResult } from "./intervening-if-eval-support.js";

export function tryEvaluateInterveningIfEarlyClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
  const { ctx, controllerId, clause, sourcePermanent, refs } = args;
  const evaluateInterveningIfClauseInternal = args.evaluateRest;
  if (clause.includes('if you control a creature with a +1/+1 counter on it that attacked this turn')) {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;

    const hasAnyCountersObject = battlefield.some((perm: any) => perm && (perm as any).counters && typeof (perm as any).counters === 'object');
    if (!hasAnyCountersObject) return null;

    for (const perm of battlefield) {
      if (!perm) continue;
      if (String((perm as any).controller ?? '') !== String(controllerId)) continue;

      const typeLine = String((perm as any)?.card?.type_line ?? '').toLowerCase();
      if (!typeLine.includes('creature')) continue;

      const plusOneCounters = getCounterCountCaseInsensitiveFromPerm(perm, '+1/+1');
      if (!(typeof plusOneCounters === 'number' && plusOneCounters > 0)) continue;

      const attacked =
        (perm as any)?.attackedThisTurn === true ||
        (typeof (perm as any)?.attacking === 'string' && String((perm as any).attacking).trim() !== '') ||
        (perm as any)?.isAttacking === true;
      if (attacked) return true;
    }

    return false;
  }

  // ===== Day / Night (when state provides it) =====
  // Most of the pre-day/night werewolf templates are handled via spells-cast-last-turn checks.
  // For explicit day/night templates, this is best-effort because not all game states track it yet.
  if (/^if\s+(?:it'?s|it\s+is)\s+day$/i.test(clause)) {
    const status = getDayNightStatusForInterveningIf(ctx);
    if (status === 'day') return true;
    if (status === 'night' || status === 'neither') return false;
    return null;
  }

  if (/^if\s+(?:it'?s|it\s+is)\s+night$/i.test(clause)) {
    const status = getDayNightStatusForInterveningIf(ctx);
    if (status === 'night') return true;
    if (status === 'day' || status === 'neither') return false;
    return null;
  }

  // "If it's neither day nor night" (common on cards that start the designation).
  if (/^if\s+(?:it'?s|it\s+is)\s+neither\s+day\s+nor\s+night$/i.test(clause)) {
    const status = getDayNightStatusForInterveningIf(ctx);
    if (status === 'neither') return true;
    if (status === 'day' || status === 'night') return false;
    return null;
  }

  // "If it's neither day nor night and ..."
  {
    const m = clause.match(/^if\s+(it'?s|it\s+is)\s+neither\s+day\s+nor\s+night\s+and\s+(.+)$/i);
    if (m) {
      const rest = String(m[2] || '').trim();
      const status = getDayNightStatusForInterveningIf(ctx);
      if (status === null) return null;
      if (status !== 'neither') return false;
      return evaluateInterveningIfClauseInternal(ctx, controllerId, `if ${rest}`, sourcePermanent);
    }
  }

  // "If it's day and ..." / "If it's night and ..." (common for daybound/nightbound templates)
  {
    const m = clause.match(/^if\s+(it'?s|it\s+is)\s+(day|night)\s+and\s+(.+)$/i);
    if (m) {
      const which = String(m[2] || '').toLowerCase();
      const rest = String(m[3] || '').trim();
      const status = getDayNightStatusForInterveningIf(ctx);
      if (status === null) return null;
      if (which === 'day') {
        if (status !== 'day') return false;
      } else {
        if (status !== 'night') return false;
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
    const m = clause.match(/^if\s+you\s+roll(?:ed)?\s+a\s+([a-z0-9]+)(?:\s+this\s+turn)?$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const rolls = getDieRollResultsThisTurn(ctx, controllerId);
      if (rolls.length === 0) return null;
      return rolls.some((r) => r.result === n);
    }
  }
  {
    const m = clause.match(/^if\s+you\s+roll(?:ed)?\s+([a-z0-9]+)\s+or\s+higher\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const rolls = getDieRollResultsThisTurn(ctx, controllerId);
      if (rolls.length === 0) return null;
      return rolls.some((r) => r.result >= n);
    }
  }
  {
    const m = clause.match(/^if\s+you\s+roll(?:ed)?\s+([a-z0-9]+)\s+or\s+less\s+this\s+turn$/i);
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

  // "...if your team gained life this turn..." (team formats)
  if (/^if\s+your\s+team\s+gained\s+life\s+this\s+turn$/i.test(clause)) {
    const teamIds = getTeamMemberIds(ctx, controllerId);
    return teamIds.some((pid) => getLifeGainedThisTurn(ctx, String(pid)) > 0);
  }

  // "...if you lost life this turn..."
  if (/^if\s+you(?:'ve|\s+have)?\s+lost\s+life\s+this\s+turn$/i.test(clause)) {
    return getLifeLostThisTurn(ctx, controllerId) > 0;
  }

  // "...if you didn't lose life this turn..." (Luminarch Ascension)
  if (/^if\s+you\s+(?:did\s+not|didn't)\s+lose\s+life\s+this\s+turn$/i.test(clause)) {
    return getLifeLostThisTurn(ctx, controllerId) === 0;
  }

  // "...if you lost N or more life this turn..."
  {
    const m = clause.match(/^if\s+you\s+lost\s+([a-z0-9]+)\s+or\s+more\s+life\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getLifeLostThisTurn(ctx, controllerId) >= n;
    }
  }

  // "...if you've drawn more than one card this turn..." (Proft's Eidetic Memory)
  if (
    /^if\s+you'?ve\s+drawn\s+more\s+than\s+one\s+card\s+this\s+turn\.?$/i.test(clause) ||
    /^if\s+you\s+have\s+drawn\s+more\s+than\s+one\s+card\s+this\s+turn\.?$/i.test(clause) ||
    /^if\s+you'?ve\s+drawn\s+more\s+than\s+one\s+cards\s+this\s+turn\.?$/i.test(clause) ||
    /^if\s+you\s+have\s+drawn\s+more\s+than\s+one\s+cards\s+this\s+turn\.?$/i.test(clause)
  ) {
    return getCardsDrawnThisTurn(ctx, controllerId) >= 2;
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
    const { opponents: opps, unknown } = getOpponentInfo(ctx, controllerId);
    if (unknown) return null;
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
    const map = (ctx as any).state?.landsEnteredBattlefieldThisTurn;
    if (!map || typeof map !== 'object') return null;
    const n = (map as any)[String(controllerId)];
    if (typeof n !== 'number') return null;
    return n > 0;
  }

  // "if you had a land enter the battlefield under your control this turn" (Wandering Troubadour)
  if (/^if\s+you\s+had\s+a\s+land\s+enter\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {
    const map = (ctx as any).state?.landsEnteredBattlefieldThisTurn;
    if (!map || typeof map !== 'object') return null;
    const n = (map as any)[String(controllerId)];
    if (typeof n !== 'number') return null;
    return n > 0;
  }

  // "if a land entered the battlefield under your control this turn and you control a prime number of lands"
  if (/^if\s+a\s+land\s+entered\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn\s+and\s+you\s+control\s+a\s+prime\s+number\s+of\s+lands$/i.test(clause)) {
    const map = (ctx as any).state?.landsEnteredBattlefieldThisTurn;
    if (!map || typeof map !== 'object') return null;
    const n = (map as any)[String(controllerId)];
    if (typeof n !== 'number') return null;
    if (n <= 0) return false;
    return isPrimeNumber(countByPermanentType(ctx, controllerId, 'land'));
  }

  // "if N or more nonland permanents entered the battlefield under your control this turn"
  {
    const m = clause.match(
      /^if\s+([a-z0-9]+)\s+or\s+more\s+nonland\s+permanents\s+entered\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn$/i
    );
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const v = getNonlandPermanentsEnteredBattlefieldThisTurn(ctx, controllerId);
      return v >= n;
    }
  }

  // "if N or more <type> entered (the battlefield) under your control this turn"
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
      if (
        typeLower === 'land' ||
        typeLower === 'creature' ||
        typeLower === 'artifact' ||
        typeLower === 'enchantment' ||
        typeLower === 'planeswalker' ||
        typeLower === 'battle'
      ) {
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
    const p: any =
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
    if (!p?.id) return null;
    return didSourceDealDamageToOpponentThisTurn(ctx, controllerId, String(p.id));
  }

  // "if it dealt combat damage to a player this turn" (Wave of Rats)
  if (/^if\s+it\s+dealt\s+combat\s+damage\s+to\s+a\s+player\s+this\s+turn$/i.test(clause)) {
    const p: any =
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
    if (!p?.id) return null;

    const tracker = (ctx as any).state?.creaturesThatDealtDamageToPlayer;
    if (!tracker || typeof tracker !== 'object' || Object.keys(tracker).length === 0) return null;
    return didSourceDealDamageToAnyPlayerThisTurn(ctx, String(p.id));
  }

  // "if a player was dealt N or more combat damage this turn"
  {
    const m = clause.match(/^if\s+a\s+player\s+was\s+dealt\s+([a-z0-9]+)\s+or\s+more\s+combat\s+damage\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const tracker = (ctx as any).state?.creaturesThatDealtDamageToPlayer;
      if (!tracker || typeof tracker !== 'object' || Object.keys(tracker).length === 0) return null;

      for (const perDamagedPlayer of Object.values(tracker as any)) {
        if (!perDamagedPlayer || typeof perDamagedPlayer !== 'object') continue;
        const total = (Object.values(perDamagedPlayer as any) as any[]).reduce((sum: number, entry: any) => {
          const v = parseMaybeNumber(entry?.totalDamage);
          return sum + (v ?? 0);
        }, 0);
        if (total >= n) return true;
      }

      return false;
    }
  }

  // "if a player was dealt combat damage by a Zombie this turn"
  // Generic subtype / supertype form used by cards like Lost Monarch of Ifnir.
  {
    const m = clause.match(/^if\s+a\s+player\s+was\s+dealt\s+combat\s+damage\s+by\s+a(?:n)?\s+(.+?)\s+this\s+turn$/i);
    if (m) {
      const combatDamageDescriptor = String(m[1] || '').trim().toLowerCase();
      if (!combatDamageDescriptor) return null;

      const tracker = (ctx as any).state?.creaturesThatDealtDamageToPlayer;
      if (!tracker || typeof tracker !== 'object' || Object.keys(tracker).length === 0) return null;

      const anyDamageTracked = Object.values(tracker as any).some(
        (entry: any) => entry && typeof entry === 'object' && Object.keys(entry).length > 0
      );
      if (!anyDamageTracked) return false;

      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;

      let sawUnknown = false;

      for (const perDamagedPlayer of Object.values(tracker as any)) {
        if (!perDamagedPlayer || typeof perDamagedPlayer !== 'object') continue;
        for (const creatureId of Object.keys(perDamagedPlayer as any)) {
          const perm = battlefield.find((p: any) => p && String(p.id || '') === String(creatureId));
          if (!perm) {
            sawUnknown = true;
            continue;
          }

          const typeLine = String(perm.card?.type_line || '').toLowerCase();
          const isLegendaryCreature = typeLine.includes('legendary') && typeLine.includes('creature');
          if (combatDamageDescriptor === 'legendary creature') {
            if (isLegendaryCreature) return true;
            continue;
          }

          if (typeLine.includes(combatDamageDescriptor)) return true;
        }
      }

      return sawUnknown ? null : false;
    }
  }

  // "if a player was dealt combat damage by a Zombie this turn" (legacy exact alias)
  if (/^if\s+a\s+player\s+was\s+dealt\s+combat\s+damage\s+by\s+a\s+zombie\s+this\s+turn$/i.test(clause)) {
    const tracker = (ctx as any).state?.creaturesThatDealtDamageToPlayer;
    if (!tracker || typeof tracker !== 'object' || Object.keys(tracker).length === 0) return null;

    const anyDamageTracked = Object.values(tracker as any).some(
      (entry: any) => entry && typeof entry === 'object' && Object.keys(entry).length > 0
    );
    if (!anyDamageTracked) return false;

    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;

    let sawUnknown = false;

    for (const perDamagedPlayer of Object.values(tracker as any)) {
      if (!perDamagedPlayer || typeof perDamagedPlayer !== 'object') continue;
      for (const creatureId of Object.keys(perDamagedPlayer as any)) {
        const perm = battlefield.find((p: any) => p && String(p.id || '') === String(creatureId));
        if (!perm) {
          sawUnknown = true;
          continue;
        }
        const tl = String(perm.card?.type_line || '').toLowerCase();
        if (tl.includes('zombie')) return true;
      }
    }

    return sawUnknown ? null : false;
  }

  // "if N or more damage was dealt to it this turn"
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+damage\s+was\s+dealt\s+to\s+it\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const p: any =
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
      if (!p) return null;

      const dmg =
        parseMaybeNumber(p?.damageThisTurn) ??
        parseMaybeNumber(p?.combatDamageThisTurn) ??
        parseMaybeNumber(p?.card?.damageThisTurn) ??
        parseMaybeNumber(p?.card?.combatDamageThisTurn);

      if (dmg === null) {
        const took = p?.tookDamageThisTurn ?? p?.card?.tookDamageThisTurn;
        if (took === true) return n <= 1 ? true : null;
        return false;
      }

      return dmg >= n;
    }
  }

  // "if any of those creatures have power or toughness equal to the chosen number"
  if (/^if\s+any\s+of\s+those\s+creatures\s+have\s+power\s+or\s+toughness\s+equal\s+to\s+the\s+chosen\s+number$/i.test(clause)) {
    const thoseCreatureIds = refs?.thoseCreatureIds;
    if (!Array.isArray(thoseCreatureIds) || thoseCreatureIds.length === 0) return null;
    const p: any =
      sourcePermanent ??
      (() => {
        const id = String(
          (refs as any)?.thisPermanentId ??
            (refs as any)?.thisId ??
            (refs as any)?.sourcePermanentId ??
            ''
        ).trim();
        if (!id) return null;
        return findBattlefieldPermanent(ctx, id);
      })();
    if (!p) return null;

    const chosenRaw =
      p?.chosenNumber ??
      p?.chosen_number ??
      p?.card?.chosenNumber ??
      p?.card?.chosen_number;
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

  // "if this creature was dealt damage this turn"
  if (/^if\s+this\s+creature\s+was\s+dealt\s+damage\s+this\s+turn$/i.test(clause)) {
    const p: any =
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
    if (!p) return null;
    const dmg =
      parseMaybeNumber(p?.damageThisTurn) ??
      parseMaybeNumber(p?.combatDamageThisTurn) ??
      parseMaybeNumber(p?.card?.damageThisTurn) ??
      parseMaybeNumber(p?.card?.combatDamageThisTurn);
    if (dmg === null) {
      const took = p?.tookDamageThisTurn ?? p?.card?.tookDamageThisTurn;
      if (took === true) return true;
      return false;
    }
    return dmg > 0;
  }

  // Common creature/aura/equipment templates should be checked early (generic "control a/an X" won't match these).
  if (/^if\s+you\s+control\s+an\s+enchanted\s+creature$/i.test(clause)) {
    return getControlledCreatures(ctx, controllerId).some((c: any) => isPermanentEnchanted(ctx, c));
  }

  if (/^if\s+you\s+control\s+an\s+equipped\s+creature$/i.test(clause)) {
    return getControlledCreatures(ctx, controllerId).some((c: any) => isPermanentEquipped(ctx, c));
  }

  // Aura context: "enchanted creature ..." / "enchanted permanent ..."
  // This refers to the permanent enchanted by the *source* Aura.
  {
    const wantsEnchantedCreatureUntapped = /^if\s+enchanted\s+creature\s+is\s+untapped$/i.test(clause);
    const wantsEnchantedPermanentTapped = /^if\s+enchanted\s+permanent\s+is\s+tapped$/i.test(clause);
    const wantsEnchantedCreatureRed = /^if\s+enchanted\s+creature\s+is\s+red$/i.test(clause);
    const wantsEnchantedCreatureHasFlying = /^if\s+enchanted\s+creature\s+has\s+flying$/i.test(clause);
    const wantsEnchantedCreatureHasToxic = /^if\s+enchanted\s+creature\s+has\s+toxic$/i.test(clause);

    if (
      wantsEnchantedCreatureUntapped ||
      wantsEnchantedPermanentTapped ||
      wantsEnchantedCreatureRed ||
      wantsEnchantedCreatureHasFlying ||
      wantsEnchantedCreatureHasToxic
    ) {
      const aura =
        sourcePermanent ??
        (() => {
          const id = String((refs as any)?.sourcePermanentId ?? (refs as any)?.thisId ?? '').trim();
          if (!id) return null;
          return findBattlefieldPermanent(ctx, id);
        })();
      if (!aura) return null;

      const attachedTo = (aura as any)?.attachedTo ?? (aura as any)?.attachedToId;
      if (!attachedTo) return null;
      const enchanted = findBattlefieldPermanent(ctx, String(attachedTo));
      if (!enchanted) return null;

      if (wantsEnchantedPermanentTapped) {
        const tapped = (enchanted as any).tapped;
        return typeof tapped === 'boolean' ? tapped : null;
      }
      if (wantsEnchantedCreatureUntapped) {
        const tapped = (enchanted as any).tapped;
        return typeof tapped === 'boolean' ? !tapped : null;
      }
      if (wantsEnchantedCreatureRed) return isPermanentRed(enchanted);
      if (wantsEnchantedCreatureHasFlying) return permanentHasKeyword(enchanted, 'flying');
      if (wantsEnchantedCreatureHasToxic) return permanentHasKeyword(enchanted, 'toxic');
    }
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

  if (/^if\s+you\s+or\s+a\s+player\s+you'?re\s+attacking\s+has\s+the\s+initiative$/i.test(clause)) {
    const initiative = (ctx as any).state?.initiative;
    if (!initiative) return null;
    if (String(initiative) === String(controllerId)) return true;
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(sourcePermanent, refs);
    if (!defendingPlayerId) return null;
    return String(initiative) === String(defendingPlayerId);
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
    const p: any =
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
    if (!p) return null;
    return p.renowned !== true;
  }

  // "if it is renowned"
  if (/^if\s+(?:it\s+is|it'?s)\s+renowned$/i.test(clause)) {
    const p: any =
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
    if (!p) return null;
    return p.renowned === true;
  }

  // "if it was historic" (artifact, legendary, or Saga)
  if (/^if\s+it\s+was\s+historic$/i.test(clause)) {
    const p: any =
      sourcePermanent ??
      (() => {
        const id = String(
          (refs as any)?.thisPermanentId ??
            (refs as any)?.thisId ??
            (refs as any)?.sourcePermanentId ??
            (refs as any)?.thisCreatureId ??
            ''
        ).trim();
        if (!id) return null;
        return findBattlefieldPermanent(ctx, id);
      })();
    if (!p) return null;
    const tl = String((p as any)?.card?.type_line ?? (p as any)?.type_line ?? '').toLowerCase();
    if (!tl) return null;
    return tl.includes('artifact') || tl.includes('legendary') || tl.includes('saga');
  }

  // "if it was a creature" / "if it's a creature" (best-effort via type line)
  if (
    /^if\s+it\s+was\s+a\s+creature$/i.test(clause) ||
    /^if\s+it'?s\s+a\s+creature$/i.test(clause) ||
    /^if\s+it\s+is\s+a\s+creature$/i.test(clause)
  ) {
    const p: any =
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
    if (!p) return null;
    const tl = String(p?.card?.type_line || p?.type_line || '').toLowerCase();
    if (!tl) return null;
    return tl.includes("creature");
  }

  return undefined;
}
