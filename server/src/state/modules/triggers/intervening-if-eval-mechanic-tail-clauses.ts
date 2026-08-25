/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: evaluateInterveningIfClauseInternal mechanic-specific tail (mana values in graveyard
 * through commander/werewolf/spell-color templates)
 * Public: tryEvaluateInterveningIfMechanicTailClauses
 */

import { parseCountToken, countByPermanentType, getNoncreatureSpellsCastThisTurnCount, getPoisonCounters, countCreatureCardsInGraveyard } from "./intervening-if-this-turn-counts.js";
import { getHandCount, nameMatchesClauseName, getCounterCountCaseInsensitiveFromPerm, countControlledCreatureSubtype, getGraveyard, findBattlefieldPermanent } from "./intervening-if-zone-lookups.js";
import { getManaValue } from "./intervening-if-mana-spent.js";
import {
  getSpellsCastThisTurn,
  getSpellsCastLastTurnByPlayerCounts,
  getSpellsCastThisTurnByPlayerCount,
  getSpellsCastLastTurnCount,
  isPermanentBlack,
  getOpponentInfo,
  countCardTypesInGraveyard,
  getSpellColorsThisTurnEntry,
  isEnchantingTalePermanent,
  isCreatureDiedThisTurn,
} from "./intervening-if-permanent-and-player.js";
import { getDefendingPlayerIdForInterveningIf } from "./intervening-if-eval-support.js";
import type { InterveningIfPhaseArgs, InterveningIfInternalResult } from "./intervening-if-eval-support.js";

