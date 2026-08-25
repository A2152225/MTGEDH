/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: evaluateInterveningIfClauseInternal "that ..." reference templates (first slice)
 * Public: tryEvaluateInterveningIfThatRefEarlyClauses
 */

import { detectLinkedExileEffect } from "./linked-exile.js";
import { parseCountToken, getPlayerLifeMaybe, getPoisonCounters, countLandsWithSubtype, getStartingLifeTotal } from "./intervening-if-this-turn-counts.js";
import { findBattlefieldPermanent, getCounterCountCaseInsensitiveFromPerm, getZones, typeLineHasWord, parseMaybeNumber } from "./intervening-if-zone-lookups.js";
import {
  getPermanentPowerMaybe,
  getPermanentToughnessMaybe,
  getAttackersDeclaredThisCombat,
  getOpponentInfo,
  getSpellsCastThisTurn,
  getSpellsCastThisTurnByPlayerCount,
} from "./intervening-if-permanent-and-player.js";
import { getTriggeringStackItemForInterveningIf } from "./intervening-if-eval-support.js";
import type { InterveningIfPhaseArgs, InterveningIfInternalResult } from "./intervening-if-eval-support.js";

function normalizeText(text: string): string {
  return String(text || "")
    .replace(/[’]/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tryEvaluateInterveningIfThatRefEarlyClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
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
  // ===== "that ..." reference templates (best-effort; require refs or tracked state) =====
  // "if that creature is still on the battlefield"
  if (/^if\s+that\s+creature\s+is\s+still\s+on\s+the\s+battlefield$/i.test(clause)) {
    const thatId = (refs as any)?.thatCreatureId ?? (refs as any)?.referencedCreatureId ?? (sourcePermanent as any)?.thatCreatureId;
    if (typeof thatId !== 'string' || !thatId) return null;
    return !!findBattlefieldPermanent(ctx, thatId);
  }

  // "if that creature is 1/1"
  if (/^if\s+that\s+creature\s+is\s+1\/1$/i.test(clause)) {
    const thatId = (refs as any)?.thatCreatureId ?? (refs as any)?.referencedCreatureId ?? (sourcePermanent as any)?.thatCreatureId;
    if (typeof thatId !== 'string' || !thatId) return null;
    const that = findBattlefieldPermanent(ctx, thatId);
    if (!that) return null;
    const p = getPermanentPowerMaybe(that, ctx);
    const t = getPermanentToughnessMaybe(that, ctx);
    if (p === null || t === null) return null;
    return p === 1 && t === 1;
  }

  // "if that creature entered from a graveyard or you cast it from a graveyard"
  if (/^if\s+that\s+creature\s+entered\s+from\s+a\s+graveyard\s+or\s+you\s+cast\s+it\s+from\s+a\s+graveyard$/i.test(clause)) {
    const thatId = (refs as any)?.thatCreatureId ?? (refs as any)?.referencedCreatureId ?? (sourcePermanent as any)?.thatCreatureId;
    const that = typeof thatId === 'string' && thatId ? findBattlefieldPermanent(ctx, thatId) : null;
    const enteredFrom = String((that as any)?.enteredFromZone ?? (that as any)?.enteredFrom ?? (that as any)?.card?.enteredFromZone ?? '').toLowerCase();
    const fromEntered = enteredFrom === 'graveyard';
    const fromCast = (refs as any)?.wasCastFromGraveyard;
    if (fromEntered) return true;
    if (typeof fromCast === 'boolean') return fromCast;
    return that ? false : null;
  }

  // "if that creature has greater power or toughness than this creature"
  if (/^if\s+that\s+creature\s+has\s+greater\s+power\s+or\s+toughness\s+than\s+this\s+creature$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const thatId = (refs as any)?.thatCreatureId ?? (refs as any)?.referencedCreatureId ?? (sourcePermanent as any)?.thatCreatureId;
    if (typeof thatId !== 'string' || !thatId) return null;
    const that = findBattlefieldPermanent(ctx, thatId);
    if (!that) return null;
    const tp = getPermanentPowerMaybe(that, ctx);
    const tt = getPermanentToughnessMaybe(that, ctx);
    const sp = getPermanentPowerMaybe(thisPermanentForSelfClauses, ctx);
    const st = getPermanentToughnessMaybe(thisPermanentForSelfClauses, ctx);
    if (tp === null || tt === null || sp === null || st === null) return null;
    return tp > sp || tt > st;
  }

  // "if that creature's power is greater than this creature's"
  if (/^if\s+that\s+creature'?s\s+power\s+is\s+greater\s+than\s+this\s+creature'?s$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const thatId = (refs as any)?.thatCreatureId ?? (refs as any)?.referencedCreatureId ?? (sourcePermanent as any)?.thatCreatureId;
    if (typeof thatId !== 'string' || !thatId) return null;
    const that = findBattlefieldPermanent(ctx, thatId);
    if (!that) return null;
    const tp = getPermanentPowerMaybe(that, ctx);
    const sp = getPermanentPowerMaybe(thisPermanentForSelfClauses, ctx);
    if (tp === null || sp === null) return null;
    return tp > sp;
  }

  // "if that creature was destroyed this way" (best-effort; requires explicit refs)
  if (/^if\s+that\s+creature\s+was\s+destroyed\s+this\s+way$/i.test(clause)) {
    const raw = (refs as any)?.thatCreatureDestroyedThisWay ?? (refs as any)?.destroyedThisWay;
    return typeof raw === 'boolean' ? raw : null;
  }

  // "if that creature was a Horror" (best-effort)
  if (/^if\s+that\s+creature\s+was\s+a\s+horror$/i.test(clause)) {
    // Prefer explicit object snapshots passed in refs (replay-stable even if the creature left the battlefield).
    const refObjCandidates: any[] = [];
    try {
      const r: any = refs as any;
      if (r?.thatCreature) refObjCandidates.push(r.thatCreature);
      if (r?.thatPermanent) refObjCandidates.push(r.thatPermanent);
      if (r?.that) refObjCandidates.push(r.that);
    } catch {
      // ignore
    }

    for (const obj of refObjCandidates) {
      const tlRaw = (obj as any)?.card?.type_line ?? (obj as any)?.type_line ?? (obj as any)?.card?.typeLine ?? (obj as any)?.typeLine;
      const tl = String(tlRaw || '').toLowerCase();
      if (!tl) continue;
      return typeLineHasWord(tl, 'horror');
    }

    const thatId = (refs as any)?.thatCreatureId ?? (refs as any)?.referencedCreatureId ?? (sourcePermanent as any)?.thatCreatureId;
    if (typeof thatId !== 'string' || !thatId) return null;
    const that = findBattlefieldPermanent(ctx, thatId);
    if (!that) return null;
    const tl = String((that as any)?.card?.type_line || '').toLowerCase();
    if (!tl) return null;
    return typeLineHasWord(tl, 'horror');
  }

  // "if that card is on the battlefield" / "if that card is still exiled"
  if (/^if\s+that\s+card\s+is\s+on\s+the\s+battlefield$/i.test(clause) || /^if\s+that\s+card\s+is\s+still\s+exiled$/i.test(clause)) {
    const targetZone = /^if\s+that\s+card\s+is\s+still\s+exiled$/i.test(clause) ? 'exile' : 'battlefield';
    const thatCardId = String((refs as any)?.thatCardId ?? (refs as any)?.thatCard?.id ?? (refs as any)?.thatCardCardId ?? '').trim();
    if (!thatCardId) return null;

    if (targetZone === 'battlefield') {
      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;
      return battlefield.some((p: any) => String(p?.card?.id ?? p?.cardId ?? p?.id ?? '') === thatCardId);
    }

    const zones = (ctx as any).state?.zones;
    if (!zones || typeof zones !== 'object') return null;
    for (const z of Object.values(zones as any)) {
      const exile = (z as any)?.exile;
      if (!Array.isArray(exile)) continue;
      if (exile.some((c: any) => String(c?.id ?? c?.card?.id ?? c?.cardId ?? '') === thatCardId)) return true;
    }
    return false;
  }

  // "if that player controls a Plains"
  if (/^if\s+that\s+player\s+controls\s+a\s+plains$/i.test(clause)) {
    const thatPlayerId = String((refs as any)?.thatPlayerId ?? (refs as any)?.referencedPlayerId ?? (refs as any)?.theirPlayerId ?? '').trim();
    if (!thatPlayerId) return null;
    return countLandsWithSubtype(ctx, thatPlayerId, 'plains') > 0;
  }

  // "if that player didn't cast a spell this turn"
  if (/^if\s+that\s+player\s+didn'?t\s+cast\s+a\s+spell\s+this\s+turn$/i.test(clause)) {
    const thatPlayerId = String((refs as any)?.thatPlayerId ?? (refs as any)?.referencedPlayerId ?? (refs as any)?.theirPlayerId ?? '').trim();
    if (!thatPlayerId) return null;
    return getSpellsCastThisTurnByPlayerCount(ctx, thatPlayerId) === 0;
  }

  // "if that player didn't cast a creature spell this turn"
  if (/^if\s+that\s+player\s+didn'?t\s+cast\s+a\s+creature\s+spell\s+this\s+turn$/i.test(clause)) {
    const thatPlayerId = String((refs as any)?.thatPlayerId ?? (refs as any)?.referencedPlayerId ?? (refs as any)?.theirPlayerId ?? '').trim();
    if (!thatPlayerId) return null;
    const spells = getSpellsCastThisTurn(ctx).filter((s: any) => String(s?.casterId ?? s?.controller ?? '') === thatPlayerId);
    if (spells.length === 0) return true;

    let sawUnknownType = false;
    for (const s of spells) {
      const tl = String(s?.card?.type_line ?? s?.type_line ?? '').toLowerCase();
      if (!tl) {
        sawUnknownType = true;
        continue;
      }
      if (tl.includes('creature')) return false;
    }

    return sawUnknownType ? null : true;
  }

  // "if that opponent has more life than another of your opponents"
  if (/^if\s+that\s+opponent\s+has\s+more\s+life\s+than\s+another\s+of\s+your\s+opponents$/i.test(clause)) {
    const thatOpponentId = String((refs as any)?.thatPlayerId ?? (refs as any)?.referencedPlayerId ?? '').trim();
    if (!thatOpponentId) return null;
    const { opponents, unknown } = getOpponentInfo(ctx, controllerId);
    if (unknown) return null;
    if (!opponents.length || !opponents.includes(thatOpponentId)) return false;
    const thatLife = getPlayerLifeMaybe(ctx, thatOpponentId);
    if (thatLife === null) return null;
    return opponents.some((oid) => oid !== thatOpponentId && (() => {
      const ol = getPlayerLifeMaybe(ctx, oid);
      return ol !== null && thatLife > ol;
    })());
  }

  // "if that player has less than half their starting life total"
  if (/^if\s+that\s+player\s+has\s+less\s+than\s+half\s+their\s+starting\s+life\s+total$/i.test(clause)) {
    const thatPlayerId = String((refs as any)?.thatPlayerId ?? (refs as any)?.referencedPlayerId ?? (refs as any)?.theirPlayerId ?? '').trim();
    if (!thatPlayerId) return null;
    const life = getPlayerLifeMaybe(ctx, thatPlayerId);
    if (life === null) return null;
    const starting = getStartingLifeTotal(ctx);
    return life < starting / 2;
  }

  // "if life was paid to activate it" (best-effort; requires explicit refs)
  if (/^if\s+life\s+was\s+paid\s+to\s+activate\s+it$/i.test(clause)) {
    const raw = (refs as any)?.lifeWasPaidToActivateIt ?? (refs as any)?.lifePaidToActivateIt;
    if (typeof raw === 'boolean') return raw;

    // Positive-only fallback: if the triggering stack item contains explicit activated-ability
    // cost text that *requires* paying life (e.g., "Pay 2 life:" or "{T}, Pay X life:"),
    // we can conclude true.
    //
    // Keep null for ambiguous costs like "Pay 2 life or {B}:" (choice-dependent).
    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
    if (!item) return null;
    const abilityTextRaw = String(
      (item as any)?.abilityText ??
        (item as any)?.activatedAbilityText ??
        (item as any)?.description ??
        ''
    ).trim();
    if (!abilityTextRaw) return null;

    const colonIdx = abilityTextRaw.indexOf(':');
    if (colonIdx <= 0) return null;
    const costPart = abilityTextRaw.slice(0, colonIdx).toLowerCase();

    // If the cost is presented as a choice, we can't know whether life was paid.
    if (/\bor\b/i.test(costPart)) return null;
    if (/\bmay\s+pay\b/i.test(costPart)) return null;

    if (/\bpay\s+([0-9]+|x)\s+life\b/i.test(costPart)) return true;
    return null;
  }

  // "if that spell's mana cost or that ability's activation cost contains {X}"
  if (/^if\s+that\s+spell'?s\s+mana\s+cost\s+or\s+that\s+ability'?s\s+activation\s+cost\s+contains\s+\{x\}$/i.test(clause)) {
    const raw = (refs as any)?.costContainsX ?? (refs as any)?.manaCostContainsX;
    if (typeof raw === 'boolean') return raw;

    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
    if (!item) return null;

    // Spell mana cost path.
    const manaCost = String(item?.card?.mana_cost ?? item?.card?.manaCost ?? '').toLowerCase();
    if (manaCost) return manaCost.includes('{x}');

    // Activated ability activation-cost path (best-effort): only treat as cost text
    // when the text clearly starts with a cost like "{2}{G}{G}:" or "{X}, {T}:".
    const abilityTextRaw = String((item as any)?.abilityText ?? (item as any)?.activatedAbilityText ?? (item as any)?.description ?? '').trim();
    if (!abilityTextRaw.startsWith('{')) return null;
    const colonIdx = abilityTextRaw.indexOf(':');
    if (colonIdx <= 0) return null;
    const costPart = abilityTextRaw.slice(0, colonIdx).toLowerCase();
    return costPart.includes('{x}');
  }

  // "if one or more players being attacked are poisoned"
  if (/^if\s+one\s+or\s+more\s+players\s+being\s+attacked\s+are\s+poisoned$/i.test(clause)) {
    // Prefer per-combat tracking. This is replay-stable and treats attacks on planeswalkers/battles
    // as attacks on their controller (i.e., the defending player).
    const tracked = (ctx as any).state?.attackedDefendingPlayersThisCombatByPlayer;
    if (tracked && typeof tracked === 'object') {
      const attacked = new Set<string>();
      let sawAnyList = false;
      for (const v of Object.values(tracked as any)) {
        if (!Array.isArray(v)) continue;
        sawAnyList = true;
        for (const pid of v) {
          const id = String(pid || '').trim();
          if (id) attacked.add(id);
        }
      }

      if (!sawAnyList) return null;
      if (attacked.size === 0) return false;
      return Array.from(attacked).some((pid) => getPoisonCounters(ctx, pid) > 0);
    }

    // Fallback: derive attacked players from battlefield attacker objects.
    // If attackers are aiming at a permanent id (planeswalker/battle), resolve its controller.
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;

    const attacked = new Set<string>();
    let sawAttacker = false;
    let sawUnknown = false;

    for (const p of battlefield) {
      if (!p) continue;
      const a = (p as any)?.attacking;
      if (typeof a !== 'string' || !a) continue;

      sawAttacker = true;
      const target = String(a).trim();
      if (!target) continue;

      if (target.startsWith('perm_')) {
        const targetPerm = battlefield.find((q: any) => q && String(q?.id ?? '').trim() === target);
        const controller = String((targetPerm as any)?.controller ?? '').trim();
        if (controller) attacked.add(controller);
        else sawUnknown = true;
      } else {
        attacked.add(target);
      }
    }

    if (attacked.size > 0) {
      if (Array.from(attacked).some((pid) => getPoisonCounters(ctx, pid) > 0)) return true;
      return sawUnknown ? null : false;
    }

    return sawAttacker && sawUnknown ? null : false;
  }

  // "if you attacked with exactly one other creature this combat"
  if (/^if\s+you\s+attacked\s+with\s+exactly\s+one\s+other\s+creature\s+this\s+combat$/i.test(clause)) {
    const srcId = String(
      (sourcePermanent as any)?.id ??
        (refs as any)?.thisCreatureId ??
        (refs as any)?.thisPermanentId ??
        (refs as any)?.thisId ??
        (refs as any)?.sourcePermanentId ??
        ''
    ).trim();
    if (!srcId) return null;

    const map = (ctx as any).state?.attackersDeclaredThisCombatByPlayer;
    const hasTracking = !!map && Object.prototype.hasOwnProperty.call(map, String(controllerId));
    if (!hasTracking) return null;

    const entries = getAttackersDeclaredThisCombat(ctx, String(controllerId));
    const otherCount = entries.filter((e: any) => String(e?.id ?? e?.permanentId ?? '').trim() && String(e?.id ?? e?.permanentId ?? '').trim() !== srcId).length;
    return otherCount === 1;
  }

  // "if that spell targets only this creature" (best-effort: uses triggering stack item targets)
  if (/^if\s+that\s+spell\s+targets\s+only\s+this\s+creature$/i.test(clause)) {
    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
    if (!item) return null;

    const thisId = String(
      (sourcePermanent as any)?.id ??
        (refs as any)?.thisCreatureId ??
        (refs as any)?.thisPermanentId ??
        (refs as any)?.thisId ??
        (refs as any)?.sourcePermanentId ??
        ''
    ).trim();
    if (!thisId) return null;

    const extractTargetId = (t: any): string | null => {
      if (t == null) return null;
      if (typeof t === 'string' || typeof t === 'number') {
        const s = String(t).trim();
        if (!s || s === 'undefined' || s === 'null') return null;
        return s;
      }
      if (typeof t === 'object') {
        const raw =
          (t as any).id ??
          (t as any).targetId ??
          (t as any).permanentId ??
          (t as any).playerId ??
          (t as any).sourceId;
        if (raw == null) return null;
        const s = String(raw).trim();
        if (!s || s === 'undefined' || s === 'null') return null;
        return s;
      }
      return null;
    };

    const targets: any[] | null = Array.isArray((item as any).targets)
      ? (item as any).targets
      : Array.isArray((item as any).targetIds)
        ? (item as any).targetIds
        : null;

    if (targets) {
      const ids: string[] = [];
      for (const t of targets) {
        const tid = extractTargetId(t);
        if (!tid) return null;
        ids.push(tid);
      }

      if (!ids.includes(thisId)) return false;
      return ids.every((id) => id === thisId);
    }

    const single = (item as any).targetId ?? (item as any).target;
    if (single !== undefined && single !== null) {
      const tid = extractTargetId(single);
      if (!tid) return null;
      return tid === thisId;
    }

    return null;
  }

  // "if this creature regenerated this turn" (best-effort)
  if (/^if\s+this\s+creature\s+regenerated\s+this\s+turn$/i.test(clause)) {
    const fromRefs = (refs as any)?.regeneratedThisTurn ?? (refs as any)?.wasRegeneratedThisTurn;
    if (typeof fromRefs === 'boolean') return fromRefs;

    if (!thisPermanentForSelfClauses) return null;
    const p: any = thisPermanentForSelfClauses as any;
    const raw =
      p?.regeneratedThisTurn ??
      p?.wasRegeneratedThisTurn ??
      p?.card?.regeneratedThisTurn ??
      p?.card?.wasRegeneratedThisTurn;
    return typeof raw === 'boolean' ? raw : null;
  }

  // "if a creature or planeswalker an opponent controlled was dealt excess damage this turn" (best-effort)
  if (/^if\s+a\s+creature\s+or\s+planeswalker\s+an\s+opponent\s+controlled\s+was\s+dealt\s+excess\s+damage\s+this\s+turn$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;

    const stateAny = (ctx as any).state as any;
    const map = stateAny?.excessDamageThisTurnByCreatureId ?? stateAny?.excessDamageThisTurnByPermanentId;
    const hasTrackingMap = !!map && typeof map === 'object';

    const { opponents: oppIds, unknown } = getOpponentInfo(ctx, controllerId);
    if (unknown) return null;
    if (!oppIds.length) return false;

    let sawAnyKnown = false;
    for (const p of battlefield) {
      if (!p) continue;
      if (!oppIds.includes(String(p.controller || ''))) continue;
      const tl = String(p?.card?.type_line || '').toLowerCase();
      const isCreatureOrPW = tl.includes('creature') || tl.includes('planeswalker');
      if (!isCreatureOrPW) continue;

      const id = String(p.id || '');
      const flag = (p as any).wasDealtExcessDamageThisTurn;
      if (typeof flag === 'boolean') {
        sawAnyKnown = true;
        if (flag) return true;
        continue;
      }

      if (hasTrackingMap && id) {
        const v = (map as any)[id];
        if (typeof v === 'boolean') {
          sawAnyKnown = true;
          if (v) return true;
        } else if (typeof v === 'number') {
          sawAnyKnown = true;
          if (v > 0) return true;
        } else if (Object.prototype.hasOwnProperty.call(map, id)) {
          // Explicit key present but unrecognized value: treat as known-but-false.
          sawAnyKnown = true;
        }
      }
    }

    // If a replay-stable tracker exists at all, become deterministic.
    // (When tracking is absent, avoid inferring false from missing keys.)
    if (hasTrackingMap) return false;
    return sawAnyKnown ? false : null;
  }

  // Counters-based artifacts (best-effort)
  if (/^if\s+this\s+artifact\s+has\s+loyalty\s+counters\s+on\s+it$/i.test(clause)) {
    const p: any = thisPermanentForSelfClauses as any;
    if (!p) return null;
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;

    // Only become deterministic when counters tracking is present on the battlefield.
    // (Some permanents omit the counters object entirely when they have none.)
    const hasAnyCountersObject = battlefield.some((p: any) => p && (p as any).counters && typeof (p as any).counters === 'object');
    if (!hasAnyCountersObject) return null;

    const n = getCounterCountCaseInsensitiveFromPerm(p, 'loyalty');
    if (typeof n === 'number') return n > 0;
    return false;
  }

  {
    const m = clause.match(/^if\s+this\s+artifact\s+has\s+([a-z0-9]+)\s+or\s+more\s+charge\s+counters\s+on\s+it$/i);
    if (m) {
      const p: any = thisPermanentForSelfClauses as any;
      if (!p) return null;
      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;

      // Only become deterministic when counters tracking is present on the battlefield.
      const hasAnyCountersObject = battlefield.some((p: any) => p && (p as any).counters && typeof (p as any).counters === 'object');
      if (!hasAnyCountersObject) return null;

      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const c = getCounterCountCaseInsensitiveFromPerm(p, 'charge');
      if (typeof c === 'number') return c >= n;
      return false;
    }
  }

  // "if <Name> is tapped" (best-effort; prefers source if name matches)
  {
    const m = clause.match(/^if\s+(.+?)\s+is\s+tapped$/i);
    if (m) {
      const tokenLower = normalizeText(m[1]).toLowerCase();
      const sourceName = normalizeText(String((sourcePermanent as any)?.card?.name ?? (sourcePermanent as any)?.name ?? '')).toLowerCase();
      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;

      const pick =
        sourcePermanent && sourceName && tokenLower && sourceName.startsWith(tokenLower)
          ? sourcePermanent
          : (() => {
              const matches = battlefield.filter((p: any) => {
                const nm = normalizeText(String(p?.card?.name ?? p?.name ?? '')).toLowerCase();
                return nm && tokenLower ? nm.startsWith(tokenLower) : false;
              });
              return matches.length === 1 ? matches[0] : null;
            })();

      if (pick) {
        const tapped = (pick as any)?.tapped;
        return typeof tapped === 'boolean' ? tapped : null;
      }
    }
  }

  // "if this card is exiled with an <counter> counter on it" (best-effort)
  {
    const m = clause.match(/^if\s+this\s+card\s+is\s+exiled\s+with\s+an?\s+([a-z\-]+)\s+counter\s+on\s+it$/i);
    if (m) {
      const wantedId = String(
        (sourcePermanent as any)?.card?.id ??
          (sourcePermanent as any)?.id ??
          (refs as any)?.thisCardId ??
          (refs as any)?.thisPermanentId ??
          (refs as any)?.sourcePermanentId ??
          ''
      ).trim();

      let exiledObj: any = sourcePermanent ?? null;
      let zone = String((exiledObj as any)?.zone ?? (exiledObj as any)?.card?.zone ?? '').toLowerCase();

      if (!exiledObj && wantedId) {
        try {
          const zones = getZones(ctx);
          if (zones && typeof zones === 'object') {
            for (const z of Object.values(zones as any)) {
              const exile = (z as any)?.exile;
              if (!Array.isArray(exile)) continue;
              const found = exile.find((c: any) => {
                const cid = c?.card?.id ?? c?.cardId ?? c?.id;
                return cid ? String(cid) === wantedId : false;
              });
              if (found) {
                exiledObj = found;
                zone = 'exile';
                break;
              }
            }
          }
        } catch {
          // ignore
        }
      }

      if (!exiledObj) return null;
      if (zone && zone !== 'exile') return false;
      if (!zone) return null;

      // Only become deterministic when counters tracking exists anywhere in the game state.
      // (Some objects omit the counters object entirely when they have none.)
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
          const zones = getZones(ctx);
          if (zones && typeof zones === 'object') {
            for (const z of Object.values(zones as any)) {
              const exile = (z as any)?.exile;
              if (!Array.isArray(exile)) continue;
              if (exile.some((c: any) => c && (c as any).counters && typeof (c as any).counters === 'object')) {
                hasAnyCountersObject = true;
                break;
              }
            }
          }
        } catch {
          // ignore
        }
      }
      if (!hasAnyCountersObject) return null;

      const counterName = String(m[1] || '').toLowerCase();
      const n = getCounterCountCaseInsensitiveFromPerm(exiledObj, counterName);
      if (typeof n === 'number') return n > 0;

      // Fallback: some zone objects store counters on card snapshots.
      const cardCounters = (exiledObj as any)?.card?.counters;
      if (cardCounters && typeof cardCounters === 'object') {
        const pseudo = { counters: cardCounters };
        const m2 = getCounterCountCaseInsensitiveFromPerm(pseudo, counterName);
        if (typeof m2 === 'number') return m2 > 0;
      }

      return false;
    }
  }

  // "if there are N or more cards exiled with <Name>" (best-effort)
  {
    const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+cards\s+exiled\s+with\s+(.+)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const nameLower = normalizeText(m[2]).toLowerCase();
      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;
      const matches = battlefield.filter(
        (p: any) => normalizeText(String(p?.card?.name ?? p?.name ?? '')).toLowerCase() === nameLower
      );
      if (matches.length === 0) return false;
      if (matches.length !== 1) return null;
      const srcId = String(matches[0]?.id || '');
      if (!srcId) return null;

      // If the named permanent is a linked-exile card, prefer linkedExiles tracking.
      try {
        const det = detectLinkedExileEffect((matches[0] as any)?.card);
        if (det?.hasLinkedExile) {
          const linked = (ctx as any).state?.linkedExiles;
          if (!Array.isArray(linked)) return null;
          const count = linked.filter((le: any) => String(le?.exilingPermanentId ?? '') === srcId).length;
          return count >= n;
        }
      } catch {
        // best-effort only
      }

      const zones = getZones(ctx);
      if (!zones || typeof zones !== 'object') return null;

      const stateAny = (ctx as any).state as any;
      const playerIds = Array.isArray(stateAny?.players)
        ? (stateAny.players as any[]).map((p: any) => String(p?.id || '')).filter(Boolean)
        : [];
      const hasFullyTrackedExile = playerIds.length > 0 && playerIds.every((pid: string) => Array.isArray((zones as any)?.[pid]?.exile));

      let count = 0;
      let sawAnyExileArray = false;
      for (const z of Object.values(zones as any)) {
        const exile = (z as any)?.exile;
        if (!Array.isArray(exile)) continue;
        sawAnyExileArray = true;
        for (const c of exile) {
          if (String(c?.exiledWithSourceId ?? '') === srcId) count++;
        }
      }

      if (count >= n) return true;
      if (hasFullyTrackedExile) return false;
      return sawAnyExileArray ? null : null;
    }
  }

  // "if <Name> attacked this combat"
  {
    const m = clause.match(/^if\s+(.+?)\s+attacked\s+this\s+combat$/i);
    if (m) {
      const nameLower = normalizeText(m[1]).toLowerCase();
      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;
      const matches = battlefield.filter(
        (p: any) => normalizeText(String(p?.card?.name ?? p?.name ?? '')).toLowerCase() === nameLower
      );
      if (matches.length === 0) return false;
      if (matches.length !== 1) return null;
      const p = matches[0];
      const pid = String((p as any)?.id || '').trim();
      const tracked = (ctx as any).state?.attackersDeclaredThisCombatByPlayer;
      if (pid && tracked && typeof tracked === 'object') {
        const ctrl = String((p as any)?.controller ?? '').trim();
        const hasTracking = !!ctrl && Object.prototype.hasOwnProperty.call(tracked, ctrl);
        if (hasTracking) {
          const entries = getAttackersDeclaredThisCombat(ctx, ctrl);
          return entries.some((e: any) => String(e?.id ?? e?.permanentId ?? '').trim() === pid);
        }
      }

      const attacked = (p as any)?.attackedThisTurn ?? ((p as any)?.attacking ? true : undefined) ?? ((p as any)?.isAttacking ? true : undefined);
      return typeof attacked === 'boolean' ? attacked : null;
    }
  }

  // "if <Name> dealt damage to another creature this turn" (best-effort)
  {
    const m = clause.match(/^if\s+(.+?)\s+dealt\s+damage\s+to\s+another\s+creature\s+this\s+turn$/i);
    if (m) {
      const nameLower = normalizeText(m[1]).toLowerCase();
      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;
      const matches = battlefield.filter(
        (p: any) => normalizeText(String(p?.card?.name ?? p?.name ?? '')).toLowerCase() === nameLower
      );
      if (matches.length === 0) return false;
      if (matches.length !== 1) return null;
      const p = matches[0];

      // Positive-only evidence: if we have the per-turn creature->creature combat damage tracker
      // and it shows this creature damaged any other creature, we can safely return true.
      // (We do NOT return false from this tracker because non-combat damage exists.)
      try {
        const pid = String((p as any)?.id ?? '').trim();
        const damaged = (ctx as any).state?.creaturesDamagedByThisCreatureThisTurn;
        if (pid && damaged && typeof damaged === 'object') {
          const victims = (damaged as any)[pid];
          if (victims && typeof victims === 'object' && Object.keys(victims as any).length > 0) return true;
        }
      } catch {
        // ignore
      }

      const raw =
        (p as any)?.dealtDamageToAnotherCreatureThisTurn ??
        (p as any)?.dealtDamageToCreatureThisTurn ??
        (p as any)?.dealtDamageToAnotherCreature ??
        (p as any)?.dealtDamageToCreature;
      return typeof raw === 'boolean' ? raw : null;
    }
  }

  // "if X is N or more" (best-effort: uses refs.xValue)
  {
    const m = clause.match(/^if\s+x\s+is\s+([a-z0-9]+)\s+or\s+more$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const x = parseMaybeNumber((refs as any)?.xValue ?? (sourcePermanent as any)?.xValue ?? (sourcePermanent as any)?.card?.xValue);
      if (x === null) return null;
      return x >= n;
    }
  }

  // "if this creature didn't enter the battlefield this turn"
  if (/^if\s+this\s+creature\s+didn'?t\s+enter\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {
    const thisId = String(
      (sourcePermanent as any)?.id ??
        (refs as any)?.thisCreatureId ??
        (refs as any)?.thisPermanentId ??
        (refs as any)?.sourcePermanentId ??
        ''
    ).trim();
    const p = sourcePermanent ?? (thisId ? findBattlefieldPermanent(ctx, thisId) : null);

    const permControllerId = String((p as any)?.controller ?? (p as any)?.card?.controller ?? controllerId ?? '').trim();
    const sourceId = String((p as any)?.id ?? (p as any)?.card?.id ?? thisId ?? '').trim();
    if (!sourceId) return null;

    const raw =
      (p as any)?.enteredThisTurn ??
      (p as any)?.enteredBattlefieldThisTurn ??
      (p as any)?.card?.enteredThisTurn ??
      (p as any)?.card?.enteredBattlefieldThisTurn;
    if (typeof raw === 'boolean') return !raw;

    // Replay-stable evidence: per-turn ETB ids for creatures.
    // If the tracking map exists for this controller, absence is authoritative.
    const idsByController = (ctx as any).state?.creaturesEnteredBattlefieldThisTurnIdsByController;
    if (permControllerId && sourceId && idsByController && typeof idsByController === 'object') {
      const byController = (idsByController as any)[permControllerId];
      if (byController && typeof byController === 'object') return !(byController as any)[sourceId];
      // Controller present but no ids recorded => definitely didn't enter this turn.
      return true;
    }

    return null;
  }

  return undefined;
}
