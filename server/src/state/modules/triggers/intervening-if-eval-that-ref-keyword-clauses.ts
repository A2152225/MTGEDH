/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: evaluateInterveningIfClauseInternal remaining that-refs plus keyword shorthand
 * (delirium/hellbent/threshold) through "if it is not a subtype"
 * Public: tryEvaluateInterveningIfThatRefKeywordClauses
 */

import { parseCountToken, countByPermanentType } from "./intervening-if-this-turn-counts.js";
import {
  findBattlefieldPermanent,
  getGraveyardCount,
  parseMaybeNumber,
  getHandCount,
  typeLineHasWord,
  getGraveyard,
} from "./intervening-if-zone-lookups.js";
import {
  getPermanentPowerMaybe,
  getPermanentPower,
  isPermanentAttacking,
  isPermanentBlocking,
  getPermanentToughnessMaybe,
  getControlledCreatures,
  isEquippedConservative,
  getAuraCountConservative,
  getPermanentToughness,
  countCardTypesInGraveyard,
  permanentHasKeyword,
  isPermanentRed,
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

export function tryEvaluateInterveningIfThatRefKeywordClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
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

  // "if a counter was put on <Name> this turn"
  {
    const m = clause.match(/^if\s+a\s+counter\s+was\s+put\s+on\s+(.+?)\s+this\s+turn$/i);
    if (m) {
      const tokenLower = normalizeText(m[1]).toLowerCase();
      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;

      const matches = battlefield.filter((p: any) => {
        const nm = String(p?.card?.name ?? p?.name ?? '').trim();
        if (!nm) return false;
        return normalizeText(nm).toLowerCase().startsWith(tokenLower);
      });

      if (matches.length === 0) return false;
      if (matches.length !== 1) return null;
      const p = matches[0];
      const id = String(p?.id || '');

      const direct = (p as any)?.counterWasPutOnThisTurn ?? (p as any)?.hadCounterPutOnThisTurn;
      if (typeof direct === 'boolean') return direct;

      const map = (ctx as any).state?.putCounterOnPermanentThisTurnByPermanentId;
      if (map && typeof map === 'object' && id) {
        const v = (map as any)[id];
        return typeof v === 'boolean' ? v : false;
      }

      return null;
    }
  }

  // "if it has dealt 10 or more damage to that player this turn" (best-effort; requires refs)
  if (/^if\s+it\s+has\s+dealt\s+10\s+or\s+more\s+damage\s+to\s+that\s+player\s+this\s+turn$/i.test(clause)) {
    const n =
      parseMaybeNumber((refs as any)?.damageDealtToThatPlayerThisTurn) ??
      parseMaybeNumber((refs as any)?.damageToThatPlayerThisTurn) ??
      parseMaybeNumber((refs as any)?.damageDealtToPlayerThisTurn);
    if (n === null) return null;
    return n >= 10;
  }

  // "if an Aura you controlled was attached to it"
  if (/^if\s+an\s+aura\s+you\s+controlled\s+was\s+attached\s+to\s+it$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;

    const itId =
      (refs as any)?.itPermanentId ??
      (refs as any)?.thatPermanentId ??
      (refs as any)?.thatCreatureId ??
      (sourcePermanent as any)?.id;
    if (typeof itId !== 'string' || !itId) return null;

    const itPerm = battlefield.find((p: any) => p && String(p?.id ?? '') === String(itId));
    const itAttachments: any[] | null = Array.isArray((itPerm as any)?.attachments) ? ((itPerm as any).attachments as any[]) : null;
    const hasAnyAttachedToField = battlefield.some((p: any) => p && typeof p === 'object' && Object.prototype.hasOwnProperty.call(p, 'attachedTo'));

    const candidates: any[] = [];
    const seen = new Set<string>();

    // Prefer attachments list on the target permanent when available.
    if (itAttachments) {
      for (const a of itAttachments) {
        const aid = String((a as any)?.id ?? a ?? '').trim();
        if (!aid || seen.has(aid)) continue;
        const perm = battlefield.find((p: any) => p && String(p?.id ?? '') === aid);
        if (!perm) continue;
        const tl = String(perm?.card?.type_line ?? '').toLowerCase();
        if (!tl.includes('aura')) continue;
        seen.add(aid);
        candidates.push(perm);
      }
    }

    // Also accept the inverse pointer (Aura.attachedTo) if present.
    for (const p of battlefield) {
      if (!p) continue;
      const tl = String(p?.card?.type_line ?? '').toLowerCase();
      if (!tl.includes('aura')) continue;
      if (String((p as any)?.attachedTo ?? '') !== String(itId)) continue;
      const pid = String((p as any)?.id ?? '').trim();
      if (pid && !seen.has(pid)) {
        seen.add(pid);
        candidates.push(p);
      }
    }

    if (candidates.length === 0) {
      // If we don't have any reliable attachment representation, avoid a false-negative.
      return itAttachments || hasAnyAttachedToField ? false : null;
    }

    let missingController = false;
    for (const a of candidates) {
      const c = (a as any)?.controller;
      if (typeof c !== 'string' || !c) {
        missingController = true;
        continue;
      }
      if (String(c) === String(controllerId)) return true;
    }
    return missingController ? null : false;
  }

  // "if it targets a creature you control with the chosen name"
  if (/^if\s+it\s+targets\s+a\s+creature\s+you\s+control\s+with\s+the\s+chosen\s+name$/i.test(clause)) {
    const chosenName = String((refs as any)?.chosenName ?? (refs as any)?.chosenCreatureName ?? (refs as any)?.card?.chosenName ?? '').trim();
    if (!chosenName) return null;
    const chosenLower = normalizeText(chosenName).toLowerCase();
    const battlefield = (ctx as any).state?.battlefield;

    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
    if (!item || !Array.isArray(battlefield)) return null;

    const targets: any[] | null = Array.isArray((item as any).targets)
      ? ((item as any).targets as any[])
      : Array.isArray((item as any).targetIds)
        ? ((item as any).targetIds as any[])
        : null;
    const single = (item as any).targetId ?? (item as any).target;
    const allTargets: any[] | null = targets ?? (single != null ? [single] : null);
    if (!Array.isArray(allTargets)) return null;

    const playerIds = new Set(
      Array.isArray((ctx as any).state?.players) ? ((ctx as any).state.players as any[]).map((p: any) => String(p?.id ?? '')).filter(Boolean) : []
    );

    let sawAll = true;
    for (const t of allTargets) {
      const tid = String(typeof t === 'string' ? t : (t as any)?.id ?? (t as any)?.targetId ?? (t as any)?.permanentId ?? '').trim();
      if (!tid) {
        sawAll = false;
        continue;
      }
      if (playerIds.has(tid)) {
        // Player targets are irrelevant to a "targets a creature" check.
        continue;
      }
      const perm = battlefield.find((p: any) => p && String(p.id || '') === tid);
      if (!perm) {
        sawAll = false;
        continue;
      }
      const tl = String(perm?.card?.type_line ?? '').toLowerCase();
      if (!tl.includes('creature')) continue;
      if (String(perm?.controller ?? '') !== String(controllerId)) continue;
      const nm = normalizeText(String(perm?.card?.name ?? perm?.name ?? '')).toLowerCase();
      if (!nm) {
        sawAll = false;
        continue;
      }
      if (nm === chosenLower) return true;
    }

    return sawAll ? false : null;
  }

  // "if it targets one or more other permanents you control"
  if (/^if\s+it\s+targets\s+one\s+or\s+more\s+other\s+permanents\s+you\s+control$/i.test(clause)) {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;

    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
    if (!item) return null;

    const targets: any[] | null = Array.isArray((item as any).targets)
      ? ((item as any).targets as any[])
      : Array.isArray((item as any).targetIds)
        ? ((item as any).targetIds as any[])
        : null;
    const single = (item as any).targetId ?? (item as any).target;
    const allTargets: any[] | null = targets ?? (single != null ? [single] : null);
    if (!Array.isArray(allTargets)) return null;

    const playerIds = new Set(
      Array.isArray((ctx as any).state?.players) ? ((ctx as any).state.players as any[]).map((p: any) => String(p?.id ?? '')).filter(Boolean) : []
    );

    const sourceId = String(
      (sourcePermanent as any)?.id ??
        (refs as any)?.sourcePermanentId ??
        (refs as any)?.thisPermanentId ??
        (refs as any)?.thisCreatureId ??
        (refs as any)?.thisId ??
        (item as any)?.sourcePermanentId ??
        (item as any)?.sourceId ??
        ''
    ).trim();
    if (!sourceId) return null;
    let sawAll = true;
    for (const t of allTargets) {
      const tid = String(typeof t === 'string' ? t : (t as any)?.id ?? (t as any)?.targetId ?? (t as any)?.permanentId ?? '').trim();
      if (!tid) {
        sawAll = false;
        continue;
      }
      if (playerIds.has(tid)) {
        // Player targets are irrelevant to a "targets permanents" check.
        continue;
      }

      const perm = battlefield.find((p: any) => p && String(p.id || '') === tid);
      if (!perm) {
        sawAll = false;
        continue;
      }
      if (String(perm?.controller ?? '') !== String(controllerId)) continue;
      if (sourceId && String(perm?.id ?? '') === sourceId) continue;
      return true;
    }

    return sawAll ? false : null;
  }

  // "if it/this creature was attacking or blocking alone"
  if (/^if\s+(?:it|this\s+creature)\s+was\s+attacking\s+or\s+blocking\s+alone$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const battlefield = (ctx as any).state?.battlefield || [];
    if (!Array.isArray(battlefield)) return null;

    const sourceId = String((thisPermanentForSelfClauses as any)?.id || '').trim();
    const controller = String((thisPermanentForSelfClauses as any)?.controller ?? controllerId ?? '').trim();
    if (!sourceId || !controller) return null;

    // Prefer per-combat declared-attacker/blocker snapshots when available.
    const trackedAttackers = (ctx as any).state?.attackersDeclaredThisCombatByPlayer;
    const trackedBlockers = (ctx as any).state?.blockersDeclaredThisCombatByPlayer;
    const atk = trackedAttackers && typeof trackedAttackers === 'object' ? (trackedAttackers as any)[controller] : null;
    const blk = trackedBlockers && typeof trackedBlockers === 'object' ? (trackedBlockers as any)[controller] : null;
    if (Array.isArray(atk) && Array.isArray(blk)) {
      const ids = new Set<string>();
      for (const e of atk) {
        const id = String((e as any)?.id ?? (e as any)?.creatureId ?? e ?? '').trim();
        if (id) ids.add(id);
      }
      for (const e of blk) {
        const id = String((e as any)?.id ?? (e as any)?.creatureId ?? e ?? '').trim();
        if (id) ids.add(id);
      }
      return ids.size === 1 && ids.has(sourceId);
    }

    // Fallback: best-effort current combat state.
    const sourceActive = isPermanentAttacking(thisPermanentForSelfClauses) || isPermanentBlocking(thisPermanentForSelfClauses);
    if (!sourceActive) return null;

    const othersActive = getControlledCreatures(ctx, controller).some((p: any) => {
      if (!p) return false;
      if (sourceId && String(p?.id || '') === sourceId) return false;
      return isPermanentAttacking(p) || isPermanentBlocking(p);
    });

    return othersActive ? false : true;
  }

  // "if it shares a creature type with <Name>"
  {
    const m = clause.match(/^if\s+it\s+shares\s+a\s+creature\s+type\s+with\s+(.+)$/i);
    if (m) {
      if (!thisPermanentForSelfClauses) return null;
      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;

      const itTypeLine = String((thisPermanentForSelfClauses as any)?.card?.type_line ?? '').toLowerCase();
      if (!itTypeLine) return null;
      if (!itTypeLine.includes('creature')) return false;

      const tokenLower = normalizeText(m[1]).toLowerCase();
      if (!tokenLower) return null;

      const parseSubtypes = (tl: string): string[] => {
        const idx = tl.indexOf('—');
        const part = idx >= 0 ? tl.slice(idx + 1) : '';
        return part
          .split(/\s+/)
          .map((s) => s.replace(/[^a-z0-9'’\-]/gi, '').toLowerCase())
          .filter(Boolean);
      };

      const a = new Set(parseSubtypes(itTypeLine));
      if (!a.size) return false;

      let sawName = false;
      let sawComparable = false;
      let unknown = false;
      for (const p of battlefield) {
        const nm = String(p?.card?.name ?? p?.name ?? '').trim();
        if (!nm) continue;
        if (normalizeText(nm).toLowerCase() !== tokenLower) continue;
        sawName = true;

        const otherTypeLine = String(p?.card?.type_line ?? '').toLowerCase();
        if (!otherTypeLine) {
          unknown = true;
          continue;
        }
        if (!otherTypeLine.includes('creature')) continue;

        const b = new Set(parseSubtypes(otherTypeLine));
        if (!b.size) {
          sawComparable = true;
          continue;
        }
        sawComparable = true;
        for (const t of a) {
          if (b.has(t)) return true;
        }
      }

      if (!sawName) return null;
      if (!sawComparable) return unknown ? null : false;
      return unknown ? null : false;
    }
  }

  // "if any of those creatures have power or toughness equal to the chosen number"
  if (/^if\s+any\s+of\s+those\s+creatures\s+have\s+power\s+or\s+toughness\s+equal\s+to\s+the\s+chosen\s+number$/i.test(clause)) {
    const ids = (refs as any)?.thoseCreatureIds;
    if (!Array.isArray(ids) || !ids.length) return null;
    const chosen = parseMaybeNumber((refs as any)?.chosenNumber ?? (refs as any)?.chosenValue ?? (refs as any)?.chosen);
    if (chosen === null) return null;

    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;

    let sawAny = false;
    let sawUnknown = false;
    for (const id of ids) {
      const perm = battlefield.find((p: any) => p && String(p.id || '') === String(id || ''));
      if (!perm) continue;
      sawAny = true;
      const p = getPermanentPowerMaybe(perm, ctx);
      const t = getPermanentToughnessMaybe(perm, ctx);
      if ((p !== null && p === chosen) || (t !== null && t === chosen)) return true;
      if (p === null || t === null) sawUnknown = true;
    }

    if (!sawAny) return null;
    return sawUnknown ? null : false;
  }

  // "if it enlisted a creature this combat"
  if (/^if\s+it\s+enlisted\s+a\s+creature\s+this\s+combat$/i.test(clause)) {
    const raw =
      (refs as any)?.enlistedCreatureThisCombat ??
      (refs as any)?.enlistedThisCombat ??
      (sourcePermanent as any)?.enlistedCreatureThisCombat ??
      (sourcePermanent as any)?.enlistedThisCombat;
    return typeof raw === 'boolean' ? raw : null;
  }

  // "if an Assassin crewed it this turn"
  if (/^if\s+an\s+assassin\s+crewed\s+it\s+this\s+turn$/i.test(clause)) {
    const types =
      (refs as any)?.crewedByCreatureTypesThisTurn ??
      (refs as any)?.crewedBySubtypesThisTurn ??
      (sourcePermanent as any)?.crewedByCreatureTypesThisTurn ??
      (sourcePermanent as any)?.crewedBySubtypesThisTurn;
    if (!Array.isArray(types)) return null;
    const lower = types.map((t: any) => String(t || '').toLowerCase());
    return lower.includes('assassin');
  }

  // "if it was crewed by exactly two creatures"
  if (/^if\s+it\s+was\s+crewed\s+by\s+exactly\s+two\s+creatures$/i.test(clause)) {
    const raw =
      (refs as any)?.crewedByCreatureCountThisTurn ??
      (sourcePermanent as any)?.crewedByCreatureCountThisTurn ??
      (refs as any)?.crewedByCountThisTurn ??
      (sourcePermanent as any)?.crewedByCountThisTurn;
    if (typeof raw !== 'number') return null;
    return raw === 2;
  }

  // Keyword shorthand: delirium
  if (/^if\s+you\s+have\s+delirium$/i.test(clause)) {
    return countCardTypesInGraveyard(ctx, controllerId) >= 4;
  }

  // Keyword shorthand: hellbent
  if (/^if\s+you\s+have\s+hellbent$/i.test(clause)) {
    return getHandCount(ctx, controllerId) === 0;
  }

  // Hand empty variants
  if (
    /^if\s+you\s+have\s+no\s+cards\s+in\s+your\s+hand$/i.test(clause) ||
    /^if\s+you\s+have\s+no\s+cards\s+in\s+hand$/i.test(clause)
  ) {
    return getHandCount(ctx, controllerId) === 0;
  }

  // Keyword shorthand: metalcraft
  if (/^if\s+you\s+have\s+metalcraft$/i.test(clause)) {
    return countByPermanentType(ctx, controllerId, 'artifact') >= 3;
  }

  // Threshold keyword shorthand
  if (/^if\s+you\s+have\s+threshold$/i.test(clause)) {
    return getGraveyardCount(ctx, controllerId) >= 7;
  }

  // Threshold template: "If seven or more cards are in your graveyard"
  if (/^if\s+seven\s+or\s+more\s+cards?\s+are\s+in\s+your\s+graveyard$/i.test(clause)) {
    return getGraveyardCount(ctx, controllerId) >= 7;
  }

  // Threshold template: "If N or more cards are in your graveyard"
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+cards?\s+are\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getGraveyardCount(ctx, controllerId) >= n;
    }
  }

  // Graveyard empty variants
  if (
    /^if\s+you\s+have\s+no\s+cards\s+in\s+your\s+graveyard$/i.test(clause) ||
    /^if\s+you\s+have\s+no\s+cards\s+in\s+graveyard$/i.test(clause) ||
    /^if\s+your\s+graveyard\s+is\s+empty$/i.test(clause)
  ) {
    return getGraveyardCount(ctx, controllerId) === 0;
  }

  // Graveyard count templates: "If you have N or more/fewer cards in your graveyard" / "If there are N or more/fewer cards in your graveyard"
  {
    const m = clause.match(/^if\s+(?:you\s+have|there\s+are)\s+([a-z0-9]+)\s+or\s+more\s+cards?\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getGraveyardCount(ctx, controllerId) >= n;
    }
  }
  {
    const m = clause.match(/^if\s+(?:you\s+have|there\s+are)\s+([a-z0-9]+)\s+or\s+(?:fewer|less)\s+cards?\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getGraveyardCount(ctx, controllerId) <= n;
    }
  }
  {
    const m = clause.match(/^if\s+(?:you\s+have|there\s+are)\s+exactly\s+([a-z0-9]+)\s+cards?\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getGraveyardCount(ctx, controllerId) === n;
    }
  }

  // Graveyard name check: "if <card name> is in your graveyard"
  {
    const m = clause.match(/^if\s+(.+?)\s+is\s+in\s+your\s+graveyard$/i);
    if (m) {
      const nameRaw = String(m[1] || "").trim();
      const name = nameRaw === "~" && sourcePermanent?.card?.name ? String(sourcePermanent.card.name) : nameRaw;
      if (!name) return null;
      const lowerName = name.toLowerCase();
      return getGraveyard(ctx, controllerId).some((c: any) => String(c?.name || "").toLowerCase() === lowerName);
    }
  }

  // Ferocious-style: "if you control a creature with power N or greater"
  {
    const m = clause.match(/^if\s+you\s+control\s+a\s+creature\s+with\s+power\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getControlledCreatures(ctx, controllerId).some((c: any) => getPermanentPower(c, ctx) >= n);
    }
  }

  // "if its power is N or greater" (best-effort: source permanent)
  {
    const m = clause.match(/^if\s+its\s+power\s+is\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      if (!thisPermanentForSelfClauses) return null;
      return getPermanentPower(thisPermanentForSelfClauses, ctx) >= n;
    }
  }

  const auraForEnchantedClauses =
    sourcePermanent ??
    (() => {
      const id = String((refs as any)?.sourcePermanentId ?? (refs as any)?.thisId ?? '').trim();
      if (!id) return null;
      return findBattlefieldPermanent(ctx, id);
    })();

  // "if enchanted creature's power is N or greater" (best-effort: aura attachedTo)
  {
    const m = clause.match(/^if\s+enchanted\s+creature'?s\s+power\s+is\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      if (!auraForEnchantedClauses) return null;
      const attachedTo = String((auraForEnchantedClauses as any)?.attachedTo || '');
      if (!attachedTo) return null;
      const enchanted = findBattlefieldPermanent(ctx, attachedTo);
      if (!enchanted) return null;
      return getPermanentPower(enchanted, ctx) >= n;
    }
  }

  // "if enchanted creature has <keyword>" (best-effort: aura attachedTo)
  {
    const m = clause.match(/^if\s+enchanted\s+creature\s+has\s+(flying|toxic)$/i);
    if (m) {
      if (!auraForEnchantedClauses) return null;
      const attachedTo = String((auraForEnchantedClauses as any)?.attachedTo || '');
      if (!attachedTo) return null;
      const enchanted = findBattlefieldPermanent(ctx, attachedTo);
      if (!enchanted) return null;
      return permanentHasKeyword(enchanted, String(m[1] || '').toLowerCase());
    }
  }

  // "if enchanted creature's power is N or greater" (best-effort: aura attachedTo)
  {
    const m = clause.match(/^if\s+enchanted\s+creature'?s\s+power\s+is\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      if (!auraForEnchantedClauses) return null;
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const attachedTo = String((auraForEnchantedClauses as any)?.attachedTo || '');
      if (!attachedTo) return null;
      const enchanted = findBattlefieldPermanent(ctx, attachedTo);
      if (!enchanted) return null;
      const tl = String(enchanted?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      if (!tl.includes('creature')) return false;
      const power = getPermanentPowerMaybe(enchanted, ctx);
      if (power === null) return null;
      return power >= n;
    }
  }

  // "if enchanted creature is untapped" (best-effort: aura attachedTo)
  if (/^if\s+enchanted\s+creature\s+is\s+untapped$/i.test(clause)) {
    if (!auraForEnchantedClauses) return null;
    const attachedTo = String((auraForEnchantedClauses as any)?.attachedTo || '');
    if (!attachedTo) return null;
    const enchanted = findBattlefieldPermanent(ctx, attachedTo);
    if (!enchanted) return null;
    if (typeof (enchanted as any).tapped !== 'boolean') return null;
    return !(enchanted as any).tapped;
  }

  // "if enchanted creature is red" (best-effort: aura attachedTo)
  if (/^if\s+enchanted\s+creature\s+is\s+red$/i.test(clause)) {
    if (!auraForEnchantedClauses) return null;
    const attachedTo = String((auraForEnchantedClauses as any)?.attachedTo || '');
    if (!attachedTo) return null;
    const enchanted = findBattlefieldPermanent(ctx, attachedTo);
    if (!enchanted) return null;
    return isPermanentRed(enchanted);
  }

  // "if enchanted creature is a Wolf or Werewolf" (best-effort: aura attachedTo)
  if (/^if\s+enchanted\s+creature\s+is\s+a\s+wolf\s+or\s+werewolf$/i.test(clause)) {
    if (!auraForEnchantedClauses) return null;
    const attachedTo = String((auraForEnchantedClauses as any)?.attachedTo || '');
    if (!attachedTo) return null;
    const enchanted = findBattlefieldPermanent(ctx, attachedTo);
    if (!enchanted) return null;
    const tl = String(enchanted?.card?.type_line || '');
    if (!tl) return null;
    return typeLineHasWord(tl, 'wolf') || typeLineHasWord(tl, 'werewolf');
  }

  // "if enchanted permanent is tapped" (best-effort: aura attachedTo)
  if (/^if\s+enchanted\s+permanent\s+is\s+tapped$/i.test(clause)) {
    if (!auraForEnchantedClauses) return null;
    const attachedTo = String((auraForEnchantedClauses as any)?.attachedTo || '');
    if (!attachedTo) return null;
    const enchanted = findBattlefieldPermanent(ctx, attachedTo);
    if (!enchanted) return null;
    if (typeof (enchanted as any).tapped !== 'boolean') return null;
    return (enchanted as any).tapped;
  }

  // "if enchanted permanent is a creature with the greatest power among creatures on the battlefield" (conservative)
  if (
    /^if\s+enchanted\s+permanent\s+is\s+a\s+creature\s+with\s+the\s+greatest\s+power\s+among\s+creatures\s+on\s+the\s+battlefield$/i.test(
      clause
    )
  ) {
    if (!auraForEnchantedClauses) return null;
    const attachedTo = String((auraForEnchantedClauses as any)?.attachedTo || '');
    if (!attachedTo) return null;
    const enchanted = findBattlefieldPermanent(ctx, attachedTo);
    if (!enchanted) return null;

    const enchantedTl = String(enchanted?.card?.type_line || '').toLowerCase();
    if (!enchantedTl) return null;
    if (!enchantedTl.includes('creature')) return false;

    const battlefield = (ctx as any).state?.battlefield || [];
    if (!Array.isArray(battlefield)) return null;

    const powerMaybe = (p: any): number | null => {
      const candidates = [p?.effectivePower, p?.power, p?.basePower, p?.card?.power];
      for (const c of candidates) {
        const parsed = parseMaybeNumber(c);
        if (parsed !== null) return parsed;
      }
      return null;
    };

    const enchantedPower = powerMaybe(enchanted);
    if (enchantedPower === null) return null;

    let unknownOtherCreaturePower = false;
    for (const p of battlefield) {
      if (!p) continue;
      const tl = String(p?.card?.type_line || '').toLowerCase();
      if (!tl) {
        // If we can't even tell whether this is a creature, we can't decide a global "greatest power among creatures" check.
        unknownOtherCreaturePower = true;
        continue;
      }
      if (!tl.includes('creature')) continue;

      const pow = powerMaybe(p);
      if (pow === null) {
        unknownOtherCreaturePower = true;
        continue;
      }
      if (pow > enchantedPower) return false;
    }

    return unknownOtherCreaturePower ? null : true;
  }

  // "if enchanted Equipment is attached to a creature" (best-effort: aura attachedTo)
  if (/^if\s+enchanted\s+equipment\s+is\s+attached\s+to\s+a\s+creature$/i.test(clause)) {
    if (!auraForEnchantedClauses) return null;
    const attachedTo = String((auraForEnchantedClauses as any)?.attachedTo || '');
    if (!attachedTo) return null;
    const enchantedEquipment = findBattlefieldPermanent(ctx, attachedTo);
    if (!enchantedEquipment) return null;

    const tl = String(enchantedEquipment?.card?.type_line || '').toLowerCase();
    if (!tl.includes('equipment')) return false;

    const eqAttachedTo = String((enchantedEquipment as any)?.attachedTo || '');
    if (!eqAttachedTo) return false;
    const creature = findBattlefieldPermanent(ctx, eqAttachedTo);
    if (!creature) return null;
    const creatureTl = String(creature?.card?.type_line || '').toLowerCase();
    if (!creatureTl) return null;
    return creatureTl.includes('creature');
  }

  // "if its toughness is N or less" (best-effort: source permanent)
  {
    const m = clause.match(/^if\s+its\s+toughness\s+is\s+([a-z0-9]+)\s+or\s+less$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      if (!thisPermanentForSelfClauses) return null;
      return getPermanentToughness(thisPermanentForSelfClauses, ctx) <= n;
    }
  }

  // "if its power is N or less" (best-effort: source permanent)
  {
    const m = clause.match(/^if\s+its\s+power\s+is\s+([a-z0-9]+)\s+or\s+less$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      if (!thisPermanentForSelfClauses) return null;
      const pow = getPermanentPowerMaybe(thisPermanentForSelfClauses);
      if (pow === null) return null;
      return pow <= n;
    }
  }

  // "if its power is greater than N" (best-effort: source permanent)
  {
    const m = clause.match(/^if\s+its\s+power\s+is\s+greater\s+than\s+([a-z0-9]+)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      if (!thisPermanentForSelfClauses) return null;
      const pow = getPermanentPowerMaybe(thisPermanentForSelfClauses);
      if (pow === null) return null;
      return pow > n;
    }
  }

  // "if its power was N or greater" (best-effort: current/attached power snapshot)
  {
    const m = clause.match(/^if\s+its\s+power\s+was\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      if (!thisPermanentForSelfClauses) return null;
      const pow = getPermanentPowerMaybe(thisPermanentForSelfClauses);
      if (pow === null) return null;
      return pow >= n;
    }
  }

  // "if its toughness was less than N" (best-effort: current/attached toughness snapshot)
  {
    const m = clause.match(/^if\s+its\s+toughness\s+was\s+less\s+than\s+([a-z0-9]+)$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      if (!thisPermanentForSelfClauses) return null;
      const tou = getPermanentToughnessMaybe(thisPermanentForSelfClauses, ctx);
      if (tou === null) return null;
      return tou < n;
    }
  }

  // "if it wasn't blocking"
  if (/^if\s+it\s+wasn't\s+blocking$/i.test(clause) || /^if\s+it\s+was\s+not\s+blocking$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    return !isPermanentBlocking(thisPermanentForSelfClauses);
  }

  // "if it isn't being declared as an attacker"
  if (/^if\s+it\s+isn't\s+being\s+declared\s+as\s+an\s+attacker$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const sourceId = String((thisPermanentForSelfClauses as any)?.id || '').trim();
    if (!sourceId) return null;

    // Prefer per-combat declared-attacker snapshot when available.
    const tracked = (ctx as any).state?.attackersDeclaredThisCombatByPlayer;
    const list = tracked && typeof tracked === 'object' ? (tracked as any)[String(controllerId)] : null;
    if (Array.isArray(list)) {
      const isDeclared = list.some((e: any) => String(e?.id ?? e?.creatureId ?? e).trim() === sourceId);
      return !isDeclared;
    }

    // Fallback: if we can see an explicit attacking flag on the permanent, use it; otherwise stay conservative.
    const hasAttackingField =
      Object.prototype.hasOwnProperty.call(thisPermanentForSelfClauses as any, 'attacking') ||
      Object.prototype.hasOwnProperty.call(thisPermanentForSelfClauses as any, 'isAttacking');
    if (!hasAttackingField) return null;
    return !isPermanentAttacking(thisPermanentForSelfClauses);
  }

  // "if it was enchanted or equipped"
  if (/^if\s+it\s+was\s+enchanted\s+or\s+equipped$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const equipped = isEquippedConservative(ctx, thisPermanentForSelfClauses);
    if (equipped === true) return true;
    const auraInfo = getAuraCountConservative(ctx, thisPermanentForSelfClauses);
    if (auraInfo && auraInfo.count > 0) return true;

    const unknown = equipped === null || auraInfo === null || auraInfo.unknown;
    return unknown ? null : false;
  }

  // "if it was enchanted"
  if (/^if\s+it\s+was\s+enchanted$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const auraInfo = getAuraCountConservative(ctx, thisPermanentForSelfClauses);
    if (!auraInfo) return null;
    if (auraInfo.count > 0) return true;
    return auraInfo.unknown ? null : false;
  }

  // "if it was equipped"
  if (/^if\s+it\s+was\s+equipped$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    return isEquippedConservative(ctx, thisPermanentForSelfClauses);
  }

  // "if it was a <subtype>" (best-effort: source permanent type_line)
  {
    const m = clause.match(/^if\s+it\s+was\s+a\s+([a-z0-9-]+)$/i);
    if (m) {
      if (!thisPermanentForSelfClauses) return null;
      const subtype = String(m[1] || '').toLowerCase();
      const tl = String(thisPermanentForSelfClauses?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      return new RegExp(`\\b${subtype.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i').test(tl);
    }
  }

  // "if it wasn't a/an <subtype>" (best-effort: source permanent type_line)
  {
    const m = clause.match(/^if\s+it\s+(?:wasn't|was\s+not)\s+(?:a|an)\s+([a-z0-9-]+)$/i);
    if (m) {
      if (!thisPermanentForSelfClauses) return null;
      const subtype = String(m[1] || '').toLowerCase();
      const tl = String(thisPermanentForSelfClauses?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      return !new RegExp(`\\b${subtype.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i').test(tl);
    }
  }

  // "if he wasn't a/an <subtype>" (same as "it"; best-effort)
  {
    const m = clause.match(/^if\s+he\s+(?:wasn't|was\s+not)\s+(?:a|an)\s+([a-z0-9-]+)$/i);
    if (m) {
      if (!thisPermanentForSelfClauses) return null;
      const subtype = String(m[1] || '').toLowerCase();
      const tl = String(thisPermanentForSelfClauses?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      return !new RegExp(`\\b${subtype.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i').test(tl);
    }
  }

  // "if it's not a/an <subtype>" (best-effort: source permanent type_line)
  {
    const m = clause.match(/^if\s+it'?s\s+not\s+(?:(?:a|an)\s+)?([a-z0-9-]+)$/i);
    if (m) {
      if (!thisPermanentForSelfClauses) return null;
      const subtype = String(m[1] || '').toLowerCase();
      const tl = String(thisPermanentForSelfClauses?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      return !new RegExp(`\\b${subtype.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i').test(tl);
    }
  }

  // "if it is not a/an <subtype>" (same as "it's not"; best-effort)
  {
    const m = clause.match(/^if\s+it\s+is\s+not\s+(?:(?:a|an)\s+)?([a-z0-9-]+)$/i);
    if (m) {
      if (!thisPermanentForSelfClauses) return null;
      const subtype = String(m[1] || '').toLowerCase();
      const tl = String(thisPermanentForSelfClauses?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      return !new RegExp(`\\b${subtype.replace(/[-/\\^$*+?.()|[\\]{}]/g, '\\$&')}\\b`, 'i').test(tl);
    }
  }

  return undefined;
}
