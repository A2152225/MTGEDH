/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: evaluateInterveningIfClauseInternal remaining targeted handlers (keyword/ability-word
 * share through name/tribe shorthand). Fallback/unmatched stay in the parent.
 * Public: tryEvaluateInterveningIfKeywordShareShorthandClauses
 */

import { parseCountToken, getLandsEnteredBattlefieldThisTurn } from "./intervening-if-this-turn-counts.js";
import {
  findBattlefieldPermanentsByName,
  findBattlefieldPermanent,
  nameMatchesClauseName,
  getGraveyard,
  getCommandZoneInfo,
  getCounterCountCaseInsensitiveFromPerm,
  hasAnyCountersOnPermanent,
} from "./intervening-if-zone-lookups.js";
import {
  getOpponentInfo,
  getPermanentPowerMaybe,
  getPermanentToughnessMaybe,
  getAllPlayerIds,
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

export function tryEvaluateInterveningIfKeywordShareShorthandClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
  const { ctx, controllerId, clause, sourcePermanent, refs } = args;

  // "if it doesn't share a keyword or ability word with a permanent you control or a card in your graveyard" (best-effort)
  if (/^if\s+it\s+doesn'?t\s+share\s+a\s+keyword\s+or\s+ability\s+word\s+with\s+a\s+permanent\s+you\s+control\s+or\s+a\s+card\s+in\s+your\s+graveyard$/i.test(clause)) {
    const v = (refs as any)?.itSharesKeywordOrAbilityWordWithYourPermanentOrGraveyardCard;

    // Deterministic when a higher-level engine check recorded the outcome.
    if (typeof v === 'boolean') return !v;

    // Best-effort negative evidence: if we can prove that "it" shares a keyword with something you control
    // (or in your graveyard), then this clause is definitely false.
    const itId = String(
      (refs as any)?.itPermanentId ?? (refs as any)?.itCreatureId ?? (refs as any)?.thatCreatureId ?? (refs as any)?.thatPermanentId ?? ''
    ).trim();
    let itPerm: any | null = itId ? findBattlefieldPermanent(ctx, itId) : null;
    if (!itPerm) {
      const candidates: any[] = [];
      const r: any = refs as any;
      if (r?.itPermanent) candidates.push(r.itPermanent);
      if (r?.itCreature) candidates.push(r.itCreature);
      if (r?.it) candidates.push(r.it);
      if (r?.thatPermanent) candidates.push(r.thatPermanent);
      if (r?.thatCreature) candidates.push(r.thatCreature);
      if (candidates.length) itPerm = candidates[0];
    }

    // As a last resort, assume "it" refers to the source permanent (common for these templates).
    if (!itPerm && sourcePermanent) itPerm = sourcePermanent;

    const itCard = itPerm ? ((itPerm as any)?.card ?? itPerm) : null;
    const rawKeywords =
      (refs as any)?.itKeywords ??
      (itCard as any)?.keywords ??
      (refs as any)?.stackItem?.card?.keywords;
    const itKeywords: string[] = Array.isArray(rawKeywords)
      ? (rawKeywords as any[]).map((k: any) => String(k || '').toLowerCase().trim()).filter(Boolean)
      : [];
    if (!itKeywords.length) return null;
    const itSet = new Set(itKeywords);

    const hasShared = (raw: any): boolean => {
      if (!Array.isArray(raw)) return false;
      for (const k of raw) {
        const kk = String(k || '').toLowerCase().trim();
        if (kk && itSet.has(kk)) return true;
      }
      return false;
    };

    const excludeId = String((itPerm as any)?.id ?? '').trim();

    const battlefield = (ctx as any).state?.battlefield;
    if (Array.isArray(battlefield)) {
      for (const p of battlefield) {
        if (!p || String(p.controller || '') !== String(controllerId)) continue;
        if (excludeId && String((p as any)?.id ?? '').trim() === excludeId) continue;
        const kws = (p as any)?.card?.keywords ?? (p as any)?.keywords;
        if (hasShared(kws)) return false;
      }
    }

    const graveyard = getGraveyard(ctx, controllerId);
    if (Array.isArray(graveyard)) {
      for (const c of graveyard) {
        const kws = (c as any)?.keywords;
        if (hasShared(kws)) return false;
      }
    }

    return null;
  }

  // "if it shares a mana value with one or more uncrossed digits in the chosen number" (best-effort)
  if (/^if\s+it\s+shares\s+a\s+mana\s+value\s+with\s+one\s+or\s+more\s+uncrossed\s+digits\s+in\s+the\s+chosen\s+number$/i.test(clause)) {
    const digits: number[] = Array.isArray((refs as any)?.uncrossedDigits)
      ? (refs as any).uncrossedDigits.map((n: any) => (typeof n === 'number' ? n : null)).filter((n: any) => typeof n === 'number')
      : [];
    if (!digits.length) return null;

    const explicitMv = (refs as any)?.itsManaValue;
    let mv: number | null = typeof explicitMv === 'number' ? explicitMv : null;
    if (mv === null) {
      const stack = (ctx as any).state?.stack;
      const stackItemId = String((refs as any)?.triggeringStackItemId ?? '').trim();
      if (Array.isArray(stack) && stackItemId) {
        const item = stack.find((s: any) => String(s?.id ?? '') === stackItemId);
        const mvv = (item as any)?.manaValue ?? (item as any)?.card?.manaValue ?? (item as any)?.card?.cmc;
        if (typeof mvv === 'number') mv = mvv;
      }
    }
    if (mv === null) return null;
    return digits.includes(mv);
  }

  // "if it's represented by food" (best-effort; requires explicit refs)
  if (/^if\s+it'?s\s+represented\s+by\s+food$/i.test(clause)) {
    const v = (refs as any)?.representedByFood;
    return typeof v === 'boolean' ? v : null;
  }

  // "if its power is greater than this creature's power or its toughness is greater than this creature's toughness" (best-effort)
  if (/^if\s+its\s+power\s+is\s+greater\s+than\s+this\s+creature'?s\s+power\s+or\s+its\s+toughness\s+is\s+greater\s+than\s+this\s+creature'?s\s+toughness$/i.test(clause)) {
    const thisId = String(
      (sourcePermanent as any)?.id ??
        (refs as any)?.thisCreatureId ??
        (refs as any)?.thisPermanentId ??
        (refs as any)?.sourcePermanentId ??
        ''
    ).trim();
    const self = sourcePermanent ?? (thisId ? findBattlefieldPermanent(ctx, thisId) : null);
    if (!self) return null;
    const itId = String((refs as any)?.itCreatureId ?? (refs as any)?.thatCreatureId ?? '').trim();
    const it = itId ? findBattlefieldPermanent(ctx, itId) : null;
    if (!it) return null;
    const ip = getPermanentPowerMaybe(it, ctx);
    const itou = getPermanentToughnessMaybe(it, ctx);
    const sp = getPermanentPowerMaybe(self, ctx);
    const st = getPermanentToughnessMaybe(self, ctx);
    if (ip === null || itou === null || sp === null || st === null) return null;
    return ip > sp || itou > st;
  }

  // "if more lands entered the battlefield under your control this turn than an opponent had enter during their last turn" (requires land-ETB tracking)
  if (/^if\s+more\s+lands\s+entered\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn\s+than\s+an\s+opponent\s+had\s+enter\s+during\s+their\s+last\s+turn$/i.test(clause)) {
    const yours = getLandsEnteredBattlefieldThisTurn(ctx, controllerId);
    if (yours === null) return null;
    const last = (ctx as any).state?.landsEnteredBattlefieldLastTurnByPlayerCounts;
    if (!last || typeof last !== 'object') return null;
    const { opponents, unknown } = getOpponentInfo(ctx, controllerId);
    if (unknown) return null;
    if (!opponents.length) return null;
    let sawAny = false;
    for (const oid of opponents) {
      const v = (last as any)[oid];
      if (typeof v !== 'number') continue;
      sawAny = true;
      if (yours > v) return true;
    }
    return sawAny ? false : null;
  }

  // "if no opponent cast a spell since your last turn ended" (requires tracking or explicit refs)
  if (/^if\s+no\s+opponent\s+cast\s+a\s+spell\s+since\s+your\s+last\s+turn\s+ended$/i.test(clause)) {
    const v = (refs as any)?.noOpponentCastSpellSinceYourLastTurnEnded;
    if (typeof v === 'boolean') return v;
    const rawMap = (ctx as any).state?.opponentCastSpellSinceYourLastTurnEnded;
    if (rawMap && typeof rawMap === 'object') {
      // Support both shapes:
      // - legacy: { [opponentId]: boolean }
      // - per-player: { [playerId]: { [opponentId]: boolean } }
      const inner = ((rawMap as any)[controllerId] && typeof (rawMap as any)[controllerId] === 'object')
        ? (rawMap as any)[controllerId]
        : rawMap;
      const { opponents, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponents.length) return null;
      const any = opponents.some((oid) => (inner as any)[oid] === true);
      const anyKnown = opponents.some((oid) => typeof (inner as any)[oid] === 'boolean');
      return anyKnown ? !any : null;
    }
    return null;
  }

  // "if none of them were cast or no mana was spent to cast them" (best-effort; requires explicit refs)
  if (/^if\s+none\s+of\s+them\s+were\s+cast\s+or\s+no\s+mana\s+was\s+spent\s+to\s+cast\s+them$/i.test(clause)) {
    const noneCast = (refs as any)?.noneOfThemWereCast;
    const manaSpent = (refs as any)?.manaWasSpentToCastThem;
    const noneCastBool = typeof noneCast === 'boolean' ? noneCast : null;
    const manaSpentBool = typeof manaSpent === 'boolean' ? manaSpent : null;
    if (noneCastBool === null && manaSpentBool === null) return null;
    return (noneCastBool === true) || (manaSpentBool === false);
  }

  // "if that creature had to attack this combat" (requires explicit refs or tracking)
  if (/^if\s+that\s+creature\s+had\s+to\s+attack\s+this\s+combat$/i.test(clause)) {
    const v = (refs as any)?.thatCreatureHadToAttackThisCombat;
    if (typeof v === 'boolean') return v;
    const thatId = String((refs as any)?.thatCreatureId ?? '').trim();
    if (!thatId) return null;
    const forced = (ctx as any).state?.mustAttackThisCombatByPermanentId;
    if (forced && typeof forced === 'object') {
      const vv = (forced as any)[thatId];
      return typeof vv === 'boolean' ? vv : null;
    }
    return null;
  }

  // "if that creature was destroyed this way" (ensure refs key aliases are handled)
  if (/^if\s+that\s+creature\s+was\s+destroyed\s+this\s+way$/i.test(clause)) {
    const raw = (refs as any)?.thatCreatureDestroyedThisWay ?? (refs as any)?.destroyedThisWay;
    return typeof raw === 'boolean' ? raw : null;
  }

  // "if that player attacked you during their last turn" (requires tracking or explicit refs)
  if (/^if\s+that\s+player\s+attacked\s+you\s+during\s+their\s+last\s+turn$/i.test(clause)) {
    const v = (refs as any)?.thatPlayerAttackedYouLastTurn;
    if (typeof v === 'boolean') return v;
    const thatPlayerId = String((refs as any)?.thatPlayerId ?? (refs as any)?.referencedPlayerId ?? '').trim();
    if (!thatPlayerId) return null;

    // Legacy shape: { [attackerId]: boolean }
    const legacy = (ctx as any).state?.attackedYouLastTurnByPlayer;
    if (legacy && typeof legacy === 'object') {
      const vv = (legacy as any)[thatPlayerId];
      if (typeof vv === 'boolean') return vv;

      // Alternate legacy-ish shape: { [defenderId]: { [attackerId]: boolean } }
      const inner = (legacy as any)[String(controllerId)];
      if (inner && typeof inner === 'object') {
        const v2 = (inner as any)[thatPlayerId];
        if (typeof v2 === 'boolean') return v2;
        if (v2 === true) return true;
        if (v2 === false) return false;
      }
    }

    // Newer tracked shape: { [attackerId]: string[] attackedPlayerIds }
    // Only return false when the tracked list is present and does not include you.
    const listMap = (ctx as any).state?.attackedPlayersLastTurnByPlayer;
    if (listMap && typeof listMap === 'object') {
      const attacked = (listMap as any)[thatPlayerId];
      if (Array.isArray(attacked)) {
        return attacked.map((x: any) => String(x || '').trim()).filter(Boolean).includes(String(controllerId));
      }
    }

    return null;
  }

  // "if that player controls a nonblack" (best-effort; infer from permanent colors when available)
  if (/^if\s+that\s+player\s+controls\s+a\s+nonblack$/i.test(clause)) {
    const thatPlayerId = String((refs as any)?.thatPlayerId ?? (refs as any)?.referencedPlayerId ?? '').trim();
    if (!thatPlayerId) return null;
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    let sawAny = false;
    let sawUnknown = false;
    for (const p of battlefield) {
      if (!p || String(p.controller || '') !== String(thatPlayerId)) continue;
      const colors = (p as any)?.card?.colors ?? (p as any)?.card?.color_identity;
      if (!Array.isArray(colors)) {
        sawUnknown = true;
        continue;
      }
      sawAny = true;
      const upper = colors.map((c: any) => String(c || '').toUpperCase());
      if (!upper.includes('B')) return true;
    }
    if (!sawAny) return false;
    return sawUnknown ? null : false;
  }

  // "if that player didn't tap any nonland permanents that turn" (tracking/refs; positive-only)
  if (/^if\s+that\s+player\s+didn'?t\s+tap\s+any\s+nonland\s+permanents\s+that\s+turn$/i.test(clause)) {
    const v = (refs as any)?.thatPlayerTappedNonlandPermanentLastTurn;
    if (typeof v === 'boolean') return !v;
    const thatPlayerId = String((refs as any)?.thatPlayerId ?? (refs as any)?.referencedPlayerId ?? '').trim();
    if (!thatPlayerId) return null;
    const map = (ctx as any).state?.tappedNonlandPermanentLastTurnByPlayer;
    if (map && typeof map === 'object') {
      const vv = (map as any)[thatPlayerId];
      return typeof vv === 'boolean' ? !vv : null;
    }
    return null;
  }

  // "if that player has another opponent who isn't being attacked" (requires explicit refs or per-combat attacked-defender tracking)
  if (/^if\s+that\s+player\s+has\s+another\s+opponent\s+who\s+isn'?t\s+being\s+attacked$/i.test(clause)) {
    const v = (refs as any)?.thatPlayerHasAnotherOpponentNotBeingAttacked;
    if (typeof v === 'boolean') return v;

    // Conservative fallback using per-combat attacked-defender tracking.
    // Interprets "another opponent" as an opponent other than the controller of this ability.
    const thatPlayerId = String((refs as any)?.thatPlayerId ?? (refs as any)?.referencedPlayerId ?? '').trim();
    if (!thatPlayerId) return null;

    const tracked = (ctx as any).state?.attackedDefendingPlayersThisCombatByPlayer;
    const list = tracked && typeof tracked === 'object' ? (tracked as any)[thatPlayerId] : null;
    if (!Array.isArray(list)) return null; // no declare-attackers context available

    const { opponents, unknown } = getOpponentInfo(ctx, thatPlayerId);
    if (unknown) return null;
    const otherOpponents = opponents.filter((oid) => String(oid) !== String(controllerId));
    if (!otherOpponents.length) return false;

    const attacked = new Set(list.map((x: any) => String(x || '').trim()).filter(Boolean));
    return otherOpponents.some((oid) => !attacked.has(String(oid)))
      ? true
      : false;
  }

  // "if they aren't attacking you" (best-effort; requires explicit refs or attack-target data)
  if (/^if\s+they\s+aren'?t\s+attacking\s+you$/i.test(clause)) {
    const v = (refs as any)?.theyArentAttackingYou;
    if (typeof v === 'boolean') return v;
    const ids: string[] = Array.isArray((refs as any)?.thoseCreatureIds) ? (refs as any).thoseCreatureIds : [];
    if (!ids.length) return null;
    let sawAny = false;
    let sawUnknown = false;
    for (const id of ids) {
      const p = findBattlefieldPermanent(ctx, id);
      if (!p) {
        sawUnknown = true;
        continue;
      }
      sawAny = true;
      const t = (p as any).attackingTargetId ?? (p as any).attackedPlayerId ?? (p as any).defendingPlayerId ?? (typeof (p as any).attacking === 'string' ? (p as any).attacking : null);
      if (typeof t !== 'string' || !t) {
        sawUnknown = true;
        continue;
      }
      if (String(t) === String(controllerId)) return false;
    }
    if (!sawAny) return null;
    return sawUnknown ? null : true;
  }

  // "if they attacked you and/or a planeswalker you control" (best-effort; needs explicit refs)
  if (/^if\s+they\s+attacked\s+you\s+and\/or\s+a\s+planeswalker\s+you\s+control$/i.test(clause)) {
    const v = (refs as any)?.theyAttackedYouOrYourPlaneswalker;

    // Primary path: explicit ref provided by the event.
    if (typeof v === 'boolean') return v;

    // Fallback path: if we have the set of "those creatures" and their declared attack targets,
    // we can sometimes decide this conservatively.
    const ids: string[] = Array.isArray((refs as any)?.thoseCreatureIds) ? (refs as any).thoseCreatureIds : [];
    if (!ids.length) return null;

    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;

    const planeswalkerIds = new Set(
      battlefield
        .filter(
          (p: any) =>
            p &&
            String(p.controller || '') === String(controllerId) &&
            String(p.card?.type_line || '').toLowerCase().includes('planeswalker')
        )
        .map((p: any) => String(p.id))
    );

    let sawAny = false;
    let sawUnknown = false;
    let sawMatch = false;
    let sawNonMatch = false;

    for (const id of ids) {
      const p = findBattlefieldPermanent(ctx, id);
      if (!p) {
        sawUnknown = true;
        continue;
      }
      sawAny = true;

      const t =
        (p as any).attackingTargetId ??
        (p as any).attackedPlayerId ??
        (p as any).defendingPlayerId ??
        (typeof (p as any).attacking === 'string' ? (p as any).attacking : null);

      if (typeof t !== 'string' || !t) {
        sawUnknown = true;
        continue;
      }

      const isMatch = String(t) === String(controllerId) || planeswalkerIds.has(String(t));
      if (isMatch) sawMatch = true;
      else sawNonMatch = true;
    }

    if (!sawAny) return null;
    if (sawUnknown) return null;

    // If all observed attackers match, the clause is true under either interpretation (any vs all).
    if (sawMatch && !sawNonMatch) return true;

    // If none match, the clause is false under either interpretation.
    if (!sawMatch && sawNonMatch) return false;

    // Mixed targets (some match, some not) is ambiguous without explicit refs.
    return null;
  }

  // "if they were attacked this turn by an Assassin you controlled" (best-effort; tracking/refs)
  if (/^if\s+they\s+were\s+attacked\s+this\s+turn\s+by\s+an\s+assassin\s+you\s+controlled$/i.test(clause)) {
    const v = (refs as any)?.theyWereAttackedThisTurnByAssassinYouControlled;
    if (typeof v === 'boolean') return v;
    const thatPlayerId = String((refs as any)?.thatPlayerId ?? (refs as any)?.referencedPlayerId ?? '').trim();
    if (!thatPlayerId) return null;
    const map = (ctx as any).state?.attackedByAssassinThisTurnByPlayer;
    if (map && typeof map === 'object') {
      // Support both shapes:
      // - legacy: { [defendingPlayerId]: boolean }
      // - per-controller: { [attackerControllerId]: { [defendingPlayerId]: true } }
      const inner = ((map as any)[controllerId] && typeof (map as any)[controllerId] === 'object')
        ? (map as any)[controllerId]
        : map;
      const vv = (inner as any)[thatPlayerId];
      if (typeof vv === 'boolean') return vv;
      return vv === true ? true : false;
    }
    return null;
  }

  // "if you had another creature enter the battlefield under your control last turn"
  if (/^if\s+you\s+had\s+another\s+creature\s+enter\s+the\s+battlefield\s+under\s+your\s+control\s+last\s+turn$/i.test(clause)) {
    const v = (ctx as any).state?.creaturesEnteredBattlefieldLastTurnByController;
    if (!v || typeof v !== 'object') return null;
    const n = (v as any)[controllerId];
    if (typeof n !== 'number') return null;

    // If the source isn't a creature, then any creature that entered last turn is "another creature".
    const sourceTypeLine = String((sourcePermanent as any)?.card?.type_line ?? '').toLowerCase();
    const sourceIsCreature = sourceTypeLine.includes('creature');
    if (sourceTypeLine && !sourceIsCreature) return n >= 1;

    // Creature source: "another" excludes the source creature if it entered last turn.
    if (n >= 2) return true;
    if (n <= 0) return false;

    // n === 1: ambiguous unless the trigger provided whether the source entered last turn.
    const enteredLastTurn =
      (refs as any)?.sourceEnteredBattlefieldLastTurn ??
      (refs as any)?.thisCreatureEnteredBattlefieldLastTurn ??
      (refs as any)?.thisPermanentEnteredBattlefieldLastTurn;
    if (typeof enteredLastTurn === 'boolean') return enteredLastTurn ? false : true;
    return null;
  }

  // "if necessary" / "if you have 1" / "if you have a drink 'stache" / "if one player has won more Magic games that day..." / "if your life total is on the lazy caterer's sequence"
  if (/^if\s+necessary$/i.test(clause)) {
    const v = (refs as any)?.necessary;
    return typeof v === 'boolean' ? v : null;
  }
  if (/^if\s+you\s+have\s+1$/i.test(clause)) {
    const v = (refs as any)?.youHaveOne;
    return typeof v === 'boolean' ? v : null;
  }
  if (/^if\s+you\s+have\s+a\s+drink\s+'stache$/i.test(clause)) {
    const v = (refs as any)?.haveDrinkStache;
    return typeof v === 'boolean' ? v : null;
  }
  if (/^if\s+one\s+player\s+has\s+won\s+more\s+magic\s+games\s+that\s+day\s+than\s+any\s+other\s+player$/i.test(clause)) {
    const v = (refs as any)?.onePlayerHasWonMoreMagicGamesThatDay;
    return typeof v === 'boolean' ? v : null;
  }
  if (/^if\s+your\s+life\s+total\s+is\s+on\s+the\s+lazy\s+caterer'?s\s+sequence$/i.test(clause)) {
    const v = (refs as any)?.lifeTotalIsOnLazyCaterersSequence;
    return typeof v === 'boolean' ? v : null;
  }

  // "if she was a nonland creature" (best-effort; requires explicit refs)
  if (/^if\s+she\s+was\s+a\s+nonland\s+creature$/i.test(clause)) {
    const v = (refs as any)?.sheWasANonlandCreature;
    if (typeof v === 'boolean') return v;
    const id = String((refs as any)?.shePermanentId ?? '').trim();
    if (!id) return null;
    const p = findBattlefieldPermanent(ctx, id);
    if (!p) return null;
    const tl = String(p?.card?.type_line || '').toLowerCase();
    if (!tl) return null;
    return tl.includes('creature') && !tl.includes('land');
  }

  // "if the number of attacking creatures is greater than the number of quest counters on ED-E"
  if (/^if\s+the\s+number\s+of\s+attacking\s+creatures\s+is\s+greater\s+than\s+the\s+number\s+of\s+quest\s+counters\s+on\s+ed-e$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    const ede = findBattlefieldPermanentsByName(ctx, 'ed-e');
    if (!ede.length) return null;
    const qc = getCounterCountCaseInsensitiveFromPerm(ede[0], 'quest');
    if (qc === null) return null;

    // Prefer the per-combat snapshot built from the declareAttackers event (replay-stable).
    // ED-E trigger: "Whenever you attack, if ..." so we only care about this controller's attackers.
    const tracked = (ctx as any).state?.attackersDeclaredThisCombatByPlayer;
    const list = tracked && typeof tracked === 'object' ? (tracked as any)[controllerId] : null;
    if (Array.isArray(list)) {
      const ids = new Set<string>();
      for (const entry of list) {
        const id =
          typeof entry === 'string'
            ? String(entry || '').trim()
            : String((entry as any)?.id ?? (entry as any)?.attackerId ?? (entry as any)?.creatureId ?? '').trim();
        if (id) ids.add(id);
      }
      return ids.size > qc;
    }

    let attackers = 0;
    let sawAttackInfo = false;
    for (const p of battlefield) {
      if (!p) continue;
      const tl = String(p?.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) continue;
      const isAttacking =
        (p as any).attacking === true ||
        (p as any).isAttacking === true ||
        typeof (p as any).attacking === 'string' ||
        typeof (p as any).attackingTargetId === 'string' ||
        typeof (p as any).defendingPlayerId === 'string';
      if (!isAttacking) continue;
      sawAttackInfo = true;
      attackers++;
    }
    if (!sawAttackInfo) return null;
    return attackers > qc;
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

  return undefined;
}
