/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: evaluateInterveningIfClauseInternal remaining mechanic-specific clauses from
 * "if you have a card in hand" through five colors among permanents
 * Public: tryEvaluateInterveningIfMechanicHandColorClauses
 */

import {
  parseCountToken,
  getStartingLifeTotal,
  getSpellsCastFromHandThisTurnCount,
} from "./intervening-if-this-turn-counts.js";
import { getHandCount, getPlayerLife, getGraveyardCount, getLibraryCount, parseMaybeNumber, getCounterCountCaseInsensitiveFromPerm } from "./intervening-if-zone-lookups.js";
import { normalizeColorToken, getManaValue } from "./intervening-if-mana-spent.js";
import { getSpellsCastThisTurnByPlayerCount, getSpellsCastThisTurn, getOpponentInfo } from "./intervening-if-permanent-and-player.js";
import type { InterveningIfPhaseArgs, InterveningIfInternalResult } from "./intervening-if-eval-support.js";

export function tryEvaluateInterveningIfMechanicHandColorClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
  const { ctx, controllerId, clause, sourcePermanent, refs } = args;

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
    const map = (ctx as any).state?.landsPlayedThisTurn;
    if (!map || typeof map !== 'object') return null;
    if (!Object.prototype.hasOwnProperty.call(map, String(controllerId))) return null;
    const v = (map as any)[String(controllerId)];
    if (typeof v !== 'number') return null;
    return v === 0;
  }

  // "if it wasn't the first land you played this turn" (Fastbond)
  if (
    /^if\s+it\s+was\s+not\s+the\s+first\s+land\s+you\s+played\s+this\s+turn$/i.test(clause) ||
    /^if\s+it\s+wasn'?t\s+the\s+first\s+land\s+you\s+played\s+this\s+turn$/i.test(clause)
  ) {
    const map = (ctx as any).state?.landsPlayedThisTurn;
    const v = map && typeof map === 'object' ? (map as any)[String(controllerId)] : undefined;
    if (typeof v !== 'number') return null;
    // This land counts as one of the lands played this turn.
    return v >= 2;
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

  // "if you (didn't|did not) play a card from exile this turn"
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
    // Replay-safe: missing tracking / missing per-player entry => unknown.
    return null;
  }

  // "if you played a card from exile this turn"
  if (/^if\s+you\s+played\s+a\s+card\s+from\s+exile\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const raw =
      stateAny?.playedFromExileThisTurn?.[controllerId] ??
      stateAny?.playedCardFromExileThisTurn?.[controllerId] ??
      stateAny?.cardsPlayedFromExileThisTurn?.[controllerId] ??
      stateAny?.castFromExileThisTurn?.[controllerId];
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw > 0;
    // Replay-safe: missing tracking / missing per-player entry => unknown.
    return null;
  }

  // "if you cycled two or more cards this turn"
  if (/^if\s+you\s+cycled\s+two\s+or\s+more\s+cards\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const a = stateAny?.cardsCycledThisTurn;
    const b = stateAny?.cycledCardsThisTurn;
    const c = stateAny?.cycleCountThisTurn;
    const hasTracking = (a && typeof a === 'object') || (b && typeof b === 'object') || (c && typeof c === 'object');
    const raw = a?.[controllerId] ?? b?.[controllerId] ?? c?.[controllerId];
    if (typeof raw === 'number') return raw >= 2;
    // If tracking exists but this player has no entry, treat as 0.
    if (raw === undefined && hasTracking) return false;
    return null;
  }

  // "if you've committed a crime this turn"
  if (/^if\s+you\s+(?:have\s+)?committed\s+a\s+crime\s+this\s+turn$/i.test(clause) || /^if\s+you'?ve\s+committed\s+a\s+crime\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const a = stateAny?.committedCrimeThisTurn;
    const b = stateAny?.crimeCommittedThisTurn;
    const c = stateAny?.hasCommittedCrimeThisTurn;
    const hasTracking = (a && typeof a === 'object') || (b && typeof b === 'object') || (c && typeof c === 'object');
    const raw = a?.[controllerId] ?? b?.[controllerId] ?? c?.[controllerId];
    if (typeof raw === 'boolean') return raw;
    // If tracking exists but this player has no entry, treat as "not committed".
    if (raw === undefined && hasTracking) return false;
    return null;
  }

  // "if you've cast a spell with mana value N or greater this turn"
  {
    const m = clause.match(/^if\s+you'?ve\s+cast\s+a\s+spell\s+with\s+mana\s+value\s+([a-z0-9]+)\s+or\s+greater\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const stateAny = (ctx as any).state as any;
      const spells = Array.isArray(stateAny?.spellsCastThisTurn) ? stateAny.spellsCastThisTurn : [];
      return spells.some((s: any) => {
        if (String(s?.casterId ?? s?.controller ?? '') !== String(controllerId)) return false;
        const mv = parseMaybeNumber(s?.card?.manaValue ?? s?.card?.cmc ?? s?.manaValue ?? s?.cmc);
        return mv !== null && mv >= n;
      });
    }
  }

  // "if you've played a land or cast a spell this turn from anywhere other than your hand"
  if (
    /^if\s+you'?ve\s+played\s+a\s+land\s+or\s+cast\s+a\s+spell\s+this\s+turn\s+from\s+anywhere\s+other\s+than\s+your\s+hand$/i.test(
      clause
    )
  ) {
    const stateAny = (ctx as any).state as any;
    const hasAnyTracker =
      (stateAny?.playedCardFromExileThisTurn && typeof stateAny.playedCardFromExileThisTurn === 'object') ||
      (stateAny?.playedFromExileThisTurn && typeof stateAny.playedFromExileThisTurn === 'object') ||
      (stateAny?.castFromExileThisTurn && typeof stateAny.castFromExileThisTurn === 'object') ||
      (stateAny?.castFromGraveyardThisTurn && typeof stateAny.castFromGraveyardThisTurn === 'object') ||
      (stateAny?.playedLandFromGraveyardThisTurn && typeof stateAny.playedLandFromGraveyardThisTurn === 'object') ||
      (stateAny?.playedLandFromExileThisTurn && typeof stateAny.playedLandFromExileThisTurn === 'object');
    const candidates = [
      stateAny?.playedCardFromExileThisTurn?.[controllerId],
      stateAny?.playedFromExileThisTurn?.[controllerId],
      stateAny?.castFromExileThisTurn?.[controllerId],
      stateAny?.castFromGraveyardThisTurn?.[controllerId],
      stateAny?.playedLandFromGraveyardThisTurn?.[controllerId],
      stateAny?.playedLandFromExileThisTurn?.[controllerId],
    ];

    if (!hasAnyTracker) return null;
    const anyTrue = candidates.some((v: any) => (typeof v === 'boolean' ? v : typeof v === 'number' ? v > 0 : false));
    return anyTrue;
  }

  // "if you cast them" (best-effort; requires explicit refs)
  if (/^if\s+you\s+cast\s+them$/i.test(clause)) {
    const raw = (refs as any)?.youCastThem ?? (refs as any)?.castThem ?? (refs as any)?.wasCastThem;
    return typeof raw === 'boolean' ? raw : null;
  }

  // "if you sacrificed a permanent this turn" / "if you sacrificed one or more permanents this turn"
  if (
    /^if\s+you\s+sacrificed\s+a\s+permanent\s+this\s+turn\.?$/i.test(clause) ||
    /^if\s+you\s+sacrificed\s+one\s+or\s+more\s+permanents\s+this\s+turn\.?$/i.test(clause)
  ) {
    const stateAny = (ctx as any).state as any;
    const raw = stateAny?.permanentsSacrificedThisTurn?.[controllerId];
    if (typeof raw === 'number') return raw > 0;
    const hasTracker = stateAny?.permanentsSacrificedThisTurn && typeof stateAny.permanentsSacrificedThisTurn === 'object';
    return hasTracker ? false : null;
  }

  // "if you sacrificed a Food this turn"
  if (/^if\s+you\s+sacrificed\s+a\s+food\s+this\s+turn\.?$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const raw = stateAny?.foodsSacrificedThisTurn?.[controllerId];
    if (typeof raw === 'number') return raw > 0;
    const hasTracker = stateAny?.foodsSacrificedThisTurn && typeof stateAny.foodsSacrificedThisTurn === 'object';
    return hasTracker ? false : null;
  }

  // "if you weren't the starting player"
  if (/^if\s+you\s+weren'?t\s+the\s+starting\s+player\.?$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const startingPlayerId = String(stateAny?.startingPlayerId || stateAny?.startingPlayer || '').trim();
    if (!startingPlayerId) return null;
    return controllerId !== startingPlayerId;
  }

  // "if you created a token this turn"
  if (/^if\s+you\s+created\s+a\s+token\s+this\s+turn\.?$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const raw =
      stateAny?.tokensCreatedThisTurn?.[controllerId] ??
      stateAny?.tokenCreatedThisTurn?.[controllerId] ??
      stateAny?.createdTokenThisTurn?.[controllerId];
    if (typeof raw === 'number') return raw > 0;
    if (typeof raw === 'boolean') return raw;
    const hasAnyTracker =
      (stateAny?.tokensCreatedThisTurn && typeof stateAny.tokensCreatedThisTurn === 'object') ||
      (stateAny?.tokenCreatedThisTurn && typeof stateAny.tokenCreatedThisTurn === 'object') ||
      (stateAny?.createdTokenThisTurn && typeof stateAny.createdTokenThisTurn === 'object');
    return hasAnyTracker ? false : null;
  }

  // "if you were the monarch as the turn began"
  if (/^if\s+you\s+were\s+the\s+monarch\s+as\s+the\s+turn\s+began$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const a = stateAny?.monarchAtTurnBeginByPlayer;
    const b = stateAny?.wasMonarchAtTurnBegin;
    const c = stateAny?.monarchAtTurnBegan;
    const hasTracking = (a && typeof a === 'object') || (b && typeof b === 'object') || (c && typeof c === 'object');
    const raw = a?.[controllerId] ?? b?.[controllerId] ?? c?.[controllerId];
    if (typeof raw === 'boolean') return raw;
    // If tracking exists but this player has no entry, treat as "not monarch".
    if (raw === undefined && hasTracking) return false;
    return null;
  }

  // "if you have an {E}" (energy; best-effort)
  if (/^if\s+you\s+have\s+an\s+\{e\}$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const v = stateAny?.energyCounters?.[controllerId] ?? stateAny?.energy?.[controllerId] ?? stateAny?.energyCount?.[controllerId];
    return typeof v === 'number' ? v > 0 : null;
  }

  // Un-/silver-bordered meta templates (best-effort; explicit refs/state only)
  if (/^if\s+you\s+didn'?t\s+have\s+an\s+active\s+tournament$/i.test(clause)) {
    const raw = (refs as any)?.hasActiveTournament ?? (refs as any)?.activeTournament;
    return typeof raw === 'boolean' ? !raw : null;
  }
  if (/^if\s+you\s+don'?t\s+have\s+a\s+timer\s+running$/i.test(clause)) {
    const raw = (refs as any)?.hasTimerRunning ?? (refs as any)?.timerRunning;
    return typeof raw === 'boolean' ? !raw : null;
  }
  if (/^if\s+you\s+have\s+a\s+boon$/i.test(clause)) {
    const raw = (refs as any)?.hasBoon ?? (refs as any)?.boon;
    return typeof raw === 'boolean' ? raw : null;
  }
  if (/^if\s+you\'?re\s+eating$/i.test(clause) || /^if\s+you\s+are\s+eating$/i.test(clause)) {
    const raw = (refs as any)?.isEating ?? (refs as any)?.youAreEating;
    return typeof raw === 'boolean' ? raw : null;
  }
  if (/^if\s+there\s+haven'?t\s+been\s+any\s+subgames\s+this\s+match$/i.test(clause)) {
    const raw = (refs as any)?.hasHadSubgamesThisMatch ?? (refs as any)?.hadSubgamesThisMatch;
    return typeof raw === 'boolean' ? !raw : null;
  }

  // "if you have four token counters" (best-effort)
  if (/^if\s+you\s+have\s+four\s+token\s+counters$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const a = stateAny?.tokenCounters;
    const b = stateAny?.tokenCounterCount;
    const hasTracking = (a && typeof a === 'object') || (b && typeof b === 'object');
    const v = a?.[controllerId] ?? b?.[controllerId];
    if (typeof v === 'number') return v >= 4;
    // If tracking exists but this player has no entry, treat as 0.
    if (v === undefined && hasTracking) return false;
    return null;
  }

  // "if you haven't added mana with this ability this turn" (best-effort)
  if (/^if\s+you\s+haven'?t\s+added\s+mana\s+with\s+this\s+ability\s+this\s+turn$/i.test(clause)) {
    const raw = (refs as any)?.addedManaWithThisAbilityThisTurn ?? (refs as any)?.hasAddedManaWithThisAbilityThisTurn;
    if (typeof raw === 'boolean') return !raw;

    // Prefer replay-stable per-turn tracking when available.
    // This only becomes deterministic when we can identify the ability (via an ability id).
    try {
      const stateAny = (ctx as any).state as any;
      const tracking = stateAny?.addedManaWithThisAbilityThisTurn;
      if (!tracking || typeof tracking !== 'object') return null;

      const playerKey = String(controllerId);
      const perPlayer = (tracking as any)[playerKey];
      if (!perPlayer || typeof perPlayer !== 'object') return null;

      const permId = String(
        (sourcePermanent as any)?.id ??
          (refs as any)?.permanentId ??
          (refs as any)?.sourcePermanentId ??
          (refs as any)?.sourceId ??
          ''
      );

      const abilityId =
        (refs as any)?.abilityId ??
        (refs as any)?.activatedAbilityId ??
        (refs as any)?.sourceAbilityId;

      const abilityKeyRaw = abilityId != null ? String(abilityId) : '';
      if (!permId) return null;

      // If we can identify the specific ability, a missing entry is provably "not yet" when tracking is initialized per turn.
      if (abilityKeyRaw) {
        const k = `${permId}:${abilityKeyRaw}`;
        const v = (perPlayer as any)[k];
        if (typeof v === 'boolean') return !v;
        if (v === undefined) return true;
        return null;
      }

      // Without an ability id, only accept an explicit permanent-scoped boolean (some callers/events don't include abilityId).
      const coarse = (perPlayer as any)[permId];
      return typeof coarse === 'boolean' ? !coarse : null;
    } catch {
      return null;
    }
  }

  // "if you haven't been dealt combat damage since your last turn"
  if (/^if\s+you\s+haven'?t\s+been\s+dealt\s+combat\s+damage\s+since\s+your\s+last\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const a = stateAny?.combatDamageDealtToPlayerSinceLastTurn;
    const b = stateAny?.tookCombatDamageSinceLastTurn;
    const hasTracking = (a && typeof a === 'object') || (b && typeof b === 'object');
    const raw = a?.[controllerId] ?? b?.[controllerId];
    if (typeof raw === 'boolean') return !raw;
    // If tracking exists but this player has no entry, treat as "no combat damage since last turn".
    if (raw === undefined && hasTracking) return true;
    return null;
  }

  // "if you planeswalked to Unyaro this turn" (best-effort)
  if (/^if\s+you\s+planeswalked\s+to\s+unyaro\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;

    // If Planechase is explicitly disabled for this game, this is provably false.
    // In this codebase Planechase is NYI; treat "not enabled" as disabled.
    const planechaseEnabled = stateAny?.houseRules?.enablePlanechase;
    if (planechaseEnabled !== true) return false;

    const list = stateAny?.planeswalkedToThisTurn?.[controllerId] ?? stateAny?.planeswalkedToPlanesThisTurn?.[controllerId];
    if (!Array.isArray(list)) return null;
    return list.some((p: any) => String(p || '').toLowerCase() === 'unyaro');
  }

  // "if two or more players have lost the game" (best-effort)
  if (/^if\s+two\s+or\s+more\s+players\s+have\s+lost\s+the\s+game$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const v = stateAny?.playersLostCount ?? stateAny?.playersWhoLostCount;
    if (typeof v === 'number') return v >= 2;

    // If the engine provides the defeated-player set on the context, prefer that.
    // This is authoritative in this codebase (used by nextTurn to skip defeated players).
    const inactive = (ctx as any).inactive;
    if (inactive instanceof Set) return inactive.size >= 2;

    // Authoritative fallback: count defeated players from the current player list.
    // Do NOT treat "conceded" as lost until the engine marks them hasLost/eliminated.
    const players = Array.isArray(stateAny?.players) ? stateAny.players : null;
    if (players) {
      const lostCount = players.filter((p: any) => p && (p.hasLost === true || p.eliminated === true)).length;
      return lostCount >= 2;
    }

    return null;
  }

  // "if your opponents control no permanents with bounty counters on them" (best-effort)
  if (/^if\s+your\s+opponents\s+control\s+no\s+permanents\s+with\s+bounty\s+counters\s+on\s+them$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    const { opponents: oppIds, unknown } = getOpponentInfo(ctx, controllerId);
    if (unknown) return null;
    if (oppIds.length === 0) return true;

    // Only become deterministic when counters tracking is present on the battlefield.
    // (Some permanents omit the counters object entirely when they have none.)
    const hasAnyCountersObject = battlefield.some((p: any) => p && (p as any).counters && typeof (p as any).counters === 'object');
    if (!hasAnyCountersObject) return null;

    for (const p of battlefield) {
      if (!p || !oppIds.includes(String(p.controller ?? ''))) continue;
      const n = getCounterCountCaseInsensitiveFromPerm(p, 'bounty');
      if (typeof n === 'number' && n > 0) return false;
    }
    return true;
  }

  // "if there are no nonbasic land cards in your library" (best-effort)
  if (/^if\s+there\s+are\s+no\s+nonbasic\s+land\s+cards\s+in\s+your\s+library$/i.test(clause)) {
    const zones = (ctx as any).state?.zones;
    const z = zones?.[controllerId];
    const lib: any[] = z?.library;
    if (!Array.isArray(lib)) return null;
    let sawUnknown = false;
    for (const c of lib) {
      const tl = c?.type_line ?? c?.card?.type_line;
      if (typeof tl !== 'string' || !tl.trim()) {
        sawUnknown = true;
        continue;
      }
      const lower = tl.toLowerCase();
      if (lower.includes('land') && !lower.includes('basic')) return false;
    }
    return sawUnknown ? null : true;
  }

  // "if there are five colors among permanents you control" (best-effort)
  if (/^if\s+there\s+are\s+five\s+colors\s+among\s+permanents\s+you\s+control$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    const colors = new Set<string>();
    let sawUnknown = false;
    for (const p of battlefield) {
      if (!p || String(p.controller ?? '') !== String(controllerId)) continue;
      const raw =
        (p as any)?.card?.colors ??
        (p as any)?.card?.color_identity ??
        (p as any)?.colors ??
        (p as any)?.color_identity;
      if (Array.isArray(raw)) {
        for (const c of raw) {
          const t = String(c || '').toLowerCase();
          const norm = normalizeColorToken(t);
          if (norm) colors.add(norm);
        }
      } else {
        const color = (p as any)?.card?.color;
        if (typeof color === 'string' && color.trim()) {
          const norm = normalizeColorToken(color);
          if (norm) colors.add(norm);
          else sawUnknown = true;
        } else {
          sawUnknown = true;
        }
      }
      if (colors.size >= 5) return true;
    }
    return sawUnknown ? null : false;
  }

  return undefined;
}
