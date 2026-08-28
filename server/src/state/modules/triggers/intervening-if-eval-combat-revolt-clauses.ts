/**
 * Origin: server/src/state/modules/triggers/intervening-if.ts
 * Cluster: evaluateInterveningIfClauseInternal clauses from "if no creatures attacked this turn"
 * through zone-threshold / revolt templates
 * Public: tryEvaluateInterveningIfCombatRevoltClauses
 */

import {
  parseCountToken,
  countCreatureCardsInGraveyard,
  getCreaturesAttackedThisTurnCount,
  getLifeLostThisTurn,
  getCreaturesDiedThisTurnTotal,
} from "./intervening-if-this-turn-counts.js";
import { findBattlefieldPermanent, getGraveyard, getLibraryCount, typeLineHasWord } from "./intervening-if-zone-lookups.js";
import { getManaValue } from "./intervening-if-mana-spent.js";
import {
  isCreatureDiedThisTurn,
  didPermanentLeaveBattlefieldThisTurn,
  countPermanentCardsInGraveyard,
  getAttackersDeclaredThisCombat,
  isPermanentAttacking,
  isPermanentBlocking,
  getAllPlayerIds,
  anyCreatureAttackedThisTurn,
  getControlledCreatures,
  isPermanentBlocked,
  getActivePlayerId,
  getOpponentInfo,
  getTeamMemberIds,
} from "./intervening-if-permanent-and-player.js";
import { UNMATCHED_INTERVENING_IF } from "./intervening-if-eval-support.js";
import type { InterveningIfPhaseArgs, InterveningIfInternalResult } from "./intervening-if-eval-support.js";

