/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: evaluateInterveningIfClauseInternal Guardian Project uniqueness, pack tactics,
 * equipped/tapped, coven, library/graveyard counts, alternate-cost, through "if it wasn't cast"
 * Public: tryEvaluateInterveningIfUniquenessCastClauses
 */

import { parseCountToken, getPlayerLifeMaybe, getExplicitColorSetFromObject } from "./intervening-if-this-turn-counts.js";
import { countControlledEnteredThisTurn } from "./intervening-if-entered-this-turn.js";
import {
  parseMaybeNumber,
  getLibraryCount,
  sumManaSpentTotal,
  getGraveyard,
  findBattlefieldPermanent,
} from "./intervening-if-zone-lookups.js";
import { resolveManaSpentBreakdown } from "./intervening-if-mana-spent.js";
import type { ManaSpentBreakdownResolution } from "./intervening-if-mana-spent.js";
import {
  getControlledCreatures,
  getPermanentPower,
  getPermanentPowerMaybe,
  isPermanentEnchanted,
  isPermanentAttacking,
  isPermanentBlocked,
  getPermanentToughness,
  getPermanentToughnessMaybe,
  getAttackingCreatures,
  getAttackersDeclaredThisCombat,
  getAttackingTotalPower,
  isPermanentEquipped,
  isPermanentBlocking,
  getAllPlayerIds,
} from "./intervening-if-permanent-and-player.js";
import { getInterveningIfTargetCount, getDefendingPlayerIdForInterveningIf, getTriggeringStackItemForInterveningIf } from "./intervening-if-eval-support.js";
import type { InterveningIfPhaseArgs, InterveningIfInternalResult } from "./intervening-if-eval-support.js";

