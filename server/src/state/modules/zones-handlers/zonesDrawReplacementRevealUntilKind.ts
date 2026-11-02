// server/src/state/modules/zones-handlers/zonesDrawReplacementRevealUntilKind.ts
// B42: optional per-draw replacement (CR 614.11) "If you would draw a card, you may instead choose land or nonland
// and reveal cards from the top of your library until you reveal a card of the chosen kind. Put that card into your
// hand and put all other cards revealed this way on the bottom of your library in a random order."
// (Pavel Chekov, First Posting; Abundance.) Live: queue an OPTION_CHOICE (draw / land / nonland) per draw.
// Replay: drawCards stops at the same draw and the revealUntilKindDrawReplacementResolve event resumes it.
// Public entry symbols: findRevealUntilKindDrawSource, tryQueueRevealUntilKindDrawStep,
//   applyRevealUntilKindDrawChoice, REVEAL_UNTIL_KIND_DRAW_EVENT.

import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameContext } from '../../context.js';
import { uid } from '../../utils.js';
import { ResolutionQueueManager } from '../../resolution/index.js';
import { ResolutionStepType } from '../../resolution/types.js';
import { drawCards } from './zonesDrawCards.js';

export const REVEAL_UNTIL_KIND_DRAW_EVENT = 'revealUntilKindDrawReplacementResolve';

const SOURCE_RE = /if you would draw a card, you may instead choose land or nonland and reveal cards from the top of your library until you reveal a card of the chosen (?:kind|type)/;

export interface RevealUntilKindDrawSource { sourceId: string; sourceName: string }

export function findRevealUntilKindDrawSource(state: any, playerId: string): RevealUntilKindDrawSource | null {
  for (const p of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    if (!p?.card || p.phasedOut === true) continue;
    if (String(p.controller || '') !== String(playerId)) continue;
    const oracle = String(p.card.oracle_text || '').toLowerCase().replace(/\s+/g, ' ');
    if (SOURCE_RE.test(oracle)) return { sourceId: String(p.id || ''), sourceName: String(p.card.name || 'Unknown') };
  }
  return null;
}

/**
 * Called per draw from drawCards. Returns true when drawCards must stop (a live choice was queued, or replay will
 * resume this draw from the recorded resolve event).
 */
export function tryQueueRevealUntilKindDrawStep(ctx: GameContext, playerId: string, remainingDrawCountAfterChoice: number): boolean {
  if ((ctx as any)._suppressRevealUntilKindDraw === true) return false;
  const src = findRevealUntilKindDrawSource(ctx.state, playerId);
  if (!src) return false;
  if ((ctx as any).isReplaying) {
    return String((ctx as any)._replayNextEventType || '').trim() === REVEAL_UNTIL_KIND_DRAW_EVENT;
  }
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') return false;
  ResolutionQueueManager.addStep(gameId, {
    id: uid('reveal_until_kind_draw'),
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: playerId as PlayerID,
    sourceId: src.sourceId,
    sourceName: src.sourceName,
    description: `${src.sourceName}: draw normally, or instead choose land or nonland and reveal until you reveal a card of that kind?`,
    mandatory: true,
    minSelections: 1,
    maxSelections: 1,
    revealUntilKindDrawChoice: true,
    remainingDrawCountAfterChoice: Math.max(0, Math.floor(remainingDrawCountAfterChoice || 0)),
    options: [
      { id: 'draw', label: 'Draw a card' },
      { id: 'land', label: 'Reveal until a land' },
      { id: 'nonland', label: 'Reveal until a nonland card' },
    ],
  } as any);
  return true;
}

function libraryOf(ctx: GameContext, pid: string): any[] {
  const mapLib = ctx.libraries?.get(pid as PlayerID);
  if (Array.isArray(mapLib) && mapLib.length > 0) return mapLib;
  const zone: any = (ctx.state as any).zones?.[pid];
  return Array.isArray(zone?.library) ? zone.library : (Array.isArray(mapLib) ? mapLib : []);
}

