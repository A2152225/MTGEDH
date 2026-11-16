// server/src/state/modules/replacementBatch92DrawReplacements.ts
// B92: Enduring Renewal (reveal top; creature -> graveyard, otherwise draw)
// and Out of the Tombs (empty-library draw -> return a creature from GY, or lose).
// Public: parseBatch92DrawSentence, collectBatch92DrawReplacementSpecs,
// collectBatch92DrawReplacementSpecsFromState, applyEnduringRenewalDraw,
// applyOutOfTheTombsEmptyLibraryDraw.

import { stampPermanentEntryTimestamp } from '../../../../rules-engine/src/permanentTimestamps.js';
import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';

const RENEWAL_RE =
  /if you would draw a card, reveal the top card of your library instead(?:\. if it's a creature card, put it into your graveyard\. otherwise, draw a card)?/i;
const TOMBS_RE =
  /if you would draw a card while your library has no cards in it, instead return a creature card from your graveyard to the battlefield(?:\. if you can't, you lose the game)?/i;

export function parseBatch92DrawSentence(oracle: string): Array<{ kind: 'enduring-renewal' } | { kind: 'out-of-the-tombs' }> {
  const text = normalizeOraclePatternText(String(oracle || '')).toLowerCase().replace(/\u2019/g, "'");
  const out: Array<{ kind: 'enduring-renewal' } | { kind: 'out-of-the-tombs' }> = [];
  if (RENEWAL_RE.test(text)) out.push({ kind: 'enduring-renewal' });
  if (TOMBS_RE.test(text)) out.push({ kind: 'out-of-the-tombs' });
  return out;
}

export function collectBatch92DrawReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): ReplacementEffectSpec[] {
  const parsed = parseBatch92DrawSentence(oracle);
  return parsed.map((entry) => {
    if (entry.kind === 'enduring-renewal') {
      return {
        id: `${source.sourcePermanentId}:draw-reveal-creature-to-graveyard-else-draw`,
        event: 'card-draw' as const,
        sourcePermanentId: source.sourcePermanentId,
        sourceController: source.sourceController,
        sourceName: source.sourceName,
        match: { drawingPlayerIsSourceController: true, exactDrawCount: 1 },
        instead: {},
        effectId: 'draw-reveal-creature-to-graveyard-else-draw',
        reason: 'draw_reveal_creature_to_graveyard_else_draw',
        metadata: { revealTop: true, creatureToGraveyardElseDraw: true },
      } as ReplacementEffectSpec;
    }
    return {
      id: `${source.sourcePermanentId}:empty-library-return-creature-or-lose`,
      event: 'card-draw' as const,
      sourcePermanentId: source.sourcePermanentId,
      sourceController: source.sourceController,
      sourceName: source.sourceName,
      match: { drawingPlayerIsSourceController: true, skipWhenEventMetadataTrue: undefined } as any,
      instead: { choiceRequired: true },
      effectId: 'empty-library-return-creature-or-lose',
      reason: 'empty_library_return_creature_or_lose',
      metadata: { onlyWhenLibraryEmpty: true, returnCreatureFromGraveyardOrLose: true },
    } as ReplacementEffectSpec;
  });
}

export function collectBatch92DrawReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; phasedOut?: boolean; card?: { name?: string; oracle_text?: string; oracleText?: string } };
    if (rec.phasedOut === true || !rec.card) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    const sourceController = String(rec.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    specs.push(...collectBatch92DrawReplacementSpecs(readCardOracleText(rec.card), {
      sourcePermanentId,
      sourceController,
      sourceName: String(rec.card?.name || 'Unknown').trim(),
    }));
  }
  return specs;
}

function isCreatureCard(card: any): boolean {
  return /\bcreature\b/i.test(String(card?.type_line || card?.typeLine || card?.card?.type_line || ''));
}

function idOf(card: any): string {
  return String(card?.id || card?.card?.id || card?.oracle_id || '').trim();
}

/** Reveal the top card; creature cards go to the graveyard, otherwise the card is drawn. */
export function applyEnduringRenewalDraw(state: any, playerId: string): { applied: boolean; revealed?: any; movedTo?: 'graveyard' | 'hand' } {
  const pid = String(playerId || '');
  if (!pid || !state) return { applied: false };
  const has = collectBatch92DrawReplacementSpecsFromState(state).some((s) =>
    s.effectId === 'draw-reveal-creature-to-graveyard-else-draw' && String(s.sourceController || '') === pid,
  );
  if (!has) return { applied: false };
  state.zones = state.zones || {};
  state.zones[pid] = state.zones[pid] || {};
  const library: any[] = Array.isArray(state.zones[pid].library) ? state.zones[pid].library : [];
  if (!library.length) return { applied: false };
  const revealed = library.shift();
  if (isCreatureCard(revealed)) {
    const gy: any[] = Array.isArray(state.zones[pid].graveyard) ? state.zones[pid].graveyard : [];
    gy.push(revealed);
    state.zones[pid].graveyard = gy;
    state.zones[pid].library = library;
    return { applied: true, revealed, movedTo: 'graveyard' };
  }
  const hand: any[] = Array.isArray(state.zones[pid].hand) ? state.zones[pid].hand : [];
  hand.push(revealed);
  state.zones[pid].hand = hand;
  state.zones[pid].library = library;
  return { applied: true, revealed, movedTo: 'hand' };
}