export function tryEvaluateInterveningIfUniquenessCastClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
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
  const manaSpendCastSource: any = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs) ?? sourcePermanent;

  // Guardian Project-style uniqueness:
  // "if it doesn't have the same name as another creature you control or a creature card in your graveyard" (conservative)
  if (
    /^if\s+it\s+doesn't\s+have\s+the\s+same\s+name\s+as\s+another\s+creature\s+you\s+control\s+or\s+a\s+creature\s+card\s+in\s+your\s+graveyard$/i.test(
      clause
    ) ||
    /^if\s+it\s+does\s+not\s+have\s+the\s+same\s+name\s+as\s+another\s+creature\s+you\s+control\s+or\s+a\s+creature\s+card\s+in\s+your\s+graveyard$/i.test(
      clause
    )
  ) {
    if (!thisPermanentForSelfClauses) return null;
    const name = String(thisPermanentForSelfClauses?.card?.name || (thisPermanentForSelfClauses as any)?.name || '').trim();
    if (!name) return null;

    // Graveyard evidence can prove false even if battlefield tracking is missing.
    const zones = (ctx as any).state?.zones;
    const yourZones = zones && typeof zones === 'object' ? (zones as any)[String(controllerId)] : null;
    const graveyard = yourZones?.graveyard;
    if (!Array.isArray(graveyard)) return null;
    for (const c of graveyard) {
      if (!c) continue;
      const cn = String(c?.name || c?.card?.name || '').trim();
      if (!cn) continue;
      if (cn !== name) continue;
      const tl = String(c?.type_line || c?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      if (tl.includes('creature')) return false;
    }

    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;
    for (const p of battlefield) {
      if (!p) continue;
      if (String(p.controller || '') !== String(controllerId)) continue;
      if (String(p.id || '') === String((thisPermanentForSelfClauses as any).id || '')) continue;
      const tl = String(p?.card?.type_line || '').toLowerCase();
      if (!tl) return null;
      if (!tl.includes('creature')) continue;
      const otherName = String(p?.card?.name || p?.name || '').trim();
      if (!otherName) return null;
      if (otherName === name) return false;
    }

    return true;
  }

  // "if a/an/another <type> entered the battlefield under your control this turn"
  {
    const m = clause.match(
      /^if\s+(a|an|another)\s+(artifact|creature|enchantment|planeswalker|land|battle)\s+entered\s+(?:the\s+)?battlefield\s+under\s+your\s+control\s+this\s+turn$/i
    );
    if (m) {
      const kind = String(m[1] || '').toLowerCase();
      const typeLower = String(m[2] || '').toLowerCase();
      const exclude = kind === 'another' ? String((sourcePermanent as any)?.id || '') : '';
      const c = countControlledEnteredThisTurn(ctx, controllerId, typeLower, exclude || undefined);
      if (c === null) return null;
      return c > 0;
    }
  }

  // "if N or more artifacts/creatures entered the battlefield under your control this turn"
  {
    const m = clause.match(
      /^if\s+([a-z0-9]+)\s+or\s+more\s+(artifacts|creatures)\s+entered\s+(?:the\s+)?battlefield\s+under\s+your\s+control\s+this\s+turn\s*[,.]?$/i
    );
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const subject = String(m[2] || '').toLowerCase();
      const typeLower = subject === 'artifacts' ? 'artifact' : 'creature';
      const c = countControlledEnteredThisTurn(ctx, controllerId, typeLower);
      if (c === null) return null;
      return c >= n;
    }
  }

  // "if two or more artifacts entered under your control this turn" (variant without "the battlefield")
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+artifacts\s+entered\s+under\s+your\s+control\s+this\s+turn\s*[,.]?$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const c = countControlledEnteredThisTurn(ctx, controllerId, 'artifact');
      if (c === null) return null;
      return c >= n;
    }
  }

  // "if no creatures entered the battlefield under your control this turn"
  if (/^if\s+no\s+creatures\s+entered\s+(?:the\s+)?battlefield\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {
    const c = countControlledEnteredThisTurn(ctx, controllerId, 'creature');
    if (c === null) return null;
    return c === 0;
  }

  // Pack tactics / total power: "if you attacked with creatures with total power N or greater"
  {
    const m = clause.match(/^if\s+you\s+attacked\s+with\s+creatures\s+with\s+total\s+power\s+([a-z0-9]+)\s+or\s+greater(?:\s+this\s+combat)?$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getAttackingTotalPower(ctx, controllerId) >= n;
    }
  }

  // "if creatures you control have total power N or greater"
  {
    const m = clause.match(/^if\s+creatures\s+you\s+control\s+have\s+total\s+power\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const total = getControlledCreatures(ctx, controllerId).reduce((sum: number, p: any) => sum + getPermanentPower(p), 0);
      return total >= n;
    }
  }

  // "if creatures you control have total toughness N or greater"
  {
    const m = clause.match(/^if\s+creatures\s+you\s+control\s+have\s+total\s+toughness\s+([a-z0-9]+)\s+or\s+greater$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const battlefield = (ctx as any).state?.battlefield || [];
      if (!Array.isArray(battlefield)) return null;

      let total = 0;
      let unknown = false;
      for (const p of getControlledCreatures(ctx, controllerId)) {
        const candidates = [p?.effectiveToughness, p?.toughness, p?.baseToughness, p?.card?.toughness];
        let found: number | null = null;
        for (const c of candidates) {
          const parsed = parseMaybeNumber(c);
          if (parsed !== null) {
            found = parsed;
            break;
          }
        }

        if (found === null) {
          unknown = true;
          // Still use best-effort computed toughness to avoid undercounting when bonuses are tracked.
          total += getPermanentToughness(p, ctx);
        } else {
          total += found;
        }
      }

      if (total >= n) return true;
      return unknown ? null : false;
    }
  }

  // "if it's attacking alone" / "if it is attacking alone" / "if you attacked with exactly one creature"
  if (/^if\s+(?:it'?s|it\s+is)\s+attacking\s+alone$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;

    const sourceId = String((thisPermanentForSelfClauses as any)?.id || '').trim();
    const controller = String((thisPermanentForSelfClauses as any)?.controller ?? controllerId ?? '').trim();
    if (!sourceId || !controller) return null;

    // Prefer per-combat declared-attacker snapshot when available.
    const map = (ctx as any).state?.attackersDeclaredThisCombatByPlayer;
    const hasTracking = !!map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, controller);
    if (hasTracking) {
      const entries = (map as any)[controller];
      if (!Array.isArray(entries)) return null;
      const ids = new Set<string>();
      for (const e of entries) {
        const id = String((e as any)?.id ?? (e as any)?.creatureId ?? (e as any)?.permanentId ?? e ?? '').trim();
        if (id) ids.add(id);
      }
      return ids.size === 1 && ids.has(sourceId);
    }

    // Fallback: best-effort current combat state.
    const attackers = getAttackingCreatures(ctx, controller).map((p: any) => String(p?.id ?? '').trim()).filter(Boolean);
    return attackers.length === 1 && attackers[0] === sourceId;
  }
  if (/^if\s+you\s+attacked\s+with\s+exactly\s+one\s+creature$/i.test(clause)) {
    const map = (ctx as any).state?.attackersDeclaredThisCombatByPlayer;
    const hasTracking = !!map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, String(controllerId));
    if (!hasTracking) return null;

    const entries = getAttackersDeclaredThisCombat(ctx, controllerId);
    if (!Array.isArray(entries)) return null;
    return entries.length === 1;
  }
  if (/^if\s+exactly\s+one\s+creature\s+attacked$/i.test(clause)) {
    // Global check: any player. Use declared attackers snapshot (per-combat) when available.
    const tracked = (ctx as any).state?.attackersDeclaredThisCombatByPlayer;
    if (tracked && typeof tracked === 'object') {
      let total = 0;
      for (const v of Object.values(tracked)) {
        if (Array.isArray(v)) total += v.length;
      }
      return total === 1;
    }

    // Fallback: approximate via current attackers on battlefield.
    const battlefield = (ctx as any).state?.battlefield || [];
    const attacking = (Array.isArray(battlefield) ? battlefield : []).filter((p: any) => {
      if (!p) return false;
      const tl = String(p.card?.type_line || "").toLowerCase();
      if (!tl.includes("creature")) return false;
      return !!p.attacking || p.isAttacking === true;
    });
    return attacking.length === 1;
  }

  // Equipped / tapped checks (source permanent)
  if (/^if\s+it\s+is\s+equipped$/i.test(clause) || /^if\s+it'?s\s+equipped$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    if ((thisPermanentForSelfClauses as any).isEquipped === true) return true;
    const attachedEquipment = (thisPermanentForSelfClauses as any).attachedEquipment;
    if (Array.isArray(attachedEquipment)) return attachedEquipment.length > 0;
    const attachments = (thisPermanentForSelfClauses as any).attachments;
    if (Array.isArray(attachments)) {
      // Best-effort: consider any attachment as "equipped" only if that attachment looks like equipment.
      const battlefield = (ctx as any).state?.battlefield || [];
      return attachments.some((id: any) => {
        const a = (Array.isArray(battlefield) ? battlefield : []).find((p: any) => p?.id === id);
        const tl = String(a?.card?.type_line || "").toLowerCase();
        return tl.includes("equipment");
      });
    }
    return false;
  }

  if (/^if\s+it\s+is\s+tapped$/i.test(clause) || /^if\s+it'?s\s+tapped$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    return (thisPermanentForSelfClauses as any).tapped === true;
  }

  // Combat state checks (source permanent)
  if (/^if\s+it\s+is\s+attacking$/i.test(clause) || /^if\s+it'?s\s+attacking$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    return isPermanentAttacking(thisPermanentForSelfClauses);
  }

  // "if it's attacking the player with the most life (or tied for most life)" (best-effort, conservative)
  {
    const m = clause.match(
      /^if\s+it'?s\s+attacking\s+the\s+player\s+with\s+the\s+most\s+life(?:\s+or\s+tied\s+for\s+most\s+life)?$/i
    );
    if (m) {
      if (!thisPermanentForSelfClauses) return null;
      if (!isPermanentAttacking(thisPermanentForSelfClauses)) return false;

      const defendingPlayerId = getDefendingPlayerIdForInterveningIf(thisPermanentForSelfClauses, refs);
      if (!defendingPlayerId) return null;

      const ids = getAllPlayerIds(ctx, controllerId);
      if (!ids.length) return null;

      const defendingLife = getPlayerLifeMaybe(ctx, defendingPlayerId);
      if (defendingLife === null) return null;

      let knownMax = Number.NEGATIVE_INFINITY;
      let unknown = 0;

      for (const pid of ids) {
        const life = getPlayerLifeMaybe(ctx, pid);
        if (life === null) {
          unknown++;
          continue;
        }
        if (life > knownMax) knownMax = life;
      }

      // If someone known has strictly more life than the defending player, it's definitely false.
      if (knownMax !== Number.NEGATIVE_INFINITY && defendingLife < knownMax) return false;

      // If any life total is unknown, we can't be sure the defending player is tied for the max.
      if (unknown > 0) return null;

      // All known: defending player must have life equal to the max.
      return defendingLife === knownMax;
    }
  }

  if (/^if\s+it\s+is\s+blocking$/i.test(clause) || /^if\s+it'?s\s+blocking$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    return isPermanentBlocking(thisPermanentForSelfClauses);
  }

  if (/^if\s+it\s+is\s+blocked$/i.test(clause) || /^if\s+it'?s\s+blocked$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    return isPermanentBlocked(thisPermanentForSelfClauses);
  }

  if (
    /^if\s+it\s+isn'?t\s+blocked$/i.test(clause) ||
    /^if\s+it\s+is\s+not\s+blocked$/i.test(clause) ||
    /^if\s+it'?s\s+not\s+blocked$/i.test(clause) ||
    /^if\s+it'?s\s+unblocked$/i.test(clause) ||
    /^if\s+it\s+is\s+unblocked$/i.test(clause)
  ) {
    if (!thisPermanentForSelfClauses) return null;
    return !isPermanentBlocked(thisPermanentForSelfClauses);
  }

  if (/^if\s+it\s+is\s+untapped$/i.test(clause) || /^if\s+it'?s\s+untapped$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    return (thisPermanentForSelfClauses as any).tapped !== true;
  }

  // "if this creature isn't all colors"
  if (/^if\s+this\s+creature\s+isn'?t\s+all\s+colors$/i.test(clause) || /^if\s+this\s+creature\s+is\s+not\s+all\s+colors$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const colors = getExplicitColorSetFromObject(thisPermanentForSelfClauses);
    if (colors === null) return null;
    return colors.size < 5;
  }

  if (/^if\s+it\s+is\s+enchanted$/i.test(clause) || /^if\s+it'?s\s+enchanted$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    return isPermanentEnchanted(ctx, thisPermanentForSelfClauses);
  }

  if (
    /^if\s+it\s+is\s+enchanted\s+or\s+equipped$/i.test(clause) ||
    /^if\s+it'?s\s+enchanted\s+or\s+equipped$/i.test(clause)
  ) {
    if (!thisPermanentForSelfClauses) return null;
    return isPermanentEnchanted(ctx, thisPermanentForSelfClauses) || isPermanentEquipped(ctx, thisPermanentForSelfClauses);
  }

  // Covenant (Coven): "if you control three or more creatures with different powers"
  if (/^if\s+you\s+control\s+three\s+or\s+more\s+creatures\s+with\s+different\s+powers$/i.test(clause)) {
    const powers = new Set<number>();
    for (const c of getControlledCreatures(ctx, controllerId)) {
      powers.add(getPermanentPower(c));
      if (powers.size >= 3) return true;
    }
    return false;
  }

  // Biovisionary: "if you control four or more creatures named <name>"
  {
    const m = clause.match(/^if\s+you\s+control\s+four\s+or\s+more\s+creatures\s+named\s+(.+?)$/i);
    if (m) {
      const name = String(m[1] || "").trim();
      if (!name) return null;
      const lower = name.toLowerCase();
      const count = getControlledCreatures(ctx, controllerId).filter((c: any) => String(c?.card?.name || "").toLowerCase() === lower).length;
      return count >= 4;
    }
  }

  // Battle of Wits: "if you have 200 or more cards in your library"
  {
    const m = clause.match(/^if\s+you\s+have\s+([a-z0-9]+)\s+or\s+more\s+cards?\s+in\s+your\s+library$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getLibraryCount(ctx, controllerId) >= n;
    }
  }

  // Library count variants: "N or fewer" / "exactly N"
  {
    const m = clause.match(/^if\s+you\s+have\s+([a-z0-9]+)\s+or\s+(?:fewer|less)\s+cards?\s+in\s+your\s+library$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getLibraryCount(ctx, controllerId) <= n;
    }
  }
  {
    const m = clause.match(/^if\s+you\s+have\s+exactly\s+([a-z0-9]+)\s+cards?\s+in\s+your\s+library$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getLibraryCount(ctx, controllerId) === n;
    }
  }

  // Mortal Combat-style: "if there are N or more creature cards in your graveyard"
  {
    const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+creature\s+cards\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const count = getGraveyard(ctx, controllerId).filter((c: any) => String(c?.type_line || "").toLowerCase().includes("creature")).length;
      return count >= n;
    }
  }

  // "if there's a lesson card in your graveyard"
  if (/^if\s+there'?s\s+a\s+lesson\s+card\s+in\s+your\s+graveyard$/i.test(clause)) {
    return getGraveyard(ctx, controllerId).some((c: any) => String(c?.type_line || '').toLowerCase().includes('lesson'));
  }

  // Spell/ability structure checks that require stack-item context (not currently threaded into this evaluator).
  if (/^if\s+it\s+has\s+a\s+single\s+target$/i.test(clause)) {
    const c = getInterveningIfTargetCount(ctx, refs, sourcePermanent);
    if (c === null) return null;
    return c === 1;
  }
  if (/^if\s+it\s+has\s+madness$/i.test(clause)) {
    // Best-effort: determine "it" as the triggering spell on the stack.
    const fromRefs = (refs as any)?.stackItem?.card;
    const stackId =
      refs?.triggeringStackItemId ??
      (sourcePermanent as any)?.triggeringStackItemId ??
      (sourcePermanent as any)?.triggeringSpellStackItemId;
    const stack: any[] = Array.isArray((ctx as any).state?.stack) ? (ctx as any).state.stack : [];
    const triggering = !fromRefs && stackId ? stack.find((it: any) => it && String(it.id) === String(stackId)) : null;
    const card = fromRefs ?? triggering?.card;
    if (!card) return null;

    const keywords = (card as any)?.keywords;
    if (Array.isArray(keywords) && keywords.some((k: any) => String(k || '').toLowerCase().startsWith('madness'))) return true;

    const oracle = String((card as any)?.oracle_text || '').toLowerCase();
    if (!oracle) return null;
    return oracle.includes('madness');
  }

  // "if the amount of mana spent to cast it was less than its mana value" (needs stack-item cast metadata)
  if (/^if\s+the\s+amount\s+of\s+mana\s+spent\s+to\s+cast\s+it\s+was\s+less\s+than\s+its\s+mana\s+value$/i.test(clause)) {
    const stackItem = (refs as any)?.stackItem;
    const stackId =
      refs?.triggeringStackItemId ??
      (sourcePermanent as any)?.triggeringStackItemId ??
      (sourcePermanent as any)?.triggeringSpellStackItemId;

    const item =
      stackItem ??
      (stackId
        ? ((Array.isArray((ctx as any).state?.stack) ? (ctx as any).state.stack : []) as any[]).find(
            (it: any) => it && String(it.id) === String(stackId)
          )
        : null);
    if (!item) return null;

    const spent = sumManaSpentTotal(item);
    const mv = parseMaybeNumber((item as any)?.card?.manaValue ?? (item as any)?.card?.cmc ?? (item as any)?.manaValue);
    if (spent === null || mv === null) return null;
    return spent < mv;
  }
  if (/^if\s+that\s+spell\s+was\s+kicked$/i.test(clause)) {
    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs) ?? sourcePermanent;
    if (!item) return null;

    const rawBool = (item as any)?.wasKicked ?? (item as any)?.card?.wasKicked;
    if (typeof rawBool === 'boolean') return rawBool;

    // Some implementations track "times kicked" rather than a boolean.
    // Only use positive evidence to avoid replay-unsafe false negatives.
    const count =
      (item as any)?.kickerPaidCount ??
      (item as any)?.timesKicked ??
      (item as any)?.kickedTimes ??
      (item as any)?.card?.kickerPaidCount ??
      (item as any)?.card?.timesKicked ??
      (item as any)?.card?.kickedTimes;
    if (typeof count === 'number') return count > 0 ? true : null;

    return null;
  }

  // Alternate cost / casting metadata templates
  // These typically refer to the triggering spell/ability on the stack.

  // "if evidence was collected"
  if (/^if\s+evidence\s+was\s+collected$/i.test(clause)) {
    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
    const raw =
      item?.evidenceCollected ??
      item?.collectedEvidence ??
      item?.evidenceWasCollected ??
      item?.card?.evidenceCollected ??
      item?.card?.collectedEvidence ??
      item?.card?.evidenceWasCollected;
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw > 0;

    const stateAny = (ctx as any).state as any;
    const byPlayer =
      stateAny?.evidenceCollectedThisTurn ??
      stateAny?.evidenceCollectedThisTurnByPlayer ??
      stateAny?.evidenceCollectedThisTurnByPlayerCounts;
    if (byPlayer && typeof byPlayer === 'object') {
      const v = (byPlayer as any)[controllerId];
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v > 0;
    }

    return null;
  }

  // "if its prowl cost was paid"
  if (/^if\s+its\s+prowl\s+cost\s+was\s+paid$/i.test(clause)) {
    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
    if (!item) return null;
    const altId =
      item?.alternateCostId ??
      item?.alternativeCost ??
      item?.card?.alternateCostId ??
      item?.card?.alternativeCost;
    if (typeof altId === 'string' && altId.length > 0) return String(altId).toLowerCase() === 'prowl';
    const raw =
      item?.prowlCostWasPaid ??
      item?.paidProwlCost ??
      item?.prowlPaid ??
      item?.castWithProwl ??
      item?.card?.prowlCostWasPaid ??
      item?.card?.paidProwlCost ??
      item?.card?.prowlPaid ??
      item?.card?.castWithProwl;
    return typeof raw === 'boolean' ? raw : null;
  }

  // "if its surge cost was paid"
  if (/^if\s+its\s+surge\s+cost\s+was\s+paid$/i.test(clause)) {
    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
    if (!item) return null;
    const altId =
      item?.alternateCostId ??
      item?.alternativeCost ??
      item?.card?.alternateCostId ??
      item?.card?.alternativeCost;
    if (typeof altId === 'string' && altId.length > 0) return String(altId).toLowerCase() === 'surge';
    const raw =
      item?.surgeCostWasPaid ??
      item?.paidSurgeCost ??
      item?.surgePaid ??
      item?.castWithSurge ??
      item?.card?.surgeCostWasPaid ??
      item?.card?.paidSurgeCost ??
      item?.card?.surgePaid ??
      item?.card?.castWithSurge;
    return typeof raw === 'boolean' ? raw : null;
  }

  // "if its madness cost was paid"
  if (/^if\s+its\s+madness\s+cost\s+was\s+paid$/i.test(clause)) {
    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
    if (!item) return null;
    const altId =
      item?.alternateCostId ??
      item?.alternativeCost ??
      item?.card?.alternateCostId ??
      item?.card?.alternativeCost;
    if (typeof altId === 'string' && altId.length > 0) return String(altId).toLowerCase() === 'madness';
    const raw =
      item?.madnessCostWasPaid ??
      item?.paidMadnessCost ??
      item?.madnessPaid ??
      item?.castWithMadness ??
      item?.card?.madnessCostWasPaid ??
      item?.card?.paidMadnessCost ??
      item?.card?.madnessPaid ??
      item?.card?.castWithMadness;
    return typeof raw === 'boolean' ? raw : null;
  }

  // "if its spectacle cost was paid"
  if (/^if\s+its\s+spectacle\s+cost\s+was\s+paid$/i.test(clause)) {
    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
    if (!item) return null;
    const altId =
      item?.alternateCostId ??
      item?.alternativeCost ??
      item?.card?.alternateCostId ??
      item?.card?.alternativeCost;
    if (typeof altId === 'string' && altId.length > 0) return String(altId).toLowerCase() === 'spectacle';
    const raw =
      item?.spectacleCostWasPaid ??
      item?.paidSpectacleCost ??
      item?.spectaclePaid ??
      item?.castWithSpectacle ??
      item?.card?.spectacleCostWasPaid ??
      item?.card?.paidSpectacleCost ??
      item?.card?.spectaclePaid ??
      item?.card?.castWithSpectacle;
    return typeof raw === 'boolean' ? raw : null;
  }

  // "if his sneak cost was paid"
  if (/^if\s+his\s+sneak\s+cost\s+was\s+paid$/i.test(clause)) {
    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs) ?? sourcePermanent;
    if (!item) return null;
    const altId =
      item?.alternateCostId ??
      item?.alternativeCost ??
      item?.card?.alternateCostId ??
      item?.card?.alternativeCost;
    if (typeof altId === 'string' && altId.length > 0) return String(altId).toLowerCase() === 'sneak';
    const raw =
      item?.sneakCostWasPaid ??
      item?.paidSneakCost ??
      item?.sneakPaid ??
      item?.castWithSneak ??
      item?.card?.sneakCostWasPaid ??
      item?.card?.paidSneakCost ??
      item?.card?.sneakPaid ??
      item?.card?.castWithSneak;
    return typeof raw === 'boolean' ? raw : null;
  }

  // "if it was kicked twice" (best-effort; depends on kicker count metadata)
  if (/^if\s+it\s+was\s+kicked\s+twice$/i.test(clause)) {
    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs) ?? sourcePermanent;
    if (!item) return null;

    const rawCount =
      (item as any)?.kickerPaidCount ??
      (item as any)?.timesKicked ??
      (item as any)?.kickedTimes ??
      (item as any)?.card?.kickerPaidCount ??
      (item as any)?.card?.timesKicked ??
      (item as any)?.card?.kickedTimes;
    const count = parseMaybeNumber(rawCount);
    if (count !== null) return count >= 2 ? true : null;

    const rawBool =
      (item as any)?.wasKickedTwice ??
      (item as any)?.kickedTwice ??
      (item as any)?.card?.wasKickedTwice ??
      (item as any)?.card?.kickedTwice;
    if (typeof rawBool === 'boolean') return rawBool;

    const rawWasKicked = (item as any)?.wasKicked ?? (item as any)?.card?.wasKicked;
    if (rawWasKicked === false) return false;

    // Positive-only fallback: kicked implies "maybe kicked twice", but cannot prove.
    if (rawWasKicked === true) return null;
    return null;
  }

  // Inga and Esika-style: "if three or more mana from creatures was spent to cast it"
  if (/^if\s+three\s+or\s+more\s+mana\s+from\s+creatures\s+was\s+spent\s+to\s+cast\s+it$/i.test(clause)) {
    const raw =
      (manaSpendCastSource as any)?.manaFromCreaturesSpent ??
      (manaSpendCastSource as any)?.card?.manaFromCreaturesSpent;
    const n = parseMaybeNumber(raw);
    if (n !== null) return n >= 3;

    const tapped =
      (manaSpendCastSource as any)?.convokeTappedCreatures ??
      (manaSpendCastSource as any)?.card?.convokeTappedCreatures;
    if (Array.isArray(tapped)) return tapped.length >= 3 ? true : null;
    return null;
  }

  // Liberator-style: "if the amount of mana spent to cast that spell is greater than Liberator's power"
  if (/^if\s+the\s+amount\s+of\s+mana\s+spent\s+to\s+cast\s+that\s+spell\s+is\s+greater\s+than\s+liberator'?s\s+power$/i.test(clause)) {
    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
    if (!item) return null;
    const liberatorId = String(
      (sourcePermanent as any)?.id ??
        (refs as any)?.thisCreatureId ??
        (refs as any)?.thisPermanentId ??
        (refs as any)?.sourcePermanentId ??
        ''
    ).trim();
    const liberator = sourcePermanent ?? (liberatorId ? findBattlefieldPermanent(ctx, liberatorId) : null);
    if (!liberator) return null;

    const spent = sumManaSpentTotal(item);
    const pow = getPermanentPowerMaybe(liberator, ctx);
    if (spent === null || pow === null) return null;
    return spent > pow;
  }

  // Increment: the source must still be a creature, and the exact mana spent
  // for the triggering spell must exceed either of its current P/T values.
  if (/^if\s+this\s+permanent\s+is\s+a\s+creature\s+and\s+the\s+amount\s+of\s+mana\s+spent\s+to\s+cast\s+that\s+spell\s+is\s+greater\s+than\s+this\s+creature'?s\s+power\s+or\s+this\s+creature'?s\s+toughness$/i.test(clause)) {
    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
    const source = sourcePermanent ?? findBattlefieldPermanent(
      ctx,
      String((refs as any)?.sourcePermanentId ?? (refs as any)?.thisPermanentId ?? '').trim(),
    );
    if (!item || !source) return null;
    if (!String((source as any)?.card?.type_line || '').toLowerCase().includes('creature')) return false;
    const spent = sumManaSpentTotal(item);
    const power = getPermanentPowerMaybe(source, ctx);
    const toughness = getPermanentToughnessMaybe(source, ctx);
    if (spent === null || power === null || toughness === null) return null;
    return spent > power || spent > toughness;
  }

  // "if its additional cost was paid" (deterministic when `...Known` is available; otherwise positive-only)
  if (/^if\s+its\s+additional\s+cost\s+was\s+paid$/i.test(clause)) {
    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
    if (!item) return null;
    const known =
      (item as any)?.additionalCostPaidKnown ??
      (item as any)?.card?.additionalCostPaidKnown;
    const raw =
      item?.additionalCostWasPaid ??
      item?.paidAdditionalCost ??
      item?.additionalCostPaid ??
      item?.card?.additionalCostWasPaid ??
      item?.card?.paidAdditionalCost ??
      item?.card?.additionalCostPaid;

    // Deterministic: if we explicitly know the spell had an additional cost, treat boolean values as final.
    if (known === true && typeof raw === 'boolean') return raw;

    // Positive-only fallback: only return true when explicitly tracked.
    if (raw === true) return true;
    return null;
  }

  // "if at least three mana of the same color was spent to cast it"
  if (/^if\s+at\s+least\s+three\s+mana\s+of\s+the\s+same\s+color\s+was\s+spent\s+to\s+cast\s+it$/i.test(clause)) {
    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
    if (!item) return null;

    // Preferred: use canonical breakdown + completeness inference.
    const resolved = resolveManaSpentBreakdown(item);
    if (resolved) {
      const colorKeys: Array<keyof ManaSpentBreakdownResolution['amounts']> = ['white', 'blue', 'black', 'red', 'green'];
      let max = 0;
      for (const k of colorKeys) {
        const v = resolved.amounts[k];
        if (typeof v === 'number' && v > max) max = v;
      }
      if (max >= 3) return true;
      return resolved.complete ? false : null;
    }

    // Fallback for older shapes: treat as positive-only evidence.
    const breakdown =
      (item as any)?.manaSpentByColor ??
      (item as any)?.card?.manaSpentBreakdown ??
      (item as any)?.card?.manaSpentByColor;
    if (!breakdown || typeof breakdown !== 'object') return null;
    const keys = ['white', 'blue', 'black', 'red', 'green', 'w', 'u', 'b', 'r', 'g'];
    for (const k of keys) {
      const n = parseMaybeNumber((breakdown as any)[k]);
      if (n !== null && n >= 3) return true;
    }
    return null;
  }

  // "if {S} of any of that spell's colors was spent to cast it" (best-effort; snow-vs-nonsnow spend is rarely tracked)
  if (/^if\s+\{s\}\s+of\s+any\s+of\s+that\s+spell'?s\s+colors\s+was\s+spent\s+to\s+cast\s+it$/i.test(clause)) {
    const item = getTriggeringStackItemForInterveningIf(ctx, sourcePermanent, refs);
    if (!item) return null;

    // Preferred: deterministic boolean when cast pipeline could prove it.
    const known =
      (item as any)?.snowManaOfSpellColorsSpentKnown ??
      (item as any)?.card?.snowManaOfSpellColorsSpentKnown;
    const val = (item as any)?.snowManaOfSpellColorsSpent ?? (item as any)?.card?.snowManaOfSpellColorsSpent;
    if (known === true && typeof val === 'boolean') return val;

    const card = (item as any)?.card;
    const hasExplicitColorInfo = Array.isArray(card?.colors) || Array.isArray(card?.color_identity);
    if (!hasExplicitColorInfo) return null;

    const colors: any[] = Array.isArray(card?.colors) ? card.colors : Array.isArray(card?.color_identity) ? card.color_identity : [];
    const colorSet = new Set(colors.map((c: any) => String(c || '').toUpperCase()).filter(Boolean));
    if (colorSet.size === 0) return false;

    const snowByColor =
      (item as any)?.snowManaSpentByColor ??
      (item as any)?.snowSpentByColor ??
      (item as any)?.manaSpentSnowByColor ??
      (item as any)?.card?.snowManaSpentByColor;
    if (snowByColor && typeof snowByColor === 'object') {
      for (const c of Array.from(colorSet)) {
        const lower = c.toLowerCase();
        const n =
          parseMaybeNumber((snowByColor as any)[c]) ??
          parseMaybeNumber((snowByColor as any)[lower]) ??
          parseMaybeNumber((snowByColor as any)[
            c === 'W' ? 'white' : c === 'U' ? 'blue' : c === 'B' ? 'black' : c === 'R' ? 'red' : c === 'G' ? 'green' : ''
          ]);
        if (n !== null && n > 0) return true;
      }
      // Positive-only: absence here doesn't prove non-snow spend, because floating mana may have been snow.
      return null;
    }

    const snowColorsSpent = (item as any)?.snowManaColorsSpent ?? (item as any)?.snowColorsSpent ?? (item as any)?.card?.snowManaColorsSpent;
    if (Array.isArray(snowColorsSpent)) {
      return snowColorsSpent.some((c: any) => colorSet.has(String(c || '').toUpperCase())) ? true : null;
    }

    return null;
  }

  // Unearth templates (best-effort: cast metadata)
  if (/^if\s+it\s+was\s+unearthed$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const p: any = thisPermanentForSelfClauses as any;
    const v = p?.wasUnearthed ?? p?.card?.wasUnearthed ?? p?.unearthed;
    return typeof v === 'boolean' ? v : null;
  }

  // "if it wasn't cast" (recognized; requires cast metadata)
  if (/^if\s+it\s+wasn't\s+cast$/i.test(clause) || /^if\s+it\s+was\s+not\s+cast$/i.test(clause)) {
    if (!thisPermanentForSelfClauses) return null;
    const p: any = thisPermanentForSelfClauses as any;
    const wasCast = p?.wasCast ?? p?.card?.wasCast;
    if (typeof wasCast === 'boolean') return !wasCast;
    return null;
  }

  return undefined;
}