function normalizeText(text: string): string {
  return String(text || "")
    .replace(/[’]/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tryEvaluateInterveningIfCombatRevoltClauses(args: InterveningIfPhaseArgs): InterveningIfInternalResult | undefined {
  const { ctx, controllerId, clause, sourcePermanent, refs } = args;

  // "if no creatures attacked this turn"
  if (/^if\s+no\s+creatures\s+attacked\s+this\s+turn$/i.test(clause)) {
    return !anyCreatureAttackedThisTurn(ctx);
  }

  // "if a Pirate and a Vehicle attacked this combat"
  if (/^if\s+a\s+pirate\s+and\s+a\s+vehicle\s+attacked\s+this\s+combat$/i.test(clause)) {
    const tracked = (ctx as any).state?.attackersDeclaredThisCombatByPlayer;
    const hasTracking = !!tracked && typeof tracked === 'object' && Object.prototype.hasOwnProperty.call(tracked, String(controllerId));

    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;

    const consumeTypeLine = (tlRaw: unknown, sawUnknownRef: { v: boolean }, foundRef: { pirate: boolean; vehicle: boolean }) => {
      const tl = String(tlRaw ?? '').trim();
      if (!tl) {
        sawUnknownRef.v = true;
        return;
      }
      const tlLower = tl.toLowerCase();
      if (tlLower.includes('pirate')) foundRef.pirate = true;
      if (tlLower.includes('vehicle')) foundRef.vehicle = true;
    };

    if (hasTracking) {
      const entries = getAttackersDeclaredThisCombat(ctx, controllerId);
      if (!entries.length) return false;

      const found = { pirate: false, vehicle: false };
      const sawUnknown = { v: false };

      for (const e of entries) {
        let tl = (e as any)?.type_line ?? (e as any)?.typeLine;
        const id = String((e as any)?.id ?? (e as any)?.permanentId ?? '').trim();
        if (!tl && id) {
          const p = battlefield.find((p: any) => String(p?.id || '') === id);
          tl = p?.card?.type_line;
        }
        consumeTypeLine(tl, sawUnknown, found);
      }

      if (found.pirate && found.vehicle) return true;
      return sawUnknown.v ? null : false;
    }

    // Fallback (best-effort): infer attackers from battlefield.
    const attackers = battlefield.filter((p: any) => {
      if (!p) return false;
      if (String(p.controller || '') !== String(controllerId)) return false;
      return isPermanentAttacking(p);
    });
    if (attackers.length === 0) return false;

    const found = { pirate: false, vehicle: false };
    const sawUnknown = { v: false };
    for (const p of attackers) consumeTypeLine((p as any)?.card?.type_line, sawUnknown, found);

    if (found.pirate && found.vehicle) return true;
    return sawUnknown.v ? null : false;
  }

  // "if Kytheon and at least two other creatures attacked this combat"
  if (/^if\s+kytheon\s+and\s+at\s+least\s+two\s+other\s+creatures\s+attacked\s+this\s+combat$/i.test(clause)) {
    const tracked = (ctx as any).state?.attackersDeclaredThisCombatByPlayer;
    const hasTracking = !!tracked && typeof tracked === 'object' && Object.prototype.hasOwnProperty.call(tracked, String(controllerId));

    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return null;

    const tokenLower = 'kytheon';
    const startsWithKytheon = (nm: unknown) => normalizeText(String(nm ?? '')).toLowerCase().startsWith(tokenLower);

    if (hasTracking) {
      const entries = getAttackersDeclaredThisCombat(ctx, controllerId);
      if (entries.length < 3) return false;

      let sawUnknownName = false;
      for (const e of entries) {
        let name = (e as any)?.name ?? (e as any)?.cardName;
        const id = String((e as any)?.id ?? (e as any)?.permanentId ?? '').trim();
        if (!name && id) {
          const p = battlefield.find((p: any) => String(p?.id || '') === id);
          name = (p as any)?.card?.name;
        }
        const nm = String(name ?? '').trim();
        if (!nm) {
          sawUnknownName = true;
          continue;
        }
        if (startsWithKytheon(nm)) return true;
      }
      return sawUnknownName ? null : false;
    }

    // Fallback (best-effort): infer attackers from battlefield.
    const attackers = battlefield.filter((p: any) => {
      if (!p) return false;
      if (String(p.controller || '') !== String(controllerId)) return false;
      const tl = String((p as any)?.card?.type_line || '').toLowerCase();
      if (!tl.includes('creature')) return false;
      return isPermanentAttacking(p);
    });
    if (attackers.length < 3) return false;

    let sawUnknownName = false;
    for (const p of attackers) {
      const nm = String((p as any)?.card?.name ?? (p as any)?.name ?? '').trim();
      if (!nm) {
        sawUnknownName = true;
        continue;
      }
      if (startsWithKytheon(nm)) return true;
    }
    return sawUnknownName ? null : false;
  }

  // "if this creature didn't attack this turn"
  if (/^if\s+this\s+creature\s+did\s+not\s+attack\s+this\s+turn$/i.test(clause) || /^if\s+this\s+creature\s+didn't\s+attack\s+this\s+turn$/i.test(clause)) {
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
    const attackedRaw = p.attackedThisTurn;
    if (typeof attackedRaw === 'boolean') return !attackedRaw;
    if (isPermanentAttacking(p)) return false;
    return null;
  }

  // "if this creature attacked this turn"
  if (/^if\s+this\s+creature\s+attacked\s+this\s+turn$/i.test(clause)) {
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
    const attackedRaw = p.attackedThisTurn;
    if (typeof attackedRaw === 'boolean') return attackedRaw;
    return isPermanentAttacking(p) ? true : null;
  }

  // "if <Name> attacked this turn" (best-effort; assumes <Name> refers to the source permanent)
  {
    const m = clause.match(/^if\s+(.+?)\s+attacked\s+this\s+turn$/i);
    if (m) {
      const nameToken = String(m[1] || '').trim();
      if (!nameToken) return null;
      if (/^(?:you|this\s+creature|it)$/i.test(nameToken)) return UNMATCHED_INTERVENING_IF;

      const tokenLower = normalizeText(nameToken).toLowerCase();

      // Prefer sourcePermanent when it clearly refers to the named permanent.
      const sourceNameLower = normalizeText(String((sourcePermanent as any)?.card?.name ?? (sourcePermanent as any)?.name ?? '')).toLowerCase();
      if (sourcePermanent && sourceNameLower && sourceNameLower.startsWith(tokenLower)) {
        const attackedRaw = (sourcePermanent as any)?.attackedThisTurn;
        if (typeof attackedRaw === 'boolean') return attackedRaw;
        return (sourcePermanent as any)?.attackedThisTurn === true || !!(sourcePermanent as any)?.attacking || (sourcePermanent as any)?.isAttacking === true ? true : null;
      }

      const battlefield = (ctx as any).state?.battlefield;
      if (!Array.isArray(battlefield)) return null;

      const matches = battlefield.filter((p: any) => {
        const nm = String(p?.card?.name ?? p?.name ?? '').trim();
        if (!nm) return false;
        return normalizeText(nm).toLowerCase().startsWith(tokenLower);
      });

      // Absence is not authoritative here.
      if (matches.length !== 1) return null;

      const p = matches[0];
      const attackedRaw = (p as any)?.attackedThisTurn;
      if (typeof attackedRaw === 'boolean') return attackedRaw;
      return (p as any)?.attackedThisTurn === true || !!(p as any)?.attacking || (p as any)?.isAttacking === true ? true : null;
    }
  }

  // "if <Name> was kicked" (best-effort; avoid matching "if it was kicked" which has its own handler)
  {
    const m = clause.match(/^if\s+(?!it\b)(?!this\s+spell\b)(?!this\s+card\b)(?!that\s+spell\b)(?!that\s+card\b)(.+?)\s+was\s+kicked$/i);
    if (m) {
      const token = String(m[1] || '').trim();
      if (!token) return null;
      const raw =
        (refs as any)?.wasKicked ??
        (refs as any)?.card?.wasKicked ??
        (sourcePermanent as any)?.wasKicked ??
        (sourcePermanent as any)?.card?.wasKicked;
      return typeof raw === 'boolean' ? raw : null;
    }
  }

  // "if it's at least one of the chosen colors" (best-effort)
  if (/^if\s+it'?s\s+at\s+least\s+one\s+of\s+the\s+chosen\s+colors$/i.test(clause)) {
    const normalizeColor = (raw: unknown): string | null => {
      const s = String(raw ?? '').trim().toLowerCase();
      if (!s) return null;
      if (s === 'w' || s === 'white') return 'w';
      if (s === 'u' || s === 'blue') return 'u';
      if (s === 'b' || s === 'black') return 'b';
      if (s === 'r' || s === 'red') return 'r';
      if (s === 'g' || s === 'green') return 'g';
      return null;
    };

    const chosenRaw =
      (refs as any)?.chosenColors ??
      (refs as any)?.card?.chosenColors ??
      (refs as any)?.chosenColor ??
      (refs as any)?.card?.chosenColor ??
      (sourcePermanent as any)?.chosenColors ??
      (sourcePermanent as any)?.card?.chosenColors ??
      (sourcePermanent as any)?.chosenColor ??
      (sourcePermanent as any)?.card?.chosenColor;

    const chosenTokens: unknown[] = Array.isArray(chosenRaw) ? chosenRaw : [chosenRaw];
    const chosen = chosenTokens.map(normalizeColor).filter(Boolean) as string[];
    if (!chosen.length) return null;

    const itColorsRaw =
      (refs as any)?.colors ??
      (refs as any)?.card?.colors ??
      (refs as any)?.color_identity ??
      (refs as any)?.card?.color_identity ??
      (refs as any)?.colorIdentity ??
      (refs as any)?.card?.colorIdentity ??
      (sourcePermanent as any)?.colors ??
      (sourcePermanent as any)?.card?.colors ??
      (sourcePermanent as any)?.color_identity ??
      (sourcePermanent as any)?.card?.color_identity ??
      (sourcePermanent as any)?.colorIdentity ??
      (sourcePermanent as any)?.card?.colorIdentity;

    // If we have an explicit array (including empty), we can be deterministic.
    if (!Array.isArray(itColorsRaw)) return null;
    const itColors = (itColorsRaw as unknown[]).map(normalizeColor).filter(Boolean) as string[];

    // Known colorless (empty colors array) => definitely not one of the chosen colors.
    if (itColors.length === 0) return false;

    return itColors.some((c: string) => chosen.includes(c));
  }

  // "if this creature attacked or blocked this turn"
  if (/^if\s+this\s+creature\s+attacked\s+or\s+blocked\s+this\s+turn$/i.test(clause)) {
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

    const attackedRaw = p.attackedThisTurn;
    const attacked =
      typeof attackedRaw === 'boolean'
        ? attackedRaw
        : (isPermanentAttacking(p) ? true : null);

    const blockedRaw = p.blockedThisTurn;
    const blocked =
      typeof blockedRaw === 'boolean'
        ? blockedRaw
        : (isPermanentBlocking(p) ? true : null);

    if (attacked === true || blocked === true) return true;
    if (attacked === false && blocked === false) return false;
    return null;
  }

  // "if it was blocked this turn"
  if (/^if\s+it\s+was\s+blocked\s+this\s+turn$/i.test(clause)) {
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
    const v =
      p.wasBlockedThisTurn ??
      p.card?.wasBlockedThisTurn ??
      p.blockedThisTurn ??
      p.wasBlockedThisTurn ??
      p.card?.blockedThisTurn;
    if (typeof v === 'boolean') return v;
    // In-combat evidence: if it is currently blocked, it must have been blocked this turn.
    if (isPermanentBlocked(p)) return true;
    return null;
  }

  // "if this Vehicle attacked or blocked this combat"
  if (/^if\s+this\s+vehicle\s+attacked\s+or\s+blocked\s+this\s+combat$/i.test(clause)) {
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

    const attacked = p.attackedThisTurn === true || isPermanentAttacking(p);
    const blocked = p.blockedThisTurn === true || isPermanentBlocking(p);
    if (attacked || blocked) return true;
    return null;
  }

  // "if your team controls another Warrior" (team-aware; falls back to a singleton team when no team data exists)
  if (/^if\s+your\s+team\s+controls\s+another\s+warrior$/i.test(clause)) {
    const teamIds = getTeamMemberIds(ctx, controllerId);
    const battlefield = (ctx as any).state?.battlefield || [];
    const sourceId = String((sourcePermanent as any)?.id || '');

    let count = 0;
    for (const pid of teamIds) {
      const creatures = getControlledCreatures(ctx, String(pid));
      for (const c of creatures) {
        if (!c) continue;
        if (sourceId && String(c.id) === sourceId) continue;
        const tl = String(c?.card?.type_line || '');
        if (typeLineHasWord(tl, 'warrior')) count++;
      }
    }

    // If we have battlefield tracking, we can safely return false when count is 0.
    // If battlefield isn't an array (corrupt state), be conservative.
    if (!Array.isArray(battlefield)) return null;
    return count >= 1;
  }

  // "if a creature died this turn" (Morbid)
  if (/^if\s+a\s+creature\s+died\s+this\s+turn$/i.test(clause)) {
    const v = isCreatureDiedThisTurn(ctx);
    return v;
  }

  // "if no creatures died this turn"
  if (/^if\s+no\s+creatures\s+died\s+this\s+turn$/i.test(clause)) {
    // Only the explicit boolean is authoritative. An empty
    // creaturesDiedThisTurnByController map is not "no deaths" — it is
    // incomplete tracking and must stay unknown (null).
    const diedFlag = (ctx as any).state?.creatureDiedThisTurn;
    if (typeof diedFlag === 'boolean') return !diedFlag;

    const stateAny: any = (ctx as any).state || {};
    const map = stateAny?.creaturesDiedThisTurnByController;
    if (!map || typeof map !== 'object') return null;

    const players = Array.isArray(stateAny.players) ? stateAny.players : [];
    const ids = players.map((p: any) => String(p?.id || '')).filter(Boolean);
    if (ids.length && !ids.every((pid: string) => typeof (map as any)[pid] === 'number')) return null;

    const total = (Object.values(map as any) as any[]).reduce((sum: number, v: any) => sum + (typeof v === 'number' ? v : 0), 0);
    return total === 0;
  }

  // "if a creature died under your control this turn"
  if (/^if\s+a\s+creature\s+died\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {
    const map = (ctx as any).state?.creaturesDiedThisTurnByController;
    if (!map || typeof map !== 'object') {
      const morbid = isCreatureDiedThisTurn(ctx);
      return morbid === false ? false : null;
    }
    const v = (map as any)[String(controllerId)];
    return typeof v === 'number' ? v > 0 : null;
  }

  // "if N or more creatures died under your control this turn"
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+creatures\s+died\s+under\s+your\s+control\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const map = (ctx as any).state?.creaturesDiedThisTurnByController;
      if (!map || typeof map !== 'object') {
        const morbid = isCreatureDiedThisTurn(ctx);
        return morbid === false ? false : null;
      }
      const v = (map as any)[String(controllerId)];
      return typeof v === 'number' ? v >= n : null;
    }
  }

  // "if N or more creatures died this turn"
  {
    const m = clause.match(/^if\s+([a-z0-9]+)\s+or\s+more\s+creatures\s+died\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      return getCreaturesDiedThisTurnTotal(ctx) >= n;
    }
  }

  // "if an opponent lost N or more life this turn"
  {
    const m = clause.match(/^if\s+an\s+opponent\s+lost\s+([a-z0-9]+)\s+or\s+more\s+life\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const { opponents: opps, unknown } = getOpponentInfo(ctx, controllerId);
      if (unknown) return null;
      return opps.some((oid) => getLifeLostThisTurn(ctx, oid) >= n);
    }
  }

  // "if a player lost N or more life this turn" (any player)
  {
    const m = clause.match(/^if\s+a\s+player\s+lost\s+([a-z0-9]+)\s+or\s+more\s+life\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      const map = (ctx as any).state?.lifeLostThisTurn;
      if (!map || typeof map !== 'object') return null;
      const playerIds = getAllPlayerIds(ctx, controllerId);
      const ids = playerIds.length ? playerIds : Object.keys(map).map(String);
      return ids.some((pid) => {
        const v = (map as any)[pid];
        return typeof v === 'number' && v >= n;
      });
    }
  }

  // "if a player has more life than each other player" (life leader)
  if (/^if\s+a\s+player\s+has\s+more\s+life\s+than\s+each\s+other\s+player$/i.test(clause)) {
    const life = (ctx as any).state?.life;
    if (!life || typeof life !== 'object') return null;
    const ids = getAllPlayerIds(ctx, controllerId);
    if (!ids.length) return null;

    for (const pid of ids) {
      const v = (life as any)[pid];
      if (typeof v !== 'number') continue;
      const isLeader = ids.every((other) => {
        if (other === pid) return true;
        const ov = (life as any)[other];
        return typeof ov === 'number' ? v > ov : true;
      });
      if (isLeader) return true;
    }
    return false;
  }

  // "if it's your main phase"
  if (/^if\s+it'?s\s+your\s+main\s+phase$/i.test(clause) || /^if\s+it\s+is\s+your\s+main\s+phase$/i.test(clause)) {
    const active = getActivePlayerId(ctx);
    if (!active) return null;
    if (String(active) !== String(controllerId)) return false;
    const phase = String((ctx as any).state?.phase || (ctx as any).state?.turn?.phase || '').toLowerCase();
    if (!phase) return null;
    return phase.includes('main');
  }

  // "if a permanent you controlled left the battlefield this turn" (Revolt)
  if (/^if\s+a\s+permanent\s+you\s+controlled\s+left\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {
    return didPermanentLeaveBattlefieldThisTurn(ctx, controllerId);
  }

  // Alternate Revolt phrasing: "if a permanent left the battlefield under your control this turn"
  if (/^if\s+(?:one\s+or\s+more\s+)?a\s+permanent\s+left\s+the\s+battlefield\s+under\s+your\s+control\s+this\s+turn$/i.test(clause)) {
    return didPermanentLeaveBattlefieldThisTurn(ctx, controllerId);
  }

  // "if no permanents left the battlefield this turn"
  if (/^if\s+no\s+permanents\s+left\s+the\s+battlefield\s+this\s+turn$/i.test(clause)) {
    const stateAny: any = (ctx as any).state || {};
    const map = stateAny?.permanentLeftBattlefieldThisTurn;
    if (!map || typeof map !== 'object') return null;

    const players = Array.isArray(stateAny.players) ? stateAny.players : [];
    const ids = players.map((p: any) => String(p?.id || '')).filter(Boolean);
    if (!ids.length) return null;

    for (const pid of ids) {
      const v = (map as any)[pid];
      if (typeof v !== 'boolean') return null;
      if (v === true) return false;
    }
    return true;
  }

  // "if a nonland permanent left the battlefield this turn or a spell was warped this turn"
  if (/^if\s+a\s+nonland\s+permanent\s+left\s+the\s+battlefield\s+this\s+turn\s+or\s+a\s+spell\s+was\s+warped\s+this\s+turn$/i.test(clause)) {
    const left = didPermanentLeaveBattlefieldThisTurn(ctx, controllerId);
    const warpedMap = (ctx as any).state?.spellWasWarpedThisTurn;
    const warped = warpedMap && typeof warpedMap === 'object' ? (warpedMap as any)[controllerId] : undefined;
    const warpedBool = typeof warped === 'boolean' ? warped : false;

    return left || warpedBool;
  }

  // "if you descended this turn"
  if (/^if\s+you\s+descended\s+this\s+turn$/i.test(clause)) {
    const stateAny: any = (ctx as any).state || {};
    const map = stateAny?.descendedThisTurn;

    const tracked = map && typeof map === 'object' ? (map as any)[controllerId] : undefined;
    return typeof tracked === 'boolean' ? tracked : false;
  }

  // "if you attacked with N or more creatures this turn" (Planechase and similar)
  {
    const m = clause.match(/^if\s+you\s+attacked\s+with\s+([a-z0-9]+)\s+or\s+more\s+creatures\s+this\s+turn$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return getCreaturesAttackedThisTurnCount(ctx, controllerId) >= n;
    }
  }

  // ===== Zone thresholds (graveyard/library) =====

  // "if you have no cards in your library"
  if (/^if\s+you\s+have\s+no\s+cards\s+in\s+your\s+library$/i.test(clause)) {
    return getLibraryCount(ctx, controllerId) === 0;
  }

  // "if there are N or more creature cards in your graveyard"
  {
    const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+creature\s+cards\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return countCreatureCardsInGraveyard(ctx, controllerId) >= n;
    }
  }

  // "if there are no creature cards in your graveyard"
  if (/^if\s+there\s+are\s+no\s+creature\s+cards\s+in\s+your\s+graveyard$/i.test(clause)) {
    return countCreatureCardsInGraveyard(ctx, controllerId) === 0;
  }

  // "if you have N or more creature cards in your graveyard"
  {
    const m = clause.match(/^if\s+you\s+have\s+([a-z0-9]+)\s+or\s+more\s+creature\s+cards\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return countCreatureCardsInGraveyard(ctx, controllerId) >= n;
    }
  }

  // "if there are N or more permanent cards in your graveyard"
  {
    const m = clause.match(/^if\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+permanent\s+cards\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return countPermanentCardsInGraveyard(ctx, controllerId) >= n;
    }
  }

  // "if you have N or more permanent cards in your graveyard"
  {
    const m = clause.match(/^if\s+you\s+have\s+([a-z0-9]+)\s+or\s+more\s+permanent\s+cards\s+in\s+your\s+graveyard$/i);
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;
      return countPermanentCardsInGraveyard(ctx, controllerId) >= n;
    }
  }

  // "if you cast it and there are N or more creature cards with mana value M or less among cards in your graveyard" (Inquisitor Captain)
  {
    const m = clause.match(
      /^if\s+you\s+cast\s+it\s+and\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+creature\s+cards\s+with\s+mana\s+value\s+([a-z0-9]+)\s+or\s+less\s+among\s+cards\s+in\s+your\s+graveyard$/i
    );
    if (m) {
      const n = parseCountToken(m[1]);
      const mvLimit = parseCountToken(m[2]);
      if (n === null || mvLimit === null) return null;

      const graveyard = getGraveyard(ctx, controllerId);
      let qualifying = 0;
      let maybeQualifying = 0;

      for (const c of Array.isArray(graveyard) ? graveyard : []) {
        const tl = String((c as any)?.type_line ?? '').toLowerCase();
        if (!tl.includes('creature')) continue;

        const mv = getManaValue(c);
        if (typeof mv !== 'number') {
          maybeQualifying += 1;
          continue;
        }
        if (mv <= mvLimit) qualifying += 1;
      }

      let countOk: boolean | null = null;
      if (qualifying >= n) countOk = true;
      else if (qualifying + maybeQualifying < n) countOk = false;

      if (countOk === false) return false;

      // Now check the "you cast it" half.
      const p: any =
        sourcePermanent ??
        (() => {
          const id = String(
            (refs as any)?.thisPermanentId ??
              (refs as any)?.thisCreatureId ??
              (refs as any)?.thisId ??
              (refs as any)?.sourcePermanentId ??
              ''
          ).trim();
          if (!id) return null;
          return findBattlefieldPermanent(ctx, id);
        })();
      if (!p) return null;
      const direct =
        p?.enteredFromCast ??
        p?.wasCast ??
        p?.card?.enteredFromCast ??
        p?.card?.wasCast;
      if (typeof direct === 'boolean') return direct ? countOk : false;

      const sourceZone =
        p?.castSourceZone ??
        p?.source ??
        p?.card?.castSourceZone ??
        p?.card?.source;
      if (typeof sourceZone === 'string' && sourceZone.length > 0) return countOk;

      const fromHand = p?.castFromHand ?? p?.card?.castFromHand;
      if (typeof fromHand === 'boolean') return countOk;

      return null;
    }
  }

  // "if you cast it from your hand and there are N or more other creatures on the battlefield" (Deathbringer Regent)
  {
    const m = clause.match(
      /^if\s+you\s+cast\s+it\s+from\s+your\s+hand\s+and\s+there\s+are\s+([a-z0-9]+)\s+or\s+more\s+other\s+creatures\s+on\s+the\s+battlefield$/i
    );
    if (m) {
      const n = parseCountToken(m[1]);
      if (n === null) return null;

      const battlefield = (ctx as any).state?.battlefield || [];
      const creatures = (Array.isArray(battlefield) ? battlefield : []).filter((p: any) => {
        const tl = String(p?.card?.type_line ?? '').toLowerCase();
        return tl.includes('creature');
      });
      const totalCreatures = creatures.length;

      // Count "other creatures" by excluding the source permanent when possible.
      let otherCreatures: number | null = null;
      const p: any =
        sourcePermanent ??
        (() => {
          const id = String(
            (refs as any)?.thisPermanentId ??
              (refs as any)?.thisCreatureId ??
              (refs as any)?.thisId ??
              (refs as any)?.sourcePermanentId ??
              ''
          ).trim();
          if (!id) return null;
          return findBattlefieldPermanent(ctx, id);
        })();
      if (!p) {
        otherCreatures = totalCreatures < n ? totalCreatures : null;
      } else {
        const sourceId = String(p?.id ?? '');
        const sourceTypeLine = String(p?.card?.type_line ?? p?.type_line ?? '').toLowerCase();
        const sourceIsCreature = sourceTypeLine.includes('creature');

        if (sourceIsCreature && sourceId) {
          const sourceOnBattlefield = creatures.some((p: any) => String(p?.id ?? '') === sourceId);
          otherCreatures = sourceOnBattlefield ? Math.max(0, totalCreatures - 1) : totalCreatures;
        } else if (sourceIsCreature) {
          otherCreatures = totalCreatures < n ? totalCreatures : null;
        } else {
          otherCreatures = totalCreatures;
        }
      }

      if (otherCreatures !== null && otherCreatures < n) return false;
      if (otherCreatures === null) return null;

      // Now check "cast it from your hand".
      const fromHand = p?.castFromHand ?? p?.card?.castFromHand;
      if (typeof fromHand === 'boolean') return fromHand ? true : false;
      const sourceZone =
        p?.castSourceZone ??
        p?.source ??
        p?.card?.castSourceZone ??
        p?.card?.source;
      if (typeof sourceZone === 'string') return String(sourceZone).toLowerCase() === 'hand';

      return null;
    }
  }

  return undefined;
}
