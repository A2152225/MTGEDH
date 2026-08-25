/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: evaluateInterveningIfClauseInternal clauses from "if it's on the battlefield"
 * through "if that player controls more creatures/lands than you"
 * Public: tryEvaluateInterveningIfItAndLifeClauses
 */

import { detectLinkedExileEffect } from "./linked-exile.js";
import { parseCountToken, countByPermanentType } from "./intervening-if-this-turn-counts.js";
import { getPlayerLife, findBattlefieldPermanent, getZones, parseMaybeNumber } from "./intervening-if-zone-lookups.js";
import {
  getOpponentInfo,
  getActivePlayerId,
  getAllPlayerIds,
  isTiedForExtreme,
  getOpponentIds,
  isPermanentBlocking,
  isPermanentBlocked,
  getTurnPlayerId,
} from "./intervening-if-permanent-and-player.js";
import type { InterveningIfPhaseArgs, InterveningIfInternalResult } from "./intervening-if-eval-support.js";

export function tryEvaluateInterveningIfItAndLifeClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
  const { ctx, controllerId, clause, sourcePermanent, refs } = args;
  // "if it's on the battlefield" (best-effort via zone)
  if (/^if\s+it'?s\s+on\s+the\s+battlefield$/i.test(clause) || /^if\s+it\s+is\s+on\s+the\s+battlefield$/i.test(clause)) {
    if (sourcePermanent) {
      const zone = String((sourcePermanent as any)?.zone ?? (sourcePermanent as any)?.card?.zone ?? '');
      if (zone) return zone.toLowerCase() === 'battlefield';
    }
    const id = String(
      (refs as any)?.thisCreatureId ??
        (refs as any)?.thisPermanentId ??
        (refs as any)?.thisId ??
        (refs as any)?.sourcePermanentId ??
        ''
    ).trim();
    if (!id) return null;
    return !!findBattlefieldPermanent(ctx, id);
  }

  // "if no creatures are on the battlefield"
  if (/^if\s+no\s+creatures\s+are\s+on\s+the\s+battlefield$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield || [];
    const anyCreature = (Array.isArray(battlefield) ? battlefield : []).some((p: any) => {
      const tl = String(p?.card?.type_line || "").toLowerCase();
      return tl.includes("creature");
    });
    return !anyCreature;
  }

  // "if this card is suspended" (best-effort: looks for isSuspended)
  if (/^if\s+this\s+card\s+is\s+suspended$/i.test(clause)) {
    const v = (sourcePermanent as any)?.isSuspended ?? (sourcePermanent as any)?.card?.isSuspended;
    return typeof v === "boolean" ? v : null;
  }

  // "if a card is exiled with it" (conservative)
  if (
    /^if\s+(?:a\s+card\s+is\s+exiled|there\s+are\s+cards\s+exiled)\s+with\s+(?:it|this\s+artifact|this\s+enchantment)$/i.test(
      clause
    )
  ) {
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
    const candidates = [
      p.exiledCards,
      p.cardsExiledWith,
      p.exiledWith,
      p.exiledCardIds,
      p.card?.exiledCards,
      p.card?.cardsExiledWith,
      p.card?.exiledWith,
      p.card?.exiledCardIds,
    ];
    for (const c of candidates) {
      if (Array.isArray(c)) return c.length > 0;
      if (c && typeof c === "object") return Object.keys(c).length > 0;
      if (typeof c === "string") return c.length > 0;
    }

    // Evidence path 1: exile-zone tags written by `movePermanentToExile` (or similar helpers).
    // These tags are intentionally stored on the exiled card objects.
    const srcId = String(p?.id ?? p?.permanentId ?? '');
    if (srcId) {
      const zones = (ctx as any).state?.zones;
      if (zones && typeof zones === 'object') {
        for (const z of Object.values(zones as any)) {
          const exile = (z as any)?.exile;
          if (!Array.isArray(exile)) continue;
          if (exile.some((c: any) => String(c?.exiledWithSourceId ?? '') === srcId)) return true;
        }
      }
    }

    // Evidence path 2: linked-exile system bookkeeping (Oblivion Ring, Banisher Priest, etc.)
    // When present, this implies a card is currently exiled with the permanent.
    const linked = (ctx as any).state?.linkedExiles;
    const hasLinkedTracking = Array.isArray(linked);
    if (hasLinkedTracking && srcId) {
      if (linked.some((le: any) => String(le?.exilingPermanentId ?? '') === srcId)) return true;
    }

    // Negative evidence (safe only for linked-exile permanents): if we can positively identify this
    // permanent as a linked-exile source AND we track that system, then "none found" => false.
    try {
      const det = detectLinkedExileEffect((sourcePermanent as any)?.card);
      if (det?.hasLinkedExile && hasLinkedTracking) return false;
    } catch {
      // best-effort only
    }

    return null;
  }

  // "if N or more cards have been exiled with this artifact" (conservative)
  {
    const m = clause.match(
      /^if\s+(?:there\s+are\s+)?([a-z0-9]+)\s+or\s+more\s+cards\s+(?:have\s+been\s+)?exiled\s+with\s+(?:this\s+artifact|the\s+mysterious\s+sphere)$/i
    );
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
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

      // If the clause explicitly names a different permanent, ensure we only handle when it refers to this source.
      if (/the\s+mysterious\s+sphere/i.test(clause)) {
        const nm = String(p?.card?.name || p?.name || '');
        if (!/^The Mysterious Sphere\b/i.test(nm)) return null;
      }

      // Evidence path 0: direct bookkeeping on the permanent.
      const list =
        p?.exiledCards ??
        p?.cardsExiledWith ??
        p?.exiledWith ??
        p?.exiledCardIds ??
        p?.card?.exiledCards ??
        p?.card?.cardsExiledWith ??
        p?.card?.exiledWith ??
        p?.card?.exiledCardIds;
      if (Array.isArray(list)) {
        return list.length >= n;
      }
      if (list && typeof list === 'object') {
        return Object.keys(list).length >= n;
      }

      // Evidence path 1: exile-zone tags written on exiled cards.
      const srcId = String(p?.id ?? p?.permanentId ?? '');
      if (!srcId) return null;
      const zones = getZones(ctx);
      if (zones && typeof zones === 'object') {
        const playerIds = Array.isArray((ctx as any).state?.players)
          ? ((ctx as any).state.players as any[])
              .map((pp: any) => String(pp?.id ?? '').trim())
              .filter((id: string) => Boolean(id))
          : [];

        // Exile tracking is only "fully tracked" when we have a meaningful set of players (EDH is multiplayer)
        // and every known player's zone includes an `exile` array.
        // For single-player/unit-template states, stay conservative and do not infer a definitive `false`.
        let fullyTracked = playerIds.length > 1;
        for (const pid of playerIds) {
          const zone = (zones as any)[pid];
          if (!zone || !Array.isArray((zone as any)?.exile)) {
            fullyTracked = false;
            break;
          }
        }

        let count = 0;
        for (const z of Object.values(zones as any)) {
          const exile = (z as any)?.exile;
          if (!Array.isArray(exile)) continue;
          for (const c of exile) {
            if (String(c?.exiledWithSourceId ?? '') === srcId) count++;
          }
        }
        if (count >= n) return true;
        return fullyTracked ? false : null;
      }

      // Evidence path 2: linked-exile bookkeeping.
      const linked = (ctx as any).state?.linkedExiles;
      const hasLinkedTracking = Array.isArray(linked);
      let linkedCount = 0;
      if (hasLinkedTracking) {
        linkedCount = linked.filter((le: any) => String(le?.exilingPermanentId ?? '') === srcId).length;
        if (linkedCount >= n) return true;
      }

      // Conservative: without an explicit list on the permanent, we avoid returning a definitive false.
      return null;
    }
  }

  // Spellweaver Helix-style: "if it has the same name as one of the cards exiled with this artifact"
  // Deterministic when linked-exile bookkeeping (or explicit exiled list) exists.
  if (/^if\s+it\s+has\s+the\s+same\s+name\s+as\s+one\s+of\s+the\s+cards\s+exiled\s+with\s+this\s+artifact$/i.test(clause)) {
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

    const srcId = String(p?.id ?? p?.permanentId ?? '');
    if (!srcId) return null;

    let itName = String(
      (refs as any)?.stackItem?.card?.name ??
        (refs as any)?.card?.name ??
        (refs as any)?.triggeringCard?.name ??
        (refs as any)?.triggeringSpellCard?.name ??
        ''
    ).trim();
    if (!itName) {
      const triggeringStackItemId =
        (refs as any)?.triggeringStackItemId ??
        p?.triggeringStackItemId;
      const stack = (ctx as any).state?.stack;
      if (typeof triggeringStackItemId === 'string' && triggeringStackItemId && Array.isArray(stack)) {
        const item = stack.find((s: any) => String(s?.id || '') === triggeringStackItemId);
        itName = String(item?.card?.name ?? '').trim();
      }
    }
    if (!itName) return null;
    const itLower = itName.toLowerCase();

    const exiledNames = new Set<string>();

    let hasExplicitListTracking = false;

    // Evidence path 0: direct bookkeeping on the permanent.
    const list =
      p.exiledCards ??
      p.cardsExiledWith ??
      p.exiledWith ??
      p.exiledCardIds ??
      p.card?.exiledCards ??
      p.card?.cardsExiledWith ??
      p.card?.exiledWith ??
      p.card?.exiledCardIds;
    if (Array.isArray(list)) {
      hasExplicitListTracking = true;
      for (const entry of list) {
        const nm = String((entry as any)?.name ?? (entry as any)?.card?.name ?? '').trim();
        if (nm) exiledNames.add(nm.toLowerCase());
      }
    }

    // Evidence path 1: exile-zone tags written on exiled cards.
    const zones = getZones(ctx);
    if (zones && typeof zones === 'object') {
      for (const z of Object.values(zones as any)) {
        const exile = (z as any)?.exile;
        if (!Array.isArray(exile)) continue;
        for (const c of exile) {
          if (String(c?.exiledWithSourceId ?? '') !== srcId) continue;
          const nm = String(c?.name ?? c?.card?.name ?? '').trim();
          if (nm) exiledNames.add(nm.toLowerCase());
        }
      }
    }

    // Evidence path 2: linked-exile bookkeeping.
    // Prefer names stored on linkedExiles entries (deterministic), then fall back to zone scans.
    const linked = (ctx as any).state?.linkedExiles;
    if (Array.isArray(linked)) {
      for (const le of linked) {
        if (String((le as any)?.exilingPermanentId ?? '') !== srcId) continue;
        const nm = String((le as any)?.exiledCardName ?? (le as any)?.exiledCard?.name ?? '').trim();
        if (nm) exiledNames.add(nm.toLowerCase());
      }

      if (exiledNames.size === 0 && zones && typeof zones === 'object') {
        const ids = linked
          .filter((le: any) => String(le?.exilingPermanentId ?? '') === srcId)
          .map((le: any) => String(le?.exiledCardId ?? le?.exiledCard?.id ?? ''))
          .filter(Boolean);

        if (ids.length) {
          for (const z of Object.values(zones as any)) {
            const exile = (z as any)?.exile;
            if (!Array.isArray(exile)) continue;
            for (const c of exile) {
              const cid = String(c?.id ?? c?.cardId ?? '');
              if (!cid || !ids.includes(cid)) continue;
              const nm = String(c?.name ?? c?.card?.name ?? '').trim();
              if (nm) exiledNames.add(nm.toLowerCase());
            }
          }
        }
      }
    }

    if (exiledNames.size === 0) {
      if (hasExplicitListTracking) return false;

      const linked = (ctx as any).state?.linkedExiles;
      const hasLinkedTracking = Array.isArray(linked);
      try {
        const det = detectLinkedExileEffect(p?.card);
        if (det?.hasLinkedExile && hasLinkedTracking) return false;
      } catch {
        // best-effort only
      }

      return null;
    }
    return exiledNames.has(itLower);
  }

  // "if this creature attacked or blocked this combat"
  if (/^if\s+this\s+creature\s+attacked\s+or\s+blocked\s+this\s+combat$/i.test(clause)) {
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

    const id = String(p?.id || '').trim();
    const tracked = (ctx as any).state?.attackedOrBlockedThisCombatByPermanentId;
    if (id && tracked && typeof tracked === 'object' && Object.prototype.hasOwnProperty.call(tracked, id)) return tracked[id] === true;

    // Fallback: still return true on positive evidence, otherwise unknown.
    const attacked = (typeof p.attacking === 'string' && p.attacking.trim() !== '') || p.isAttacking === true || p.attackedThisTurn === true;
    const blockedOrBlocking = isPermanentBlocked(p) || isPermanentBlocking(p);
    if (attacked || blockedOrBlocking) return true;
    return null;
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

  // Graveyard-order templates (best-effort). Assumes graveyard arrays append new cards (top is end).
  // Note: If source zone is known and not graveyard, we can safely conclude false.
  {
    const sourceZone = String((sourcePermanent as any)?.zone ?? (sourcePermanent as any)?.card?.zone ?? '').toLowerCase();
    const sourceNameLower = String((sourcePermanent as any)?.card?.name ?? (sourcePermanent as any)?.name ?? '').toLowerCase().trim();
    const sourceCardId = String((sourcePermanent as any)?.card?.id ?? (sourcePermanent as any)?.cardId ?? (sourcePermanent as any)?.id ?? '').trim();

    const findSourceInGraveyard = (): { graveyard: any[]; index: number } | null => {
      const zones = getZones(ctx);
      const z = zones?.[controllerId];
      const graveyard: any[] = Array.isArray(z?.graveyard) ? z.graveyard : [];
      if (!graveyard.length) return null;

      // Prefer matching by id when available.
      if (sourceCardId) {
        const idxById = graveyard.findIndex((c: any) => String(c?.id ?? c?.card?.id ?? c?.cardId ?? '').trim() === sourceCardId);
        if (idxById >= 0) return { graveyard, index: idxById };
      }

      // Fallback: match by name only if unique.
      if (sourceNameLower) {
        const matches = graveyard
          .map((c: any, i: number) => ({ i, n: String(c?.name ?? c?.card?.name ?? '').toLowerCase().trim() }))
          .filter((x) => x.n && x.n === sourceNameLower);
        if (matches.length === 1) return { graveyard, index: matches[0].i };
      }

      return null;
    };

    const isCreatureCardMaybe = (c: any): boolean | null => {
      const tl = c?.type_line ?? c?.card?.type_line;
      if (typeof tl !== 'string' || !tl.trim()) return null;
      return tl.toLowerCase().includes('creature');
    };

    // "if this card is in your graveyard and it's your turn"
    if (/^if\s+this\s+card\s+is\s+in\s+your\s+graveyard\s+and\s+it'?s\s+your\s+turn$/i.test(clause)) {
      if (sourceZone && sourceZone !== 'graveyard') return false;
      const active = getActivePlayerId(ctx);
      if (!active) return null;
      const found = findSourceInGraveyard();
      if (!found) return false;
      return active === controllerId;
    }

    // "if this card is in your graveyard with a creature card directly above it"
    if (/^if\s+this\s+card\s+is\s+in\s+your\s+graveyard\s+with\s+a\s+creature\s+card\s+directly\s+above\s+it$/i.test(clause)) {
      if (sourceZone && sourceZone !== 'graveyard') return false;
      const found = findSourceInGraveyard();
      if (!found) return null;
      const above = found.graveyard[found.index + 1];
      if (!above) return false;
      const isCreature = isCreatureCardMaybe(above);
      return isCreature;
    }

    // "if this card is in your graveyard with N or more creature cards above it"
    {
      const m = clause.match(
        /^if\s+this\s+card\s+is\s+in\s+your\s+graveyard\s+with\s+([a-z0-9]+)\s+or\s+more\s+creature\s+cards?\s+above\s+it$/i
      );
      if (m) {
        if (sourceZone && sourceZone !== 'graveyard') return false;
        const n = parseCountToken(m[1]);
        if (n === null) return null;
        const found = findSourceInGraveyard();
        if (!found) return null;

        let creatureCount = 0;
        let sawUnknown = false;
        for (let i = found.index + 1; i < found.graveyard.length; i++) {
          const isCreature = isCreatureCardMaybe(found.graveyard[i]);
          if (isCreature === true) creatureCount++;
          else if (isCreature === null) sawUnknown = true;
        }

        if (creatureCount >= n) return true;
        // If unknowns exist we can't conclude false safely.
        return sawUnknown ? null : false;
      }
    }

    // "if this card is the only creature card in your graveyard"
    if (/^if\s+this\s+card\s+is\s+the\s+only\s+creature\s+card\s+in\s+your\s+graveyard$/i.test(clause)) {
      if (sourceZone && sourceZone !== 'graveyard') return false;
      const found = findSourceInGraveyard();
      if (!found) return null;

      const isSourceCreature = isCreatureCardMaybe(found.graveyard[found.index]);
      if (isSourceCreature === false) return false;
      if (isSourceCreature === null) return null;

      let creatureCount = 0;
      let sawUnknown = false;
      for (const c of found.graveyard) {
        const isCreature = isCreatureCardMaybe(c);
        if (isCreature === true) creatureCount++;
        else if (isCreature === null) sawUnknown = true;
      }

      if (creatureCount === 1) return true;
      // If we already saw 2+ creatures, it's definitely false regardless of unknowns.
      if (creatureCount >= 2) return false;
      return sawUnknown ? null : false;
    }
  }

  // "if it's not the first turn of the game" (turn-tracking)
  if (/^if\s+(?:it'?s\s+not|it\s+is\s+not)\s+the\s+first\s+turn\s+of\s+the\s+game$/i.test(clause)) {
    const tn = parseMaybeNumber((ctx as any).state?.turnNumber);
    if (tn === null) return null;
    return tn > 1;
  }

  // "if it's the first combat phase of the turn" (handles extra combats)
  if (/^if\s+it'?s\s+the\s+first\s+combat\s+phase\s+of\s+the\s+turn$/i.test(clause)) {
    const combatNumber = parseMaybeNumber((ctx as any).state?.combatNumber);
    return (combatNumber ?? 1) === 1;
  }

  // "if it's not their turn" (context-dependent)
  if (/^if\s+(?:it'?s\s+not|it\s+is\s+not|it\s+isn'?t)\s+their\s+turn$/i.test(clause)) {
    const ref = (sourcePermanent as any)?.thatPlayerId ?? (sourcePermanent as any)?.theirPlayerId ?? (sourcePermanent as any)?.referencedPlayerId;
    if (typeof ref !== "string" || !ref) return null;
    const active = getActivePlayerId(ctx);
    if (!active) return null;
    return active !== String(ref);
  }

  // "if it isn't that player's turn" / "if it's not that player's turn" (context-dependent)
  if (/^if\s+(?:it'?s\s+not|it\s+is\s+not|it\s+isn'?t)\s+that\s+player'?s\s+turn$/i.test(clause)) {
    const pid =
      refs?.thatPlayerId ??
      refs?.referencedPlayerId ??
      refs?.theirPlayerId ??
      (sourcePermanent as any)?.thatPlayerId ??
      (sourcePermanent as any)?.referencedPlayerId ??
      (sourcePermanent as any)?.theirPlayerId;
    if (typeof pid !== 'string' || !pid) return null;
    const active = getActivePlayerId(ctx);
    if (!active) return null;
    return active !== String(pid);
  }

  // "if it isn't a mana ability" (needs stack/ability metadata; recognize but unknown)
  if (
    /^if\s+it\s+isn'?t\s+a\s+mana\s+ability$/i.test(clause) ||
    /^if\s+it\s+is\s+not\s+a\s+mana\s+ability$/i.test(clause)
  ) {
    const refFlag = (refs as any)?.activatedAbilityIsManaAbility;
    if (typeof refFlag === 'boolean') return !refFlag;

    const stackItem = (refs as any)?.stackItem;
    if (stackItem) {
      if (typeof stackItem.isManaAbility === 'boolean') return !stackItem.isManaAbility;
      if (typeof (stackItem as any).activatedAbilityIsManaAbility === 'boolean') return !(stackItem as any).activatedAbilityIsManaAbility;
      if (typeof stackItem.type === 'string' && stackItem.type.toLowerCase() === 'mana_ability') return false;
    }

    const stackId =
      (refs as any)?.triggeringStackItemId ??
      (sourcePermanent as any)?.triggeringStackItemId ??
      (sourcePermanent as any)?.triggeringSpellStackItemId;
    if (stackId) {
      const stack: any[] = Array.isArray((ctx as any).state?.stack) ? (ctx as any).state.stack : [];
      const triggering = stack.find((it: any) => it && String(it.id) === String(stackId));
      if (triggering) {
        if (typeof (triggering as any).isManaAbility === 'boolean') return !(triggering as any).isManaAbility;
        if (typeof (triggering as any).activatedAbilityIsManaAbility === 'boolean') return !(triggering as any).activatedAbilityIsManaAbility;
        if (typeof (triggering as any).type === 'string' && String((triggering as any).type).toLowerCase() === 'mana_ability') return false;
      }
    }

    return null;
  }

  // "if it's an opponent's turn" (common shorthand)
  if (/^if\s+(?:it'?s|it\s+is)\s+an\s+opponent'?s\s+turn$/i.test(clause)) {
    const active = getActivePlayerId(ctx);
    if (!active) return null;
    if (String(active) === String(controllerId)) return false;
    const { opponents, unknown } = getOpponentInfo(ctx, controllerId);
    if (unknown) return null;
    return opponents.includes(String(active));
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
      const { opponents, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponents.length) return true;
      return opponents.every((opp) => getPlayerLife(ctx, opp) <= yourLife);
    }

    const oppMore = clause.match(/^if\s+an\s+opponent\s+has\s+more\s+life\s+than\s+you$/i);
    if (oppMore) {
      const yourLife = getPlayerLife(ctx, controllerId);
      const { opponents, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponents.length) return false;
      return opponents.some((opp) => getPlayerLife(ctx, opp) > yourLife);
    }

    const youMoreThanEachOpponent = clause.match(/^if\s+you\s+have\s+more\s+life\s+than\s+each\s+opponent$/i);
    if (youMoreThanEachOpponent) {
      const yourLife = getPlayerLife(ctx, controllerId);
      const { opponents, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponents.length) return true;
      return opponents.every((opp) => yourLife > getPlayerLife(ctx, opp));
    }

    const youMoreThanEachOtherPlayer = clause.match(/^if\s+you\s+have\s+more\s+life\s+than\s+each\s+other\s+player$/i);
    if (youMoreThanEachOtherPlayer) {
      const yourLife = getPlayerLife(ctx, controllerId);
      const others = getOpponentIds(ctx, controllerId);
      if (!others.length) return true;
      return others.every((pid) => yourLife > getPlayerLife(ctx, pid));
    }

    const youMoreThanAn = clause.match(/^if\s+you\s+have\s+more\s+life\s+than\s+an\s+opponent$/i);
    if (youMoreThanAn) {
      const yourLife = getPlayerLife(ctx, controllerId);
      const { opponents, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponents.length) return false;
      return opponents.some((opp) => yourLife > getPlayerLife(ctx, opp));
    }

    const noOppLess = clause.match(/^if\s+no\s+opponent\s+has\s+less\s+life\s+than\s+you$/i);
    if (noOppLess) {
      const yourLife = getPlayerLife(ctx, controllerId);
      const { opponents, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponents.length) return true;
      return opponents.every((opp) => getPlayerLife(ctx, opp) >= yourLife);
    }

    const oppLess = clause.match(/^if\s+an\s+opponent\s+has\s+less\s+life\s+than\s+you$/i);
    if (oppLess) {
      const yourLife = getPlayerLife(ctx, controllerId);
      const { opponents, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponents.length) return false;
      return opponents.some((opp) => getPlayerLife(ctx, opp) < yourLife);
    }

    const youLessThanEachOpponent = clause.match(/^if\s+you\s+have\s+less\s+life\s+than\s+each\s+opponent$/i);
    if (youLessThanEachOpponent) {
      const yourLife = getPlayerLife(ctx, controllerId);
      const { opponents, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponents.length) return true;
      return opponents.every((opp) => yourLife < getPlayerLife(ctx, opp));
    }

    const youLessThanEachOtherPlayer = clause.match(/^if\s+you\s+have\s+less\s+life\s+than\s+each\s+other\s+player$/i);
    if (youLessThanEachOtherPlayer) {
      const yourLife = getPlayerLife(ctx, controllerId);
      const others = getOpponentIds(ctx, controllerId);
      if (!others.length) return true;
      return others.every((pid) => yourLife < getPlayerLife(ctx, pid));
    }

    const youLessThanAn = clause.match(/^if\s+you\s+have\s+less\s+life\s+than\s+an\s+opponent$/i);
    if (youLessThanAn) {
      const yourLife = getPlayerLife(ctx, controllerId);
      const { opponents, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      if (!opponents.length) return false;
      return opponents.some((opp) => yourLife < getPlayerLife(ctx, opp));
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
      const thatPlayerId =
        refs?.thatPlayerId ??
        (sourcePermanent as any)?.thatPlayerId ??
        (sourcePermanent as any)?.referencedPlayerId ??
        (sourcePermanent as any)?.targetPlayerId ??
        getTurnPlayerId(ctx);

      if (typeof thatPlayerId !== 'string' || !thatPlayerId) return null;

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

  return undefined;
}
