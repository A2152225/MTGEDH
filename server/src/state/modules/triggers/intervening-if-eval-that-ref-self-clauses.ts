/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: evaluateInterveningIfClauseInternal "that ..." refs (this-creature / it-wasn't-put ETB)
 * Public: tryEvaluateInterveningIfThatRefSelfClauses
 */

import { parseCountToken, getPlayerLifeMaybe } from "./intervening-if-this-turn-counts.js";
import { findBattlefieldPermanent, getZones, getCounterCountCaseInsensitiveFromPerm } from "./intervening-if-zone-lookups.js";
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

export function tryEvaluateInterveningIfThatRefSelfClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
  const { ctx, controllerId, clause, sourcePermanent, refs } = args;
  // "if this creature didn't attack or come under your control this turn" (best-effort)
  if (/^if\s+this\s+creature\s+didn'?t\s+attack\s+or\s+come\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {
    const thisId = String(
      (sourcePermanent as any)?.id ??
        (refs as any)?.thisCreatureId ??
        (refs as any)?.thisPermanentId ??
        (refs as any)?.sourcePermanentId ??
        ''
    ).trim();
    const p = sourcePermanent ?? (thisId ? findBattlefieldPermanent(ctx, thisId) : null);
    if (!p) return null;

    const attackedFlag = (p as any)?.attackedThisTurn;
    const isAttackingNow =
      !!(p as any)?.attacking ||
      (p as any)?.isAttacking === true ||
      typeof (p as any)?.attacking === 'string' ||
      typeof (p as any)?.attackingTargetId === 'string' ||
      typeof (p as any)?.defendingPlayerId === 'string';
    const attacked = attackedFlag === true || isAttackingNow;
    if (attacked) return false;

    const cameUnder =
      (p as any)?.cameUnderYourControlThisTurn ??
      (p as any)?.gainedControlThisTurn ??
      (p as any)?.cameUnderControlThisTurn ??
      (p as any)?.card?.cameUnderYourControlThisTurn ??
      (p as any)?.card?.gainedControlThisTurn;
    if (cameUnder === true) return false;

    // Entered this turn is positive evidence that it came under your control this turn.
    const enteredThisTurn =
      (p as any)?.enteredThisTurn ??
      (p as any)?.enteredBattlefieldThisTurn ??
      (p as any)?.card?.enteredThisTurn ??
      (p as any)?.card?.enteredBattlefieldThisTurn;
    if (enteredThisTurn === true) return false;

    // If both signals are explicitly false, we can answer true.
    const attackedKnownFalse = typeof attackedFlag === 'boolean' ? attackedFlag === false : null;
    const cameUnderKnownFalse = typeof cameUnder === 'boolean' ? cameUnder === false : null;
    const enteredKnownFalse = typeof enteredThisTurn === 'boolean' ? enteredThisTurn === false : null;
    const cameUnderAllKnownFalse = cameUnderKnownFalse === true && (enteredKnownFalse === true || enteredKnownFalse === null);
    if (attackedKnownFalse === true && cameUnderAllKnownFalse) return true;
    return null;
  }

  // "if that player has N or less life" (requires that-player ref)
  {
    const m = clause.match(/^if\s+that\s+player\s+has\s+([a-z0-9]+)\s+or\s+less\s+life$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const thatPlayerId =
        refs?.thatPlayerId ??
        refs?.referencedPlayerId ??
        refs?.theirPlayerId ??
        (sourcePermanent as any)?.thatPlayerId ??
        (sourcePermanent as any)?.referencedPlayerId ??
        (sourcePermanent as any)?.theirPlayerId;
      if (typeof thatPlayerId !== 'string' || !thatPlayerId) return null;
      const life = getPlayerLifeMaybe(ctx, String(thatPlayerId));
      if (life === null) return null;
      return life <= n;
    }
  }

  // "if a creature died under an opponent's control this turn"
  if (/^if\s+a\s+creature\s+died\s+under\s+an\s+opponent's\s+control\s+this\s+turn$/i.test(clause)) {
    const pid = String(controllerId);
    const diedMap = (ctx as any).state?.creaturesDiedThisTurnByController;
    if (!diedMap || typeof diedMap !== 'object') return null;

    const players = Array.isArray((ctx as any).state?.players) ? (ctx as any).state.players : null;
    if (!players) return null;
    const opponentIds = players
      .map((p: any) => String(p?.id ?? ''))
      .filter((id: string) => id && id !== pid);
    if (opponentIds.length === 0) return false;

    for (const oppId of opponentIds) {
      const v = (diedMap as any)[String(oppId)];
      if (typeof v === 'number' && v > 0) return true;
    }
    return false;
  }

  // "if a/an/another <Subtype> died under your control this turn"
  {
    const m = clause.match(/^if\s+(?:another\s+)?an?\s+([a-z\-]+)\s+died\s+under\s+your\s+control\s+this\s+turn$/i);
    if (m) {
      const pid = String(controllerId);
      const map = (ctx as any).state?.creaturesDiedThisTurnByControllerSubtype;
      if (!map || typeof map !== 'object') return null;

      const subtypeLower = toLower(m[1]);
      const byController = (map as any)[String(pid)];
      if (!byController || typeof byController !== 'object') return false;
      const v = (byController as any)[String(subtypeLower)];
      if (typeof v === 'number') return v >= 1;
      return false;
    }
  }

  // "if <Name> entered this turn" (best-effort)
  {
    const m = clause.match(/^if\s+(.+?)\s+entered\s+this\s+turn$/i);
    if (m) {
      const nameLower = normalizeText(m[1]).toLowerCase();
      const sourceNameLower = normalizeText(String((sourcePermanent as any)?.card?.name ?? (sourcePermanent as any)?.name ?? '')).toLowerCase();

      // Prefer the source permanent when it matches; avoids ambiguity when multiple copies exist.
      const candidates: any[] = [];
      if (sourcePermanent && sourceNameLower === nameLower) candidates.push(sourcePermanent);

      if (candidates.length === 0) {
        const battlefield = (ctx as any).state?.battlefield;
        if (!Array.isArray(battlefield)) return null;
        const matches = battlefield.filter(
          (p: any) => normalizeText(String(p?.card?.name ?? p?.name ?? '')).toLowerCase() === nameLower
        );
        if (matches.length === 0) return false;
        if (matches.length !== 1) return null;
        candidates.push(matches[0]);
      }

      const p = candidates[0];
      const entered =
        (p as any)?.enteredThisTurn ??
        (p as any)?.enteredBattlefieldThisTurn ??
        (p as any)?.card?.enteredThisTurn ??
        (p as any)?.card?.enteredBattlefieldThisTurn;
      if (typeof entered === 'boolean') return entered;

      // Replay-stable fallback: per-type ETB id trackers (only when available).
      const controllerId = String((p as any)?.controller ?? (p as any)?.card?.controller ?? '').trim();
      const pid = String((p as any)?.id ?? (p as any)?.card?.id ?? '').trim();
      const tl = String((p as any)?.card?.type_line ?? (p as any)?.card?.typeLine ?? (p as any)?.type_line ?? '').toLowerCase();
      if (!controllerId || !pid || !tl) return null;

      const stateAny = (ctx as any).state;
      const mapCandidates: any[] = [];
      if (tl.includes('creature')) mapCandidates.push(stateAny?.creaturesEnteredBattlefieldThisTurnIdsByController);
      if (tl.includes('artifact')) mapCandidates.push(stateAny?.artifactsEnteredBattlefieldThisTurnIdsByController);
      if (tl.includes('enchantment')) mapCandidates.push(stateAny?.enchantmentsEnteredBattlefieldThisTurnIdsByController);
      if (tl.includes('planeswalker')) mapCandidates.push(stateAny?.planeswalkersEnteredBattlefieldThisTurnIdsByController);
      if (tl.includes('battle')) mapCandidates.push(stateAny?.battlesEnteredBattlefieldThisTurnIdsByController);

      for (const map of mapCandidates) {
        if (!map || typeof map !== 'object') continue;
        const byController = (map as any)[controllerId];
        if (byController && typeof byController === 'object') return !!(byController as any)[pid];
        // Tracker exists but no entries for this controller => definitely didn't enter this turn.
        return false;
      }

      return null;
    }
  }

  // "if <Name> has counters on it" (best-effort)
  {
    const m = clause.match(/^if\s+(.+?)\s+has\s+counters\s+on\s+it$/i);
    if (m) {
      const nameLower = normalizeText(m[1]).toLowerCase();
      const sourceNameLower = normalizeText(String((sourcePermanent as any)?.card?.name ?? (sourcePermanent as any)?.name ?? '')).toLowerCase();
      let p: any | null = null;

      if (sourcePermanent && sourceNameLower === nameLower) {
        p = sourcePermanent as any;
      } else {
        const battlefield = (ctx as any).state?.battlefield;
        if (!Array.isArray(battlefield)) return null;
        const matches = battlefield.filter(
          (q: any) => normalizeText(String(q?.card?.name ?? q?.name ?? '')).toLowerCase() === nameLower
        );
        if (matches.length === 0) return false;
        if (matches.length !== 1) return null;
        p = matches[0];
      }

      const counters = (p as any)?.counters ?? (p as any)?.card?.counters;
      if (counters && typeof counters === 'object') {
        const total: number = (Object.values(counters as Record<string, unknown>) as unknown[]).reduce<number>(
          (sum: number, v: unknown) => sum + (typeof v === 'number' ? v : 0),
          0
        );
        return total > 0;
      }

      // If the object omits the counters map entirely, only treat that as 0 when
      // we have evidence counters tracking exists on the battlefield.
      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;
      const hasAnyCountersObject = battlefield.some((q: any) => q && (q as any).counters && typeof (q as any).counters === 'object');
      if (!hasAnyCountersObject) return null;
      return false;
    }
  }

  // "if he/she/it was cast" and "if this <thing> was cast" (best-effort)
  {
    const m = clause.match(/^if\s+(?:he|she|it|this\s+(?:spell|creature|card))\s+was\s+cast$/i);
    if (m) {
      const raw =
        (refs as any)?.wasCast ??
        (refs as any)?.enteredFromCast ??
        (sourcePermanent as any)?.enteredFromCast ??
        (sourcePermanent as any)?.wasCast ??
        (sourcePermanent as any)?.card?.enteredFromCast ??
        (sourcePermanent as any)?.card?.wasCast;
      if (typeof raw === 'boolean') return raw;

      // If we at least know the source zone of the cast, that's enough to conclude it was cast.
      const castSourceZone =
        (refs as any)?.castSourceZone ??
        (refs as any)?.fromZone ??
        (refs as any)?.source ??
        (sourcePermanent as any)?.castSourceZone ??
        (sourcePermanent as any)?.fromZone ??
        (sourcePermanent as any)?.source ??
        (sourcePermanent as any)?.card?.castSourceZone ??
        (sourcePermanent as any)?.card?.fromZone ??
        (sourcePermanent as any)?.card?.source;
      if (typeof castSourceZone === 'string' && castSourceZone.trim().length > 0) return true;

      // Any explicit cast provenance flag implies it was cast (even if it wasn't cast from that specific zone).
      const fromHand = (refs as any)?.castFromHand ?? (sourcePermanent as any)?.castFromHand ?? (sourcePermanent as any)?.card?.castFromHand;
      const fromExile = (refs as any)?.castFromExile ?? (sourcePermanent as any)?.castFromExile ?? (sourcePermanent as any)?.card?.castFromExile;
      const fromGraveyard =
        (refs as any)?.castFromGraveyard ??
        (sourcePermanent as any)?.castFromGraveyard ??
        (sourcePermanent as any)?.card?.castFromGraveyard;
      const fromForetell =
        (refs as any)?.castFromForetell ??
        (sourcePermanent as any)?.castFromForetell ??
        (sourcePermanent as any)?.card?.castFromForetell ??
        (refs as any)?.foretold ??
        (sourcePermanent as any)?.foretold ??
        (sourcePermanent as any)?.card?.foretold;
      const fromSuspend = (refs as any)?.wasCastFromSuspend ?? (sourcePermanent as any)?.wasCastFromSuspend ?? (sourcePermanent as any)?.card?.wasCastFromSuspend;

      if (
        typeof fromHand === 'boolean' ||
        typeof fromExile === 'boolean' ||
        typeof fromGraveyard === 'boolean' ||
        typeof fromForetell === 'boolean' ||
        typeof fromSuspend === 'boolean'
      )
        return true;

      return null;
    }
  }

  // "if <Name> is a creature" (best-effort)
  {
    const m = clause.match(/^if\s+(.+?)\s+is\s+a\s+creature$/i);
    if (m) {
      const nameLower = normalizeText(m[1]).toLowerCase();
      const sourceNameLower = normalizeText(String((sourcePermanent as any)?.card?.name ?? (sourcePermanent as any)?.name ?? '')).toLowerCase();
      let p: any | null = null;

      if (sourcePermanent && sourceNameLower === nameLower) {
        p = sourcePermanent as any;
      } else {
        const battlefield = (ctx as any).state?.battlefield;
        if (!Array.isArray(battlefield)) return null;
        const matches = battlefield.filter(
          (q: any) => normalizeText(String(q?.card?.name ?? q?.name ?? '')).toLowerCase() === nameLower
        );
        if (matches.length === 0) return false;
        if (matches.length !== 1) return null;
        p = matches[0];
      }

      const tl = String((p as any)?.card?.type_line ?? (p as any)?.card?.typeLine ?? (p as any)?.type_line ?? '').toLowerCase();
      if (tl) return tl.includes('creature');
      const types = (p as any)?.card?.types;
      if (Array.isArray(types)) return types.map((t: any) => String(t).toLowerCase()).includes('creature');
      return null;
    }
  }

  // "if <Name> is in exile with an <counter> counter on it" (best-effort)
  {
    const m = clause.match(/^if\s+(.+?)\s+is\s+in\s+exile\s+with\s+an?\s+([a-z\-]+)\s+counter\s+on\s+it$/i);
    if (m) {
      const nameLower = normalizeText(m[1]).toLowerCase();
      const counterName = String(m[2] || '').toLowerCase();
      const zones = getZones(ctx);
      if (!zones || typeof zones !== 'object') return null;

      const stateAny = (ctx as any).state as any;
      const playerIds = Array.isArray(stateAny?.players)
        ? (stateAny.players as any[]).map((p: any) => String(p?.id || '')).filter(Boolean)
        : [];
      const hasFullyTrackedExile = playerIds.length > 0 && playerIds.every((pid: string) => Array.isArray((zones as any)?.[pid]?.exile));

      // Only treat missing counters maps as 0 when we have evidence counters tracking exists.
      let hasAnyCountersObject = false;
      try {
        const battlefield = (ctx as any).state?.battlefield;
        if (Array.isArray(battlefield) && battlefield.some((p: any) => p && (p as any).counters && typeof (p as any).counters === 'object')) {
          hasAnyCountersObject = true;
        }
      } catch {
        // ignore
      }
      if (!hasAnyCountersObject) {
        try {
          for (const z of Object.values(zones as any)) {
            const exile = (z as any)?.exile;
            if (!Array.isArray(exile)) continue;
            if (exile.some((c: any) => c && ((c as any).counters && typeof (c as any).counters === 'object' || (c as any)?.card?.counters && typeof (c as any).card.counters === 'object'))) {
              hasAnyCountersObject = true;
              break;
            }
          }
        } catch {
          // ignore
        }
      }

      const getCounterCountBestEffort = (obj: any): number | null => {
        const n = getCounterCountCaseInsensitiveFromPerm(obj, counterName);
        if (typeof n === 'number') return n;
        const cardCounters = obj?.card?.counters;
        if (cardCounters && typeof cardCounters === 'object') {
          const pseudo = { counters: cardCounters };
          const n2 = getCounterCountCaseInsensitiveFromPerm(pseudo, counterName);
          if (typeof n2 === 'number') return n2;
        }
        return null;
      };

       // Optional disambiguation: if caller provides a specific exile object id,
       // we can evaluate that exact object (but we still fall back to name search
       // if it isn't found / doesn't match).
       const explicitExileId = String(
         (refs as any)?.exiledCardId ??
           (refs as any)?.exiledPermanentId ??
           (refs as any)?.itCardId ??
           (refs as any)?.itPermanentId ??
           (refs as any)?.thatCardId ??
           (refs as any)?.thatPermanentId ??
           ''
       ).trim();
       if (explicitExileId) {
         const explicitFound: any[] = [];
         for (const z of Object.values(zones as any)) {
           const exile = (z as any)?.exile;
           if (!Array.isArray(exile)) continue;
           for (const c of exile) {
             const cid = String(c?.id ?? c?.card?.id ?? c?.cardId ?? '').trim();
             if (cid && cid === explicitExileId) explicitFound.push(c);
           }
         }
         if (explicitFound.length === 1) {
           const cn = normalizeText(String(explicitFound[0]?.card?.name ?? explicitFound[0]?.name ?? '')).toLowerCase();
           if (cn && cn === nameLower) {
              const n = getCounterCountBestEffort(explicitFound[0]);
              if (n === null) return hasAnyCountersObject ? false : null;
              return n > 0;
           }
           // Mismatched name: caller-provided id doesn't correspond to this template.
           // Fall through to name-based evaluation.
         }
       }

        let sawAnyExileArray = false;
      const found: any[] = [];
      for (const z of Object.values(zones as any)) {
        const exile = (z as any)?.exile;
        if (!Array.isArray(exile)) continue;
          sawAnyExileArray = true;
        for (const c of exile) {
          const cn = normalizeText(String(c?.card?.name ?? c?.name ?? '')).toLowerCase();
          if (cn && cn === nameLower) found.push(c);
        }
      }

        if (found.length === 0) {
          if (hasFullyTrackedExile) return false;
          return sawAnyExileArray ? null : null;
        }

      // If multiple copies exist in exile, the condition is satisfied if ANY has the counter.
      // Only return false if we can deterministically see that none do.
      let sawUnknown = false;
      for (const card of found) {
          const nRaw = getCounterCountBestEffort(card);
          const n = nRaw === null && hasAnyCountersObject ? 0 : nRaw;
          if (n === null) {
            sawUnknown = true;
            continue;
          }
        if (n > 0) return true;
      }
      return sawUnknown ? null : false;
    }
  }

  // "if it had a counter on it" (best-effort)
  if (/^if\s+it\s+had\s+a\s+counter\s+on\s+it$/i.test(clause)) {
    // First preference: explicit object snapshots passed in refs.
    const refObjCandidates: any[] = [];
    try {
      const r: any = refs as any;
      if (r?.itPermanent) refObjCandidates.push(r.itPermanent);
      if (r?.itCreature) refObjCandidates.push(r.itCreature);
      if (r?.thatPermanent) refObjCandidates.push(r.thatPermanent);
      if (r?.thatCreature) refObjCandidates.push(r.thatCreature);
      if (r?.it) refObjCandidates.push(r.it);
      if (r?.that) refObjCandidates.push(r.that);
    } catch {
      // ignore
    }

    for (const obj of refObjCandidates) {
      const counters = (obj as any)?.counters ?? (obj as any)?.card?.counters;
      if (!counters || typeof counters !== 'object') continue;
      const total: number = (Object.values(counters as Record<string, unknown>) as unknown[]).reduce<number>(
        (sum: number, v: unknown) => sum + (typeof v === 'number' ? v : 0),
        0
      );
      return total > 0;
    }

    // Prefer the object we're evaluating this clause on when it has explicit counter tracking.
    // (In the audit probe, refs contains unrelated `thatCreatureId` fields that would otherwise mislead this clause.)
    const hasCountersOnSource =
      !!sourcePermanent &&
      (sourcePermanent as any)?.counters &&
      typeof (sourcePermanent as any)?.counters === 'object';

    const explicitItId = (refs as any)?.itPermanentId ?? (refs as any)?.itCreatureId;
    const fallbackId = (refs as any)?.thatPermanentId ?? (refs as any)?.thatCardId ?? (refs as any)?.thatCreatureId;

    const perm =
      (typeof explicitItId === 'string' && explicitItId ? findBattlefieldPermanent(ctx, explicitItId) : null) ??
      (hasCountersOnSource ? sourcePermanent : (typeof fallbackId === 'string' && fallbackId ? findBattlefieldPermanent(ctx, fallbackId) : null)) ??
      sourcePermanent;
    if (!perm) return null;
    const counters = (perm as any)?.counters ?? (perm as any)?.card?.counters;
    if (!counters || typeof counters !== 'object') return null;
    const total: number = (Object.values(counters as Record<string, unknown>) as unknown[]).reduce<number>(
      (sum: number, v: unknown) => sum + (typeof v === 'number' ? v : 0),
      0
    );
    return total > 0;
  }

  // "if it didn't die" (best-effort)
  if (/^if\s+it\s+didn'?t\s+die$/i.test(clause)) {
    // Optional: if the trigger system supplies a concrete "it" id, we can use
    // replay-stable evidence to reduce nulls.
    const itId = String(
      (refs as any)?.itPermanentId ??
        (refs as any)?.itCreatureId ??
        (refs as any)?.thatPermanentId ??
        (refs as any)?.thatCreatureId ??
        ''
    ).trim();

    if (itId) {
      // Positive evidence: still on the battlefield => it didn't die.
      const stillOnBattlefield = findBattlefieldPermanent(ctx, itId);
      if (stillOnBattlefield) return true;

      // Negative evidence (creatures only): if we recorded this creature as dying this turn,
      // then "it didn't die" is definitively false.
      const diedIds: any = (ctx as any).state?.creaturesDiedThisTurnIds;
      if (Array.isArray(diedIds) && diedIds.includes(itId)) return false;

      // Otherwise ambiguous (could have been bounced/exiled, etc.)
    }

    const died =
      (refs as any)?.itDied ??
      (refs as any)?.died ??
      (refs as any)?.thatCreatureDied ??
      (refs as any)?.wasPutIntoGraveyard;
    return typeof died === 'boolean' ? !died : null;
  }

  // "if it wasn't sacrificed" (best-effort)
  if (/^if\s+it\s+wasn'?t\s+sacrificed$/i.test(clause)) {
    const wasSacrificed =
      (refs as any)?.wasSacrificed ??
      (refs as any)?.itWasSacrificed ??
      (refs as any)?.thatPermanentWasSacrificed;
    return typeof wasSacrificed === 'boolean' ? !wasSacrificed : null;
  }

  // "if equipped creature didn't deal combat damage to a creature this turn"
  if (/^if\s+equipped\s+creature\s+didn'?t\s+deal\s+combat\s+damage\s+to\s+a\s+creature\s+this\s+turn$/i.test(clause)) {
    const equipmentId = String(
      (sourcePermanent as any)?.id ??
        (refs as any)?.thisPermanentId ??
        (refs as any)?.sourcePermanentId ??
        ''
    ).trim();
    const equipment = sourcePermanent ?? (equipmentId ? findBattlefieldPermanent(ctx, equipmentId) : null);
    if (!equipment) return null;

    const equippedId =
      (refs as any)?.equippedCreatureId ??
      (equipment as any)?.attachedTo ??
      (equipment as any)?.equippedCreatureId;
    if (typeof equippedId !== 'string' || !equippedId) return null;

    // Prefer the per-turn creature->creature combat damage tracker when available.
    // Tracker shape: state.creaturesDamagedByThisCreatureThisTurn: { [sourceId]: { [victimId]: true } }
    const damaged = (ctx as any).state?.creaturesDamagedByThisCreatureThisTurn;
    if (damaged && typeof damaged === 'object') {
      const victims = (damaged as any)[String(equippedId)];
      if (victims && typeof victims === 'object') {
        const didDealToCreature = Object.keys(victims as any).length > 0;
        return !didDealToCreature;
      }
      // No recorded victims this turn => didn't deal combat damage to a creature.
      return true;
    }

    // Fallback: best-effort legacy flags on the equipped creature (if present).
    const equipped = findBattlefieldPermanent(ctx, equippedId);
    if (!equipped) return null;
    const raw =
      (equipped as any)?.dealtCombatDamageToCreatureThisTurn ??
      (equipped as any)?.dealtCombatDamageToCreature ??
      (equipped as any)?.dealtCombatDamageToCreatureThisCombat;
    return typeof raw === 'boolean' ? !raw : null;
  }

  

  // "if Ring Out is in your library"
  if (/^if\s+ring\s+out\s+is\s+in\s+your\s+library$/i.test(clause)) {
    const zones = getZones(ctx);
    if (!zones || typeof zones !== 'object') return null;
    const z = (zones as any)[String(controllerId)];
    const lib = z?.library;
    if (!Array.isArray(lib)) return null;
    const found = lib.some((c: any) => normalizeText(String(c?.card?.name ?? c?.name ?? '')).toLowerCase() === 'ring out');
    return found;
  }

  // "if it wasn't put onto the battlefield with this ability" (best-effort; requires refs)
  if (/^if\s+it\s+wasn'?t\s+put\s+onto\s+the\s+battlefield\s+with\s+this\s+ability$/i.test(clause)) {
    const raw =
      (refs as any)?.wasPutOntoBattlefieldWithThisAbility ??
      (refs as any)?.putOntoBattlefieldWithThisAbility ??
      (refs as any)?.wasPutOntoBattlefieldThisWay;
    return typeof raw === 'boolean' ? !raw : null;
  }

  return undefined;
}
