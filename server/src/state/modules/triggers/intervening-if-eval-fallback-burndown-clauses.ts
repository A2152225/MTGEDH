/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: evaluateInterveningIfClauseInternal shares-type-with-exiled plus additional
 * scalable fallback burn-down patterns
 * Public: tryEvaluateInterveningIfFallbackBurnDownClauses
 */

import {
  isLikelyCreatureSubtypeToken,
  parseCountToken,
  countByPermanentType,
  getCreatureSubtypeDiedThisTurnCount,
  getCreatureSubtypeEnteredThisTurnCount,
  getCreatureSubtypeDiedThisTurnSum,
  getCreatureSubtypeEnteredThisTurnSum,
  getLandsEnteredBattlefieldThisTurn,
  getCreaturesDiedThisTurnByController,
} from "./intervening-if-this-turn-counts.js";
import { typeLineHasWord, getHandCount, countControlledCreatureSubtype, getZones, isPrimeNumber, findBattlefieldPermanent } from "./intervening-if-zone-lookups.js";
import { normalizeColorToken } from "./intervening-if-mana-spent.js";
import { getOpponentInfo, getAllPlayerIds } from "./intervening-if-permanent-and-player.js";
import type { InterveningIfPhaseArgs, InterveningIfInternalResult } from "./intervening-if-eval-support.js";