export function tryEvaluateInterveningIfMechanicTailClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
  const { ctx, controllerId, clause, sourcePermanent, refs } = args;
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

  // "if there are five or more mana values among cards in your graveyard" (best-effort)
  if (/^if\s+there\s+are\s+five\s+or\s+more\s+mana\s+values\s+among\s+cards\s+in\s+your\s+graveyard$/i.test(clause)) {
    const gy = getGraveyard(ctx, controllerId);
    if (!Array.isArray(gy)) return null;
    if (gy.length === 0) return false;
    const vals = new Set<number>();
    let sawUnknown = false;
    for (const c of gy) {
      const mv = getManaValue(c);
      if (mv === null) {
        sawUnknown = true;
      } else {
        vals.add(mv);
      }
      if (vals.size >= 5) return true;
    }
    return sawUnknown ? null : false;
  }

  // "if Rasputin started the turn untapped" (best-effort)
  if (/^if\s+rasputin\s+started\s+the\s+turn\s+untapped$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const snapshot = stateAny?.permanentUntappedAtTurnBegin;
    const hasSnapshot = snapshot && typeof snapshot === 'object';

    // Prefer the triggering permanent when available.
    const sourceId = String((sourcePermanent as any)?.id ?? '').trim();
    if (sourceId && hasSnapshot) {
      const v = (snapshot as any)[sourceId];
      if (typeof v === 'boolean') return v;
      // Snapshot exists for the turn but this permanent wasn't on the battlefield at turn begin.
      return false;
    }

    // Legacy/compat: allow a per-permanent boolean to be carried.
    const rawFromSource = (sourcePermanent as any)?.startedTurnUntapped ?? (sourcePermanent as any)?.wasUntappedAtTurnStart;
    if (typeof rawFromSource === 'boolean') return rawFromSource;

    // Fallback: name scan only when unambiguous.
    const battlefield = stateAny?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    const matches = battlefield.filter((p: any) => nameMatchesClauseName(String(p?.card?.name ?? p?.name ?? ''), 'rasputin'));
    if (matches.length !== 1) return null;
    const p = matches[0];

    if (hasSnapshot) {
      const pid = String((p as any)?.id ?? '').trim();
      if (pid) {
        const v = (snapshot as any)[pid];
        if (typeof v === 'boolean') return v;
        return false;
      }
    }

    const raw = (p as any)?.startedTurnUntapped ?? (p as any)?.wasUntappedAtTurnStart;
    return typeof raw === 'boolean' ? raw : null;
  }

  // "if there are one or more oil counters on Glistening Extractor" (best-effort)
  if (/^if\s+there\s+are\s+one\s+or\s+more\s+oil\s+counters\s+on\s+glistening\s+extractor$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    const matches = battlefield.filter((p: any) => nameMatchesClauseName(String(p?.card?.name ?? p?.name ?? ''), 'glistening extractor'));
    if (matches.length !== 1) return null;

    // Only become deterministic when counters tracking is present on the battlefield.
    // (Some permanents omit the counters object entirely when they have none.)
    const hasAnyCountersObject = battlefield.some((p: any) => p && (p as any).counters && typeof (p as any).counters === 'object');
    if (!hasAnyCountersObject) return null;

    const n = getCounterCountCaseInsensitiveFromPerm(matches[0], 'oil');
    if (typeof n === 'number') return n > 0;
    return false;
  }

  // "if you didn't activate a loyalty ability of a planeswalker this turn" (The Chain Veil)
  if (/^if\s+you\s+didn'?t\s+activate\s+a\s+loyalty\s+ability\s+of\s+a\s+planeswalker\s+this\s+turn\.?$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield || [];
    const planeswalkers = (Array.isArray(battlefield) ? battlefield : []).filter((p: any) => {
      if (!p || p.controller !== controllerId) return false;
      const tl = String(p?.card?.type_line || '').toLowerCase();
      return tl.includes('planeswalker');
    });

    const anyActivated = planeswalkers.some((pw: any) => {
      if (pw?.loyaltyActivatedThisTurn === true) return true;
      return (pw?.loyaltyActivationsThisTurn || 0) > 0;
    });

    return !anyActivated;
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
    if (typeof raw === 'boolean') return raw;
    return null;
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
    if (typeof raw === 'boolean') return raw;
    return null;
  }

  // "if a land you controlled was put into a graveyard from the battlefield this turn" (best-effort via turn-tracking)
  if (/^if\s+a\s+land\s+you\s+controlled\s+was\s+put\s+into\s+a\s+graveyard\s+from\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const map = stateAny?.landYouControlledPutIntoGraveyardFromBattlefieldThisTurn;
    const v = map?.[controllerId];
    if (typeof v === 'boolean') return v;
    const hasTracker = map && typeof map === 'object';
    return hasTracker ? false : null;
  }

  // "if a permanent was put into your hand from the battlefield this turn" (best-effort via turn-tracking)
  if (/^if\s+a\s+permanent\s+was\s+put\s+into\s+your\s+hand\s+from\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const map = stateAny?.permanentPutIntoHandFromBattlefieldThisTurn;
    const v = map?.[controllerId];
    if (typeof v === 'boolean') return v;
    const hasTracker = map && typeof map === 'object';
    return hasTracker ? false : null;
  }

  // "if an enchantment was put into your graveyard from the battlefield this turn" (best-effort via turn-tracking)
  if (/^if\s+an\s+enchantment\s+was\s+put\s+into\s+your\s+graveyard\s+from\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const map = stateAny?.enchantmentPutIntoYourGraveyardFromBattlefieldThisTurn;
    const v = map?.[controllerId];
    if (typeof v === 'boolean') return v;
    const hasTracker = map && typeof map === 'object';
    return hasTracker ? false : null;
  }

  // "if an artifact or creature was put into a graveyard from the battlefield this turn" (best-effort via turn-tracking)
  if (/^if\s+an\s+artifact\s+or\s+creature\s+was\s+put\s+into\s+a\s+graveyard\s+from\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const v = stateAny?.artifactOrCreaturePutIntoGraveyardFromBattlefieldThisTurn;
    return typeof v === 'boolean' ? v : null;
  }

  // "if a creature entered and a creature died this turn"
  if (/^if\s+a\s+creature\s+entered\s+and\s+a\s+creature\s+died\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const enteredMap = stateAny?.creaturesEnteredBattlefieldThisTurnByController;
    if (!enteredMap || typeof enteredMap !== 'object') return null;

    const enteredTotal = (Object.values(enteredMap as any) as any[]).reduce(
      (sum: number, value: any) => sum + (typeof value === 'number' ? value : 0),
      0
    );
    const died = isCreatureDiedThisTurn(ctx);
    if (died === null) return null;
    return enteredTotal > 0 && died;
  }

  // "if you've cast a noncreature spell this turn"
  if (/^if\s+you'?ve\s+cast\s+a\s+noncreature\s+spell\s+this\s+turn$/i.test(clause) || /^if\s+you\s+have\s+cast\s+a\s+noncreature\s+spell\s+this\s+turn$/i.test(clause)) {
    return getNoncreatureSpellsCastThisTurnCount(ctx, controllerId) >= 1;
  }

  // "if you've cast an instant or sorcery spell this turn"
  if (
    /^if\s+you'?ve\s+cast\s+an\s+instant\s+or\s+sorcery\s+spell\s+this\s+turn$/i.test(clause) ||
    /^if\s+you\s+have\s+cast\s+an\s+instant\s+or\s+sorcery\s+spell\s+this\s+turn$/i.test(clause)
  ) {
    const raw = (ctx as any).state?.spellsCastThisTurn;
    if (!Array.isArray(raw)) return null;

    const spells = getSpellsCastThisTurn(ctx).filter((s: any) => String(s?.casterId || s?.controller || '') === controllerId);
    if (spells.length === 0) return false;

    let unknown = false;
    for (const spell of spells) {
      const explicit = (spell as any)?.isInstantOrSorcery;
      if (typeof explicit === 'boolean') {
        if (explicit) return true;
        continue;
      }

      const typeLine = String((spell as any)?.card?.type_line ?? (spell as any)?.type_line ?? '').toLowerCase();
      if (!typeLine) {
        unknown = true;
        continue;
      }
      if (typeLine.includes('instant') || typeLine.includes('sorcery')) return true;
    }

    return unknown ? null : false;
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
    const { opponents, unknown } = getOpponentInfo(ctx, controllerId);
    if (unknown) return null;
    if (!opponents.length) return false;
    for (const oid of opponents) {
      const n = (counts as any)[String(oid)];
      if (typeof n !== 'number') return null;
      if (n >= 2) return true;
    }
    return false;
  }

  // "if you cast two or more spells last turn"
  if (/^if\s+you\s+cast\s+two\s+or\s+more\s+spells\s+last\s+turn$/i.test(clause)) {
    const counts = getSpellsCastLastTurnByPlayerCounts(ctx);
    if (!counts) return null;
    const n = (counts as any)[String(controllerId)];
    if (typeof n !== 'number') return null;
    return n >= 2;
  }

  // "if you cast no spells last turn"
  if (/^if\s+you\s+cast\s+no\s+spells\s+last\s+turn$/i.test(clause)) {
    const counts = getSpellsCastLastTurnByPlayerCounts(ctx);
    if (counts) {
      const n = (counts as any)[String(controllerId)];
      if (typeof n === 'number') return n === 0;
      // Replay-safe: don't assume 0 just because the container exists.
    }

    const last = getSpellsCastLastTurnCount(ctx);
    return last === null ? null : last === 0;
  }

  // "if you lost life last turn"
  if (/^if\s+you\s+lost\s+life\s+last\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const candidates: any[] = [
      stateAny?.lifeLostLastTurnByPlayerCounts,
      stateAny?.lifeLostLastTurnByPlayer,
      stateAny?.lifeLostLastTurn,
    ].filter((x) => x && typeof x === 'object');

    for (const counts of candidates) {
      const raw = (counts as any)[String(controllerId)];
      if (typeof raw === 'boolean') return raw;
      if (typeof raw === 'number') return raw > 0;
    }
    return null;
  }

  // "if you drew a card last turn" (Mine Is the Only Truth)
  if (/^if\s+you\s+drew\s+a\s+card\s+last\s+turn\.?$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const raw =
      stateAny?.cardsDrawnLastTurn?.[controllerId] ??
      stateAny?.cardsDrawnLastTurnByPlayer?.[controllerId] ??
      stateAny?.cardsDrawnLastTurnByPlayerCounts?.[controllerId];
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw > 0;
    return null;
  }

  // "if an opponent lost life last turn"
  if (/^if\s+an\s+opponent\s+lost\s+life\s+last\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const counts =
      stateAny?.lifeLostLastTurnByPlayerCounts ?? stateAny?.lifeLostLastTurnByPlayer ?? stateAny?.lifeLostLastTurn;
    if (!counts || typeof counts !== 'object') return null;

    const { opponents: opps, unknown } = getOpponentInfo(ctx, controllerId);
    if (unknown) return null;
    if (!opps.length) return false;

    let sawUnknown = false;

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
      sawUnknown = true;
    }

    return sawUnknown ? null : false;
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
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(thisPermanentForSelfClauses, refs);
    if (!defendingPlayerId) return null;
    return String(controllerId) === String(defendingPlayerId);
  }

  // "if defending player controls more lands than you"
  if (/^if\s+defending\s+player\s+controls\s+more\s+lands\s+than\s+you$/i.test(clause)) {
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(thisPermanentForSelfClauses, refs);
    if (!defendingPlayerId) return null;
    const defLands = countByPermanentType(ctx, String(defendingPlayerId), 'land');
    const youLands = countByPermanentType(ctx, String(controllerId), 'land');
    return defLands > youLands;
  }

  // "if defending player controls no Walls"
  if (/^if\s+defending\s+player\s+controls\s+no\s+walls$/i.test(clause)) {
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(thisPermanentForSelfClauses, refs);
    if (!defendingPlayerId) return null;
    return countControlledCreatureSubtype(ctx, String(defendingPlayerId), 'wall') === 0;
  }

  // "if defending player has more cards in hand than you"
  if (/^if\s+defending\s+player\s+has\s+more\s+cards\s+in\s+hand\s+than\s+you$/i.test(clause)) {
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(thisPermanentForSelfClauses, refs);
    if (!defendingPlayerId) return null;
    return getHandCount(ctx, String(defendingPlayerId)) > getHandCount(ctx, String(controllerId));
  }

  // "if defending player has N or fewer cards in hand"
  {
    const m = clause.match(/^if\s+defending\s+player\s+has\s+([a-z0-9]+)\s+or\s+fewer\s+cards\s+in\s+hand$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const defendingPlayerId = getDefendingPlayerIdForInterveningIf(thisPermanentForSelfClauses, refs);
      if (!defendingPlayerId) return null;
      return getHandCount(ctx, String(defendingPlayerId)) <= n;
    }
  }

  // "if defending player is poisoned"
  if (/^if\s+defending\s+player\s+is\s+poisoned$/i.test(clause)) {
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(thisPermanentForSelfClauses, refs);
    if (!defendingPlayerId) return null;
    return getPoisonCounters(ctx, String(defendingPlayerId)) > 0;
  }

  // "if defending player controls no Glimmer creatures"
  if (/^if\s+defending\s+player\s+controls\s+no\s+glimmer\s+creatures$/i.test(clause)) {
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(thisPermanentForSelfClauses, refs);
    if (!defendingPlayerId) return null;
    return countControlledCreatureSubtype(ctx, String(defendingPlayerId), 'glimmer') === 0;
  }

  // "if defending player controls no black permanents" (best-effort, conservative)
  if (/^if\s+defending\s+player\s+controls\s+no\s+black\s+permanents$/i.test(clause)) {
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(thisPermanentForSelfClauses, refs);
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
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(thisPermanentForSelfClauses, refs);
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
    const defendingPlayerId = getDefendingPlayerIdForInterveningIf(thisPermanentForSelfClauses, refs);
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

  // "if you put a counter on a creature this turn"
  if (/^if\s+you\s+put\s+a\s+counter\s+on\s+a\s+creature\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const v =
      stateAny?.putCounterOnCreatureThisTurn?.[controllerId] ??
      stateAny?.placedCounterOnCreatureThisTurn?.[controllerId] ??
      stateAny?.countersPlacedOnCreaturesThisTurn?.[controllerId];
    if (typeof v === 'boolean') return v;
    return false;
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
    if (typeof v === 'boolean') return v;
    return null;
  }

  // "if you control a creature with a +1/+1 counter on it that attacked this turn"
  if (
    /^if\s+you\s+control\s+a\s+creature\s+with\s+a\s+\+1\/\+1\s+counter\s+on\s+it\s+that\s+attacked\s+this\s+turn\.?$/i.test(clause) ||
    clause.toLowerCase().includes('if you control a creature with a +1/+1 counter on it that attacked this turn')
  ) {
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

  // "if you sacrificed N or more Clues this turn"
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
      return false;
    }
  }

  // "if that creature was dealt excess damage this turn" (needs specific excess-damage tracking)
  if (/^if\s+that\s+creature\s+was\s+dealt\s+excess\s+damage\s+this\s+turn$/i.test(clause)) {
    const thatId =
      (sourcePermanent as any)?.thatCreatureId ??
      (sourcePermanent as any)?.referencedCreatureId ??
      (refs as any)?.thatCreatureId ??
      (refs as any)?.referencedCreatureId;
    if (typeof thatId === 'string' && thatId) {
      const that = findBattlefieldPermanent(ctx, thatId);
      const v = (that as any)?.wasDealtExcessDamageThisTurn ?? (that as any)?.excessDamageThisTurn;
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v > 0;
    }

    const stateAny = (ctx as any).state as any;
    const map = stateAny?.excessDamageThisTurnByCreatureId ?? stateAny?.excessDamageThisTurnByPermanentId;
    if (map && typeof map === 'object') {
      const key = String(thatId || '');
      if (key) {
        const v = (map as any)[key];
        if (typeof v === 'boolean') return v;
        if (typeof v === 'number') return v > 0;

        // Tracking is present but has no entry for this id.
        // Treat as deterministically false (avoids replay-unsafe guessing only when the tracker exists).
        if (Object.prototype.hasOwnProperty.call(map, key) === false) return false;
      }
    }

    return null;
  }

  return undefined;
}