export function listOutOfTheTombsCreatureCandidates(state: any, playerId: string): any[] {
  const pid = String(playerId || '');
  const gy: any[] = state?.zones?.[pid]?.graveyard;
  return (Array.isArray(gy) ? gy : []).filter((c) => isCreatureCard(c));
}

/**
 * Replace an empty-library draw: return a chosen (or sole) creature from the
 * graveyard, or lose if none remain. When multiple creatures are available and
 * no choice is supplied, returns needsChoice=true and does not apply.
 */
export function applyOutOfTheTombsEmptyLibraryDraw(
  state: any,
  playerId: string,
  libraryCount: number,
  chosenCardId?: string,
): { applied: boolean; needsChoice: boolean; candidates: any[]; lost: boolean; returned?: any } {
  const pid = String(playerId || '');
  const empty: { applied: boolean; needsChoice: boolean; candidates: any[]; lost: boolean; returned?: any } =
    { applied: false, needsChoice: false, candidates: [], lost: false };
  if (!pid || !state || !(libraryCount <= 0)) return empty;
  const has = collectBatch92DrawReplacementSpecsFromState(state).some((s) =>
    s.effectId === 'empty-library-return-creature-or-lose' && String(s.sourceController || '') === pid,
  );
  if (!has) return empty;
  const candidates = listOutOfTheTombsCreatureCandidates(state, pid);
  if (!candidates.length) {
    state.life = state.life || {};
    const player = Array.isArray(state.players) ? state.players.find((p: any) => String(p?.id || '') === pid) : undefined;
    if (player) {
      player.hasLost = true;
      player.lostReason = player.lossReason = 'Could not return a creature card from the graveyard (Out of the Tombs)';
    }
    return { applied: true, needsChoice: false, candidates: [], lost: true };
  }
  if (candidates.length > 1 && !chosenCardId) {
    return { applied: false, needsChoice: true, candidates, lost: false };
  }
  const wanted = String(chosenCardId || idOf(candidates[0]));
  const idx = candidates.findIndex((c) => idOf(c) === wanted);
  const pick = candidates[idx >= 0 ? idx : 0];
  const gy: any[] = state.zones[pid].graveyard;
  const gyIdx = gy.findIndex((c: any) => c === pick || idOf(c) === idOf(pick));
  if (gyIdx >= 0) gy.splice(gyIdx, 1);
  state.battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const tokenish = pick && typeof pick === 'object' ? pick : {};
  const returnedPermanent = {
    ...tokenish,
    id: idOf(pick) || `returned-${pid}-${Date.now()}`,
    controller: pid,
    owner: tokenish.owner || pid,
    card: tokenish.card || tokenish,
  };
  state.battlefield.push(returnedPermanent);
  stampPermanentEntryTimestamp(state, returnedPermanent);
  return { applied: true, needsChoice: false, candidates, lost: false, returned: pick };
}


/** Hook for zonesDrawCards: empty-library tombs first, then Enduring Renewal. */
export function tryApplyBatch92DrawReplacementsInLoop(
  state: any,
  playerId: string,
  libraryCount: number,
  chosenCardId?: string,
): { applied: boolean; skipDraw: boolean; needsChoice: boolean; kind?: string; candidates?: any[] } {
  const tombs = applyOutOfTheTombsEmptyLibraryDraw(state, playerId, libraryCount, chosenCardId);
  if (tombs.needsChoice) {
    (state as any).pendingOutOfTheTombsDraw = { playerId, candidates: tombs.candidates.map((c: any) => ({ id: idOf(c), name: c?.name || c?.card?.name })) };
    return { applied: false, skipDraw: true, needsChoice: true, kind: 'out-of-the-tombs', candidates: tombs.candidates };
  }
  if (tombs.applied) return { applied: true, skipDraw: true, needsChoice: false, kind: 'out-of-the-tombs' };
  const renewal = applyEnduringRenewalDraw(state, playerId);
  if (renewal.applied) return { applied: true, skipDraw: true, needsChoice: false, kind: 'enduring-renewal' };
  return { applied: false, skipDraw: false, needsChoice: false };
}