function syncLibrary(ctx: GameContext, pid: string, lib: any[]): void {
  ctx.libraries?.set(pid as PlayerID, lib);
  const zone: any = (ctx.state as any).zones?.[pid];
  if (zone) { zone.library = lib; zone.libraryCount = lib.length; }
}

function isLand(card: any): boolean {
  return /\bland\b/i.test(String(card?.type_line || ''));
}

export interface RevealUntilKindDrawResult {
  applied: boolean;
  choiceId: 'draw' | 'land' | 'nonland';
  revealedCardIds?: string[];
  keptCardId?: string;
  bottomOrderIds?: string[];
}

export function applyRevealUntilKindDrawChoice(ctx: GameContext, event: {
  playerId: string;
  choiceId?: string;
  remainingDrawCountAfterChoice?: number;
  bottomOrderIds?: string[];
  sourceName?: string;
}): RevealUntilKindDrawResult {
  const pid = String(event?.playerId || '').trim();
  const raw = String(event?.choiceId || 'draw').trim().toLowerCase();
  const choiceId: 'draw' | 'land' | 'nonland' = raw === 'land' || raw === 'nonland' ? raw : 'draw';
  const remaining = Math.max(0, Math.floor(Number(event?.remainingDrawCountAfterChoice || 0)));
  if (!pid) return { applied: false, choiceId };
  const result: RevealUntilKindDrawResult = { applied: true, choiceId };

  if (choiceId === 'draw') {
    const prev = (ctx as any)._suppressRevealUntilKindDraw === true;
    (ctx as any)._suppressRevealUntilKindDraw = true;
    try {
      drawCards(ctx, pid as PlayerID, 1, { skipEventPersistence: true } as any);
    } finally {
      if (!prev) delete (ctx as any)._suppressRevealUntilKindDraw;
    }
  } else {
    const lib = libraryOf(ctx, pid).slice();
    const wantLand = choiceId === 'land';
    const idx = lib.findIndex((c) => isLand(c) === wantLand);
    const revealed = idx >= 0 ? lib.slice(0, idx + 1) : lib.slice();
    const rest = idx >= 0 ? lib.slice(idx + 1) : [];
    const kept = idx >= 0 ? revealed[revealed.length - 1] : null;
    const others = kept ? revealed.slice(0, -1) : revealed;
    let ordered = others.slice();
    const recorded = Array.isArray(event?.bottomOrderIds) ? event.bottomOrderIds.map(String) : null;
    if (recorded && recorded.length === others.length) {
      const byId = new Map(others.map((c) => [String(c?.id || ''), c]));
      const fromRecord = recorded.map((id) => byId.get(id)).filter(Boolean);
      if (fromRecord.length === others.length) ordered = fromRecord as any[];
    } else {
      for (let i = ordered.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      }
    }
    syncLibrary(ctx, pid, [...rest, ...ordered]);
    if (kept) {
      const zone: any = (ctx.state as any).zones?.[pid];
      if (zone) {
        const hand: any[] = Array.isArray(zone.hand) ? zone.hand : [];
        hand.push({ ...kept, zone: 'hand' });
        zone.hand = hand;
        zone.handCount = hand.length;
      }
    }
    result.revealedCardIds = revealed.map((c) => String(c?.id || ''));
    result.keptCardId = kept ? String(kept.id || '') : undefined;
    result.bottomOrderIds = ordered.map((c) => String(c?.id || ''));
    const st: any = ctx.state;
    st.batch18DrawReplacements = Array.isArray(st.batch18DrawReplacements) ? st.batch18DrawReplacements : [];
    st.batch18DrawReplacements.push({
      playerId: pid,
      sourceName: String(event?.sourceName || 'Draw replacement'),
      effect: kept
        ? `revealed ${revealed.length} card(s) and put ${String(kept.name || 'a card')} into hand instead of drawing`
        : `revealed ${revealed.length} card(s) and found no ${choiceId} card`,
      timestamp: Date.now(),
    });
    ctx.bumpSeq?.();
  }

  if (remaining > 0) drawCards(ctx, pid as PlayerID, remaining, { skipEventPersistence: true } as any);
  return result;
}