export function tryEvaluateInterveningIfFallbackBurnDownClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
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

  // "if it shares a card type with the exiled card" (recognized; requires linking the exiled card)
  if (/^if\s+it\s+shares\s+a\s+card\s+type\s+with\s+the\s+exiled\s+card$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const p: any = thisPermanentForSelfClauses as any;

    const srcId = String(p?.id ?? p?.permanentId ?? '');
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
    const stackId = refs?.triggeringStackItemId ?? p?.triggeringStackItemId ?? p?.triggeringSpellStackItemId;
    const stack: any[] = Array.isArray((ctx as any).state?.stack) ? (ctx as any).state.stack : [];
    const triggeringStackItem = !refStackItemCard && stackId ? stack.find((it: any) => it && String(it.id) === String(stackId)) : null;
    const triggeringCard = refStackItemCard ?? triggeringStackItem?.card;

    const exiledTypeLine = String(exiledCard?.type_line || exiledCard?.card?.type_line || '').toLowerCase();
    const triggeringTypeLine = String(triggeringCard?.type_line || '').toLowerCase();
    if (!exiledTypeLine || !triggeringTypeLine) return null;

    const toCardTypeSet = (typeLineLower: string): Set<string> => {
      const base = String(typeLineLower.split('—')[0] || '').trim();
      const types = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery'];
      const out = new Set<string>();
      for (const t of types) {
        if (base.includes(t)) out.add(t);
      }
      if (base.includes('tribal')) out.add('kindred');
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

  // Newer mechanics / multiplayer-specific templates (recognized; engine may not model these yet)
  if (/^if\s+evidence\s+was\s+collected$/i.test(clause)) {
    const map = (ctx as any).state?.evidenceCollectedThisTurn;
    const v = map?.[controllerId];
    if (typeof v === 'boolean') return v;
    const hasTracker = map && typeof map === 'object';
    return hasTracker ? false : null;
  }
  if (/^if\s+all\s+your\s+commanders\s+have\s+been\s+revealed$/i.test(clause)) {
    const cz =
      (ctx as any).state?.commandZone?.[controllerId] ??
      (ctx as any).commandZone?.[controllerId];
    if (!cz || typeof cz !== 'object') return null;

    const commanderIds: string[] = Array.isArray(cz.commanderIds) ? cz.commanderIds.map((id: any) => String(id)) : [];
    const commanderNames: string[] = Array.isArray(cz.commanderNames) ? cz.commanderNames.map((n: any) => String(n)) : [];
    const commanderCards: any[] = Array.isArray(cz.commanderCards)
      ? cz.commanderCards
      : Array.isArray(cz.commanders)
        ? cz.commanders
        : [];

    const total = Math.max(commanderIds.length, commanderCards.length, commanderNames.length);
    if (total === 0) return null;

    // Best-effort: commanders are normally public in Commander; if the engine ever models hidden commanders,
    // allow explicit flags to make this condition false.
    for (const c of commanderCards) {
      if (!c) continue;
      const faceDown = (c as any).faceDown === true || (c as any).isFaceDown === true;
      if (faceDown) return false;
      if (typeof (c as any).revealed === 'boolean' && (c as any).revealed === false) return false;
      if (typeof (c as any).hidden === 'boolean' && (c as any).hidden === true) return false;
    }

    return true;
  }
  if (/^if\s+play\s+had\s+proceeded\s+clockwise\s+around\s+the\s+table$/i.test(clause)) {
    const dir = (ctx as any).state?.turnDirection;
    if (dir === 1) return true;
    if (dir === -1) return false;
    return null;
  }
  if (/^if\s+the\s+gift\s+was\s+promised$/i.test(clause)) {
    const v =
      (refs as any)?.giftPromised ??
      (refs as any)?.wasGiftPromised ??
      (refs?.stackItem as any)?.giftPromised ??
      (refs?.stackItem as any)?.wasGiftPromised ??
      (sourcePermanent as any)?.giftPromised ??
      (sourcePermanent as any)?.wasGiftPromised ??
      (sourcePermanent as any)?.card?.giftPromised ??
      (sourcePermanent as any)?.card?.wasGiftPromised;
    return typeof v === 'boolean' ? v : null;
  }
  if (/^if\s+this\s+card\s+is\s+exiled$/i.test(clause)) {
    const z = String((sourcePermanent as any)?.zone ?? (sourcePermanent as any)?.card?.zone ?? '').toLowerCase();
    if (z) return z === 'exile';

    const wantedId = String(
      (sourcePermanent as any)?.card?.id ??
        (sourcePermanent as any)?.id ??
        (refs as any)?.thisCardId ??
        (refs as any)?.thisPermanentId ??
        (refs as any)?.sourcePermanentId ??
        ''
    ).trim();
    if (!wantedId) return null;

    // Replay-safe best-effort: if we can find the object in a public zone, treat that as authoritative.
    try {
      const zones = getZones(ctx);
      if (zones && typeof zones === 'object') {
        for (const z of Object.values(zones as any)) {
          for (const key of ['exile', 'graveyard', 'hand', 'library']) {
            const arr = (z as any)?.[key];
            if (!Array.isArray(arr)) continue;
            const found = arr.some((c: any) => {
              const cid = c?.card?.id ?? c?.cardId ?? c?.id;
              return cid ? String(cid) === wantedId : false;
            });
            if (found) return key === 'exile';
          }
        }
      }
    } catch {
      // ignore
    }

    // Battlefield presence is definitive false for "is exiled".
    const bf = (ctx as any).state?.battlefield;
    if (Array.isArray(bf)) {
      const onBf = bf.some((p: any) => {
        const pid = p?.card?.id ?? p?.id;
        return pid ? String(pid) === wantedId : false;
      });
      if (onBf) return false;
    }

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
    const stateAny = (ctx as any).state as any;
    const v =
      stateAny?.cardLeftYourGraveyardThisTurn?.[controllerId] ??
      stateAny?.cardLeftGraveyardThisTurn?.[controllerId] ??
      stateAny?.cardsLeftGraveyardThisTurn?.[controllerId] ??
      stateAny?.leftGraveyardThisTurn?.[controllerId];
    if (typeof v === 'boolean') return v;
    const hasAnyTracker =
      (stateAny?.cardLeftYourGraveyardThisTurn && typeof stateAny.cardLeftYourGraveyardThisTurn === 'object') ||
      (stateAny?.cardLeftGraveyardThisTurn && typeof stateAny.cardLeftGraveyardThisTurn === 'object') ||
      (stateAny?.cardsLeftGraveyardThisTurn && typeof stateAny.cardsLeftGraveyardThisTurn === 'object') ||
      (stateAny?.leftGraveyardThisTurn && typeof stateAny.leftGraveyardThisTurn === 'object');
    return hasAnyTracker ? false : null;
  }
  if (/^if\s+a\s+creature\s+card\s+left\s+your\s+graveyard\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const v =
      stateAny?.creatureCardLeftYourGraveyardThisTurn?.[controllerId] ??
      stateAny?.creatureCardLeftGraveyardThisTurn?.[controllerId] ??
      stateAny?.creatureCardsLeftGraveyardThisTurn?.[controllerId];
    if (typeof v === 'boolean') return v;
    const hasAnyTracker =
      (stateAny?.creatureCardLeftYourGraveyardThisTurn && typeof stateAny.creatureCardLeftYourGraveyardThisTurn === 'object') ||
      (stateAny?.creatureCardLeftGraveyardThisTurn && typeof stateAny.creatureCardLeftGraveyardThisTurn === 'object') ||
      (stateAny?.creatureCardsLeftGraveyardThisTurn && typeof stateAny.creatureCardsLeftGraveyardThisTurn === 'object');
    return hasAnyTracker ? false : null;
  }
  if (/^if\s+a\s+creature\s+card\s+was\s+put\s+into\s+your\s+graveyard\s+from\s+anywhere\s+this\s+turn$/i.test(clause)) {
    const map = (ctx as any).state?.creatureCardPutIntoYourGraveyardThisTurn;
    const v = map?.[controllerId];
    if (typeof v === 'boolean') return v;
    const hasTracker = map && typeof map === 'object';
    return hasTracker ? false : null;
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
    const { opponents: opps, unknown } = getOpponentInfo(ctx, controllerId);
    if (unknown) return null;
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
      const { opponents: opps, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opps.length) return false;
      const total = getCreatureSubtypeDiedThisTurnSum(ctx, opps.map(String), subtype);
      return total > 0;
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
      return total > 0;
    }
  }
  // (handled later via best-effort refs/tracking)

  // ETB under opponent control (recognized; depends on tracking)
  if (/^if\s+a\s+creature\s+entered\s+the\s+battlefield\s+under\s+an\s+opponent'?s\s+control\s+this\s+turn$/i.test(clause)) {
    const map = (ctx as any).state?.creaturesEnteredBattlefieldThisTurnByController;
    if (!map) return null;
    const { opponents: opps, unknown } = getOpponentInfo(ctx, controllerId);
    if (unknown) return null;
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
      return n > 0;
    }
  }
  {
    const m = clause.match(/^if\s+an?\s+([a-z0-9-]+)\s+entered\s+the\s+battlefield\s+under\s+an\s+opponent'?s\s+control\s+this\s+turn$/i);
    if (m) {
      const subtype = String(m[1] || '').toLowerCase();
      if (!isLikelyCreatureSubtypeToken(subtype)) return null;
      const { opponents: opps, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opps.length) return false;
      const total = getCreatureSubtypeEnteredThisTurnSum(ctx, opps.map(String), subtype);
      return total > 0;
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
      return total > 0;
    }
  }

  // Zone movement into hand (recognized; depends on tracking)
  if (/^if\s+a\s+permanent\s+was\s+put\s+into\s+your\s+hand\s+from\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {
    const map = (ctx as any).state?.permanentPutIntoHandFromBattlefieldThisTurn;
    const v = map?.[controllerId];
    return typeof v === 'boolean' ? v : null;
  }

  // Zone movement into graveyard from battlefield (recognized; depends on tracking)
  if (/^if\s+a\s+land\s+you\s+controlled\s+was\s+put\s+into\s+a\s+graveyard\s+from\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {
    const map = (ctx as any).state?.landYouControlledPutIntoGraveyardFromBattlefieldThisTurn;
    const v = map?.[controllerId];
    return typeof v === 'boolean' ? v : null;
  }
  if (/^if\s+an?\s+enchantment\s+was\s+put\s+into\s+your\s+graveyard\s+from\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {
    const map = (ctx as any).state?.enchantmentPutIntoYourGraveyardFromBattlefieldThisTurn;
    const v = map?.[controllerId];
    return typeof v === 'boolean' ? v : null;
  }
  if (/^if\s+an?\s+artifact\s+or\s+creature\s+was\s+put\s+into\s+a\s+graveyard\s+from\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {
    const v = (ctx as any).state?.artifactOrCreaturePutIntoGraveyardFromBattlefieldThisTurn;
    return typeof v === 'boolean' ? v : null;
  }

  // Tribal shorthand like "if a giant" (context-dependent; recognize but unknown)
  // (handled later via best-effort refs/type lookup)

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

  // Generic "a face-down creature entered ..."
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
    const { opponents: opps, unknown } = getOpponentInfo(ctx, controllerId);
    if (unknown) return null;
    if (!opps.length) return false;
    return opps.some((oid) => getHandCount(ctx, oid) === 0);
  }
  {
    const m = clause.match(/^if\s+an\s+opponent\s+controls\s+([a-z0-9]+)\s+or\s+more\s+creatures$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const { opponents: opps, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opps.length) return false;
      return opps.some((oid) => countByPermanentType(ctx, oid, 'creature') >= n);
    }
  }
  if (/^if\s+a\s+player\s+is\s+the\s+monarch$/i.test(clause)) return Boolean((ctx as any).state?.monarch);
  if (/^if\s+an\s+opponent\s+is\s+the\s+monarch$/i.test(clause)) {
    const monarch = (ctx as any).state?.monarch;
    if (!monarch) return false;
    if (String(monarch) === String(controllerId)) return false;
    const { opponents, unknown } = getOpponentInfo(ctx, controllerId);
    if (unknown) return null;
    return opponents.includes(String(monarch));
  }

  // Prime-number landfall template (already handled earlier too; keep for safety)
  if (/^if\s+a\s+land\s+entered\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn\s+and\s+you\s+control\s+a\s+prime\s+number\s+of\s+lands$/i.test(clause)) {
    const n = getLandsEnteredBattlefieldThisTurn(ctx, controllerId);
    if (n <= 0) return false;
    return isPrimeNumber(countByPermanentType(ctx, controllerId, 'land'));
  }

  // Turn-tracking: discard happened this turn
  if (/^if\s+a\s+player\s+discarded\s+a\s+card\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const anyFlag = stateAny?.anyPlayerDiscardedCardThisTurn;
    // Only treat `true` as authoritative here; `false` may just mean tracking wasn't initialized.
    if (anyFlag === true) return true;
    const map = stateAny?.discardedCardThisTurn;
    if (!map || typeof map !== 'object') return null;

    const ids = getAllPlayerIds(ctx, controllerId);
    if (!ids.length) return null;

    for (const pid of ids) {
      if (!Object.prototype.hasOwnProperty.call(map, String(pid))) return null;
      const v = (map as any)[String(pid)];
      if (typeof v === 'boolean') {
        if (v) return true;
        continue;
      }
      if (typeof v === 'number') {
        if (v > 0) return true;
        continue;
      }
      return null;
    }

    return false;
  }
  if (/^if\s+you\s+discarded\s+a\s+card\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const map = stateAny?.discardedCardThisTurn;
    if (!map || typeof map !== 'object') return null;
    if (!Object.prototype.hasOwnProperty.call(map, String(controllerId))) return null;
    const v = (map as any)[String(controllerId)];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v > 0;
    return null;
  }
  if (/^if\s+an\s+opponent\s+discarded\s+a\s+card\s+this\s+turn$/i.test(clause)) {
    const stateAny = (ctx as any).state as any;
    const map = stateAny?.discardedCardThisTurn;
    if (!map || typeof map !== 'object') return null;
    const { opponents: opps, unknown } = getOpponentInfo(ctx, controllerId);
    if (unknown) return null;
    if (!opps.length) return false;
    for (const oid of opps) {
      if (!Object.prototype.hasOwnProperty.call(map, String(oid))) return null;
      const v = (map as any)[String(oid)];
      if (typeof v === 'boolean') {
        if (v) return true;
        continue;
      }
      if (typeof v === 'number') {
        if (v > 0) return true;
        continue;
      }
      return null;
    }
    return false;
  }

  // Misc context-dependent templates we explicitly recognize (null)
  if (
    /^if\s+an\s+assassin\s+crewed\s+it\s+this\s+turn$/i.test(clause) ||
    /^if\s+an\s+aura\s+you\s+controlled\s+was\s+attached\s+to\s+it$/i.test(clause) ||
    /^if\s+any\s+of\s+those\s+creatures\s+have\s+power\s+or\s+toughness\s+equal\s+to\s+the\s+chosen\s+number$/i.test(clause) ||
    /^if\s+an\s+opponent\s+cast\s+a\s+(white|blue|black|red|green)\s+and\/or\s+(white|blue|black|red|green)\s+spell\s+this\s+turn$/i.test(clause) ||
    /^if\s+a\s+player\s+was\s+dealt\s+([a-z0-9]+)\s+or\s+more\s+combat\s+damage\s+this\s+turn$/i.test(clause) ||
    /^if\s+a\s+player\s+was\s+dealt\s+combat\s+damage\s+by\s+a\s+zombie\s+this\s+turn$/i.test(clause) ||
    /^if\s+a\s+player\s+was\s+dealt\s+([a-z0-9]+)\s+or\s+more\s+damage\s+this\s+turn$/i.test(clause)
  ) {
    return null;
  }

  // Damage-to-player turn tracking.
  // Backed by ctx.state.damageTakenThisTurnByPlayer (see turn/combat + spell damage handlers).
  {
    const mOppN = clause.match(/^if\s+an\s+opponent\s+was\s+dealt\s+([a-z0-9]+)\s+or\s+more\s+damage\s+this\s+turn$/i);
    const wantsOppAny = /^if\s+an\s+opponent\s+was\s+dealt\s+damage\s+this\s+turn$/i.test(clause);
    const mYouN = clause.match(/^if\s+you\s+were\s+dealt\s+([a-z0-9]+)\s+or\s+more\s+damage\s+this\s+turn$/i);
    const mYouveN = clause.match(/^if\s+you'?ve\s+been\s+dealt\s+([a-z0-9]+)\s+or\s+more\s+damage\s+this\s+turn$/i);

    if (mOppN || wantsOppAny || mYouN || mYouveN) {
      const stateAny = (ctx as any).state as any;
      const map = stateAny?.damageTakenThisTurnByPlayer;
      if (!map || typeof map !== 'object') return null;

      if (wantsOppAny || mOppN) {
        const { opponents: opps, unknown } = getOpponentInfo(ctx, controllerId);
        if (unknown) return null;
        if (!opps.length) return false;
        const n = mOppN ? parseCountToken(mOppN[1]) : 1;
        if (n === null) return null;

        let sawUnknown = false;
        for (const oid of opps) {
          const v = (map as any)[String(oid)];
          if (typeof v === 'number') {
            if (v >= n) return true;
            continue;
          }
          if (v == null) continue;
          sawUnknown = true;
        }
        return sawUnknown ? null : false;
      }

      const token = (mYouN?.[1] ?? mYouveN?.[1]) as string | undefined;
      const n = token ? parseCountToken(token) : null;
      if (n === null) return null;
      const v = (map as any)[String(controllerId)];
      if (typeof v === 'number') return v >= n;
      if (v == null) return false;
      return null;
    }
  }


  return undefined;
}
