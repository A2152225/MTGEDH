/**
 * Spell-created "This turn, whenever <event>, <effect>" triggered abilities (Pure Intentions).
 * When the spell resolves, its turn-scoped clause is recorded as a pseudo trigger source that
 * event watchers (discard, dies, spell cast) scan alongside the battlefield until the turn ends (CR 603.7c-like).
 */

import { IMPULSE_PLAY_RIDER } from './impulsePlayRider.js';
import { extractModalModesFromOracleText, matchModalModeOptions } from '../../../utils/oraclePromptContext.js';

// A clause may end inside a granted quoted ability (Gnawing Crescendo: ...can't block.").
// Modal bullets ("\u2022 Until end of turn, whenever ...", Shriveling Rot) may prefix a clause.
// "If this spell was kicked, ..." (Warhost's Frenzy) gates the clause on the cast.
const THIS_TURN_WHENEVER = /(?:^|\n|\.\s+)(?:\u2022\s*)?(if this spell was kicked, )?(?:this turn|until end of turn), (whenever [^\n]+?\.["\u201d]?)(?=\s|$)/gi;
// "Whenever <event> this turn, <effect>." (Glimpse of Nature, Death Frenzy, Rite of Harmony).
const WHENEVER_THIS_TURN = /(?:^|\n|\.\s+)(?:\u2022\s*)?(if this spell was kicked, )?whenever ([^\n.,]*?) this turn, ([^\n]+?\.["\u201d]?)(?=\s|$)/gi;
// A following "If you do, ..." sentence belongs to the clause (Gaze of Pain: "... it assigns no combat damage this turn.").
const IF_YOU_DO_RIDER = /^\s+(if you (?:do|don't),[^\n]+?\.["\u201d]?)(?=\s|$)/i;
// Conditions tied to a chosen object or to how the spell resolved need per-spell context; skip them.
const CONTEXT_BOUND = /\b(?:that|this way|it|its|target|those)\b/i;
// Entry watchers are already granted by the Oracle IR (grant_temporary_etb_trigger -> temporaryEtbTriggers).
const ETB_EVENT = /\benters?\b/i;
// "Whenever that creature / it deals [combat] damage ..." (Hunter's Insight, Fire Giant's Fury, Vigorous Charge):
// bound to the spell's target permanent; the subject is rewritten generically and filtered by binding.
const BOUND_DEALS_DAMAGE = /^(?:that creature|it) (deals (?:combat )?damage\b.*)$/i;
// "..., if this spell was kicked, <effect>" inside the effect (Vigorous Charge).
const KICKED_EFFECT = /^if this spell was kicked, /i;

// Follow-on sentence granting play of the exiled cards (Fire Giant's Fury): part of the trigger's effect.
const PLAY_RIDER = IMPULSE_PLAY_RIDER;
// "a creature [you control] dealt damage this way dies" (Reckless Blaze, Ghired's Belligerence): watch only creatures the spell damaged.
const DAMAGE_WAY_DIES = /^(a creature(?: you control)?) dealt damage this way (dies)$/i;
// "... to that player" after "Choose target opponent/player" (Great Train Heist): bound to the targeted player.
const THAT_PLAYER = /\bthat player\b/i;
type Clause = { text: string; bound?: boolean; anyRecipient?: boolean; damageWay?: boolean; playerBound?: boolean };

function extractClauses(oracle: string, wasKicked = false): Clause[] {
  const out: Clause[] = [];
  for (const m of oracle.matchAll(THIS_TURN_WHENEVER)) {
    if (m[1] && !wasKicked) continue;
    const rider = oracle.slice((m.index || 0) + m[0].length).match(IF_YOU_DO_RIDER);
    const clause = (String(m[2] || '').trim() + (rider ? ' ' + rider[1].trim() : '')).trim();
    const cond = clause.split(',')[0] || '';
    if (clause && !CONTEXT_BOUND.test(cond.replace(/^whenever\s+/i, '')) && !ETB_EVENT.test(cond)) out.push({ text: clause });
  }
  for (const m of oracle.matchAll(WHENEVER_THIS_TURN)) {
    if (m[1] && !wasKicked) continue;
    const cond = String(m[2] || '').trim();
    let effect = String(m[3] || '').trim();
    const playRider = oracle.slice((m.index || 0) + m[0].length).match(PLAY_RIDER);
    if (playRider) effect = `${effect} ${playRider[1].trim()}`;
    if (KICKED_EFFECT.test(effect)) {
      if (!wasKicked) continue;
      effect = effect.replace(KICKED_EFFECT, '');
    }
    const damageWay = cond.match(DAMAGE_WAY_DIES);
    if (damageWay && effect) { out.push({ text: `whenever ${damageWay[1]} ${damageWay[2]}, ${effect}`, damageWay: true }); continue; }
    if (THAT_PLAYER.test(cond) && /^a creature\b[^,]*\bdeals? (?:combat )?damage to that player$/i.test(cond) && effect) {
      out.push({ text: `whenever ${cond.replace(THAT_PLAYER, 'a player')}, ${effect}`, playerBound: true });
      continue;
    }
    const bound = cond.match(BOUND_DEALS_DAMAGE);
    if (bound && effect && !/\bthis spell\b/i.test(effect)) {
      // Unqualified "deals combat damage" (rule 510): any recipient, one event per damage step; the combat queue fires it with the total.
      const anyRecipient = /^deals combat damage$/i.test(bound[1].trim());
      out.push({ text: `whenever a creature ${bound[1]}, ${effect}`, bound: true, ...(anyRecipient ? { anyRecipient } : {}) });
      continue;
    }
    if (!cond || !effect || CONTEXT_BOUND.test(cond) || ETB_EVENT.test(cond) || /\bthis spell\b/i.test(effect)) continue;
    out.push({ text: `whenever ${cond}, ${effect}` });
  }
  return out;
}

/** Drop the lines of modes that were not chosen, so only the selected modes' watchers register. */
function restrictToSelectedModes(oracle: string, selectedModes?: readonly unknown[]): string {
  const ids = (Array.isArray(selectedModes) ? selectedModes : []).map((m) => String(m || '').trim()).filter(Boolean);
  if (ids.length === 0) return oracle;
  const info = extractModalModesFromOracleText(oracle);
  if (!info || info.options.length < 2) return oracle;
  const chosen = matchModalModeOptions(info, ids);
  if (chosen.length === 0) return oracle;
  const dropped = info.options.filter((option) => !chosen.includes(option)).map((option) => String(option.raw || '').trim()).filter(Boolean);
  return oracle.split('\n').filter((line) => !dropped.some((raw) => line.includes(raw))).join('\n');
}

// "for each [creature] card milled / put into your graveyard this way" (Song of Blood): counted once the spell leaves the stack.
const THIS_WAY_COUNT = /\s*for each (creature |land |artifact |instant |sorcery |enchantment )?card (?:milled|put into (?:your|a|their) graveyard) this way/i;

function graveyardOf(state: any, playerId: string): any[] {
  const gy = state?.zones?.[playerId]?.graveyard;
  return Array.isArray(gy) ? gy : [];
}

/** Rewrite "+a/+b ... for each X this way" as "+(a*n)/+(b*n) ...", or annotate the count. */
export function applyThisWayCount(text: string, count: number): string {
  if (!THIS_WAY_COUNT.test(text)) return text;
  const stripped = text.replace(THIS_WAY_COUNT, '');
  const pt = stripped.match(/([+-])(\d+)\/([+-])(\d+)/);
  if (pt) {
    const scaled = `${pt[1]}${Number(pt[2]) * count}/${pt[3]}${Number(pt[4]) * count}`;
    return stripped.replace(pt[0], scaled);
  }
  return stripped.replace(/\bdraw a card\b/i, count === 1 ? 'draw a card' : `draw ${count} cards`)
    .replace(/\b(gain|lose) 1 life\b/i, (_m, verb) => `${verb} ${count} life`);
}

function finalizeThisWayCounts(state: any, entries: any[]): void {
  const stackIds = new Set((Array.isArray(state?.stack) ? state.stack : []).map((s: any) => String(s?.id || '')));
  for (const entry of entries) {
    const pending = entry?.thisWayPending;
    if (!pending || stackIds.has(String(entry.registrationKey || ''))) continue;
    const before = new Set<string>((pending.baseline || []).map(String));
    const typeWord = String(pending.typeWord || '').trim();
    const added = graveyardOf(state, pending.playerId).filter((c: any) => {
      if (before.has(String(c?.id || ''))) return false;
      return !typeWord || new RegExp('\\b' + typeWord + '\\b', 'i').test(String(c?.type_line || c?.card?.type_line || ''));
    });
    entry.thisWayCount = added.length;
    entry.card.oracle_text = applyThisWayCount(String(entry.card.oracle_text || ''), added.length);
    delete entry.thisWayPending;
  }
}

function currentTurn(state: any): number {
  return Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
}

/**
 * Resolution text without its "whenever ... this turn" delayed-trigger sentences (and their riders):
 * those only create turn-scoped trigger sources and must not run when the spell resolves
 * (Great Train Heist: "Choose target opponent. Whenever a creature you control deals combat damage to that player this turn, create a tapped Treasure token.").
 */
export function stripTurnScopedTriggerSentences(oracle: string): string {
  // Only strip clauses this module registers; context-bound ones (Touch of Moonglove) stay with resolution.
  const lead = (whole: string) => (/^\n/.test(whole) ? '\n' : /^\./.test(whole) ? '.' : '');
  let text = String(oracle || '');
  text = text.replace(THIS_TURN_WHENEVER, (whole: string, kicked: string, clause: string) => {
    const cond = String(clause || '').split(',')[0].replace(/^whenever\s+/i, '');
    return kicked || CONTEXT_BOUND.test(cond) || ETB_EVENT.test(cond) ? whole : lead(whole);
  });
  text = text.replace(WHENEVER_THIS_TURN, (whole: string, kicked: string, rawCond: string, rawEffect: string) => {
    const cond = String(rawCond || '').trim();
    const effect = String(rawEffect || '').trim();
    if (kicked || !cond || !effect || KICKED_EFFECT.test(effect) || /\bthis spell\b/i.test(effect)) return whole;
    // Batched "one or more ... deal combat damage" watchers (Forth Eorlingas!) still resolve via the legacy delayed-trigger path.
    if (/\bone or more\b/i.test(cond)) return whole;
    const registered = DAMAGE_WAY_DIES.test(cond)
      || (THAT_PLAYER.test(cond) && /^a creature\b[^,]*\bdeals? (?:combat )?damage to that player$/i.test(cond))
      || BOUND_DEALS_DAMAGE.test(cond)
      || (!CONTEXT_BOUND.test(cond) && !ETB_EVENT.test(cond));
    return registered ? lead(whole) : whole;
  });
  return text.trim();
}

export function registerTurnScopedSpellTriggers(state: any, card: any, controllerId: string, stackItemId?: string, selectedModes?: readonly unknown[], castInfo?: { wasKicked?: boolean; targets?: readonly unknown[] }): number {
  if (!state || !card) return 0;
  const oracle = restrictToSelectedModes(String(card?.oracle_text || ''), selectedModes);
  const firstTarget = (Array.isArray(castInfo?.targets) ? castInfo!.targets : [])
    .map((tgt: any) => String(typeof tgt === 'string' ? tgt : (tgt?.id ?? tgt?.permanentId ?? '')))
    .find((id) => id && (state.battlefield || []).some((p: any) => String(p?.id) === id));
  const firstPlayerTarget = (Array.isArray(castInfo?.targets) ? castInfo!.targets : [])
    .map((tgt: any) => String(typeof tgt === 'string' ? tgt : (tgt?.id ?? tgt?.playerId ?? '')))
    .find((id) => id && (state.players || []).some((p: any) => String(p?.id) === id));
  const clauses = extractClauses(oracle, castInfo?.wasKicked === true || card?.wasKicked === true)
    .filter((c) => (!c.bound || Boolean(firstTarget)) && (!c.playerBound || Boolean(firstPlayerTarget)));
  if (clauses.length === 0) return 0;
  const turn = currentTurn(state);
  const key = String(stackItemId || card?.id || '');
  const existing: any[] = Array.isArray(state.turnScopedSpellTriggers) ? state.turnScopedSpellTriggers : [];
  const kept = existing.filter((entry: any) => Number(entry?.turn) === turn);
  if (key && kept.some((entry: any) => entry?.registrationKey === key)) {
    state.turnScopedSpellTriggers = kept;
    return 0;
  }
  const name = String(card?.name || 'Spell');
  clauses.forEach(({ text: clause, bound, anyRecipient, damageWay, playerBound }, i) => {
    const thisWay = clause.match(THIS_WAY_COUNT);
    const thisWayPending = thisWay ? {
      playerId: String(controllerId || ''),
      typeWord: String(thisWay[1] || '').trim(),
      baseline: graveyardOf(state, String(controllerId || '')).map((c: any) => String(c?.id || '')),
    } : undefined;
    kept.push({
      ...(thisWayPending ? { thisWayPending } : {}),
      ...(bound ? { boundPermanentId: firstTarget } : {}),
      ...(anyRecipient ? { combatDamageAnyRecipient: true } : {}),
      ...(playerBound ? { boundPlayerId: firstPlayerTarget } : {}),
      ...(damageWay ? { damageWayBaseline: creatureDamageSnapshot(state) } : {}),
      id: `turn-scoped:${key || name}:${i}`,
      registrationKey: key,
      turn,
      controller: String(controllerId || ''),
      owner: String(controllerId || ''),
      isTurnScopedSpellTrigger: true,
      card: { name, type_line: String(card?.type_line || 'Instant'), oracle_text: clause.charAt(0).toUpperCase() + clause.slice(1) },
    });
  });
  state.turnScopedSpellTriggers = kept;
  return clauses.length;
}

/** Pseudo trigger sources still active this turn. */
export function getTurnScopedSpellTriggerSources(state: any): any[] {
  const list: any[] = Array.isArray(state?.turnScopedSpellTriggers) ? state.turnScopedSpellTriggers : [];
  const turn = currentTurn(state);
  const active = list.filter((entry: any) => entry && Number(entry.turn) === turn && entry.card);
  finalizeThisWayCounts(state, active);
  // Until the spell has finished resolving, its "this way" count is unknown; don't fire yet.
  return active.filter((entry: any) => !entry.thisWayPending && !entry.boundPermanentId && !entry.boundPlayerId && !entry.damageWayBaseline);
}

/** Sources bound to one permanent ("that creature" / "it"), active only for events whose subject is that permanent. */
export function getBoundTurnScopedSpellTriggerSources(state: any, subjectPermanentId: string): any[] {
  const list: any[] = Array.isArray(state?.turnScopedSpellTriggers) ? state.turnScopedSpellTriggers : [];
  const turn = currentTurn(state);
  return list.filter((entry: any) => entry?.card && Number(entry.turn) === turn
    && String(entry.boundPermanentId || entry.boundPlayerId || '') !== '' && String(entry.boundPermanentId || entry.boundPlayerId) === String(subjectPermanentId || ''));
}

function damageOf(p: any): number {
  return Math.max(Number(p?.damageThisTurn || 0), Number(p?.markedDamage || 0), Number(p?.damage || 0), Number(p?.damageMarked || 0));
}

function creatureDamageSnapshot(state: any): Record<string, number> {
  const snap: Record<string, number> = {};
  for (const p of Array.isArray(state?.battlefield) ? state.battlefield : []) if (p?.id) snap[String(p.id)] = damageOf(p);
  return snap;
}

/** "dealt damage this way dies" sources whose spell (now off the stack) increased the dying creature's damage. */
export function getDamageWayDiesSources(state: any, dyingCreature: any): any[] {
  const list: any[] = Array.isArray(state?.turnScopedSpellTriggers) ? state.turnScopedSpellTriggers : [];
  const turn = currentTurn(state);
  const stackIds = new Set((Array.isArray(state?.stack) ? state.stack : []).map((s: any) => String(s?.id || '')));
  const id = String(dyingCreature?.id || '');
  return list.filter((entry: any) => {
    if (!entry?.card || !entry.damageWayBaseline || Number(entry.turn) !== turn) return false;
    if (!entry.damagedThisWayIds && !stackIds.has(String(entry.registrationKey || ''))) {
      // Finalize once resolved: creatures still on the battlefield with more damage than at cast.
      entry.damagedThisWayIds = (state.battlefield || []).filter((p: any) => damageOf(p) > Number(entry.damageWayBaseline[String(p?.id)] || 0)).map((p: any) => String(p.id));
      entry.finalizedBattlefieldIds = (state.battlefield || []).map((p: any) => String(p?.id || ''));
    }
    if (Array.isArray(entry.damagedThisWayIds) && entry.damagedThisWayIds.includes(id)) return true;
    // Died before finalization (during or right after resolution): judge from its last-known damage.
    const diedBefore = !entry.finalizedBattlefieldIds || !entry.finalizedBattlefieldIds.includes(id);
    // A creature that left during the spell's own resolution (SBA may clear its damage) counts as dealt damage this way.
    const leftDuringResolution = !!entry.finalizedBattlefieldIds && damageOf(dyingCreature) === 0;
    return diedBefore && id in entry.damageWayBaseline && (leftDuringResolution || damageOf(dyingCreature) > Number(entry.damageWayBaseline[id] || 0));
  });
}
