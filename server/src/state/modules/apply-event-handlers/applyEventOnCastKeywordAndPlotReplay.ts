/**
 * Replay handlers for Fblthp-style plot-from-library-top and for
 * casualty / demonstrate / conspire stack copies.
 * Public: applyOnCastKeywordAndPlotEvents, applyPlotLibraryTopEvent,
 * applyOnCastKeywordCopyEvent.
 */
import type { GameContext } from "../../context.js";
import type { GameEvent } from "../../types.js";
import { debugWarn } from "../../../utils/debug.js";

export const PLOT_LIBRARY_TOP_EVENT = 'plotLibraryTop';
export const ON_CAST_KEYWORD_COPY_EVENT = 'onCastKeywordCopy';

function alreadyPlotted(zones: any, playerId: string, cardId: string): any | null {
  const exile = Array.isArray(zones?.[playerId]?.exile) ? zones[playerId].exile : [];
  return exile.find((c: any) => c && String(c.id) === String(cardId) && c.isPlotted === true) || null;
}

function applyPlotManaPayment(state: any, playerId: string, payment: any): void {
  if (!payment || typeof payment !== 'object') return;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const id of Array.isArray(payment.tappedPermanents) ? payment.tappedPermanents : []) {
    const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === String(id));
    if (permanent) (permanent as any).tapped = true;
  }
  const pool = state?.manaPool?.[playerId] || state?.players?.[playerId]?.manaPool;
  const delta = payment.paymentManaDelta;
  if (pool && delta && typeof delta === 'object') {
    for (const key of Object.keys(delta)) {
      const change = Number(delta[key] || 0);
      if (!Number.isFinite(change) || change === 0) continue;
      if (typeof pool[key] === 'number' || pool[key] == null) {
        // paymentManaDelta is pool-after minus pool-before (negative when spent).
        pool[key] = Math.max(0, Number(pool[key] || 0) + change);
      }
    }
  }
}

export function applyPlotLibraryTopEvent(ctx: GameContext, e: GameEvent): boolean {
  const playerId = String((e as any).playerId || '').trim();
  const cardId = String((e as any).cardId || (e as any).card?.id || '').trim();
  if (!playerId || !cardId) return false;
  try {
    const state: any = ctx.state;
    const zones = (state.zones = state.zones || {});
    zones[playerId] = zones[playerId] || { library: [], exile: [], hand: [], graveyard: [] };
    if (alreadyPlotted(zones, playerId, cardId)) {
      return true;
    }
    const lib: any[] = Array.isArray(zones[playerId].library) ? zones[playerId].library : (zones[playerId].library = []);
    let card: any = null;
    const idx = lib.findIndex((c: any) => c && String(c.id) === String(cardId));
    if (idx >= 0) card = lib.splice(idx, 1)[0];
    if (!card && (e as any).card && typeof (e as any).card === 'object') {
      card = { ...(e as any).card };
    }
    if (!card) return false;
    const cost = String((e as any).cost || card.plotCost || '');
    const plotted = {
      ...card,
      zone: 'exile',
      isPlotted: true,
      plotCost: cost,
      plottedBy: playerId,
    };
    const exile: any[] = Array.isArray(zones[playerId].exile) ? zones[playerId].exile : (zones[playerId].exile = []);
    exile.push(plotted);
    if (zones[playerId].libraryCount != null) zones[playerId].libraryCount = lib.length;
    if (zones[playerId].exileCount != null) zones[playerId].exileCount = exile.length;
    applyPlotManaPayment(state, playerId, (e as any).manaPayment);
    if (typeof ctx.bumpSeq === 'function') ctx.bumpSeq();
    return true;
  } catch (err) {
    debugWarn(1, 'applyEvent(plotLibraryTop): failed', err);
    return true;
  }
}

export function applyOnCastKeywordCopyEvent(ctx: GameContext, e: GameEvent): boolean {
  const sourceStackItemId = String((e as any).sourceStackItemId || (e as any).stackItemId || '').trim();
  const copiedStackItemId = String((e as any).copiedStackItemId || (e as any).copy?.id || '').trim();
  const controllerId = String((e as any).controllerId || (e as any).controller || '').trim();
  const reason = String((e as any).reason || 'OnCastKeyword');
  if (!sourceStackItemId || !copiedStackItemId) return false;
  try {
    const state: any = ctx.state;
    const stack: any[] = Array.isArray(state.stack) ? state.stack : (state.stack = []);
    const original = stack.find((item: any) => item && String(item.id || '') === sourceStackItemId) || null;
    const existing = stack.find((item: any) => item && String(item.id || '') === copiedStackItemId) || null;
    const flag = `copiedFor${reason}`;
    if (original) (original as any)[flag] = true;
    if (existing) {
      if (controllerId) existing.controller = controllerId;
      return true;
    }
    const snapshot = (e as any).copy && typeof (e as any).copy === 'object' ? (e as any).copy : null;
    const base = snapshot || original;
    if (!base) return false;
    const copy = {
      ...base,
      id: copiedStackItemId,
      controller: controllerId || base.controller,
    };
    stack.push(copy);
    if (typeof ctx.bumpSeq === 'function') ctx.bumpSeq();
    return true;
  } catch (err) {
    debugWarn(1, 'applyEvent(onCastKeywordCopy): failed', err);
    return true;
  }
}

export function applyOnCastKeywordAndPlotEvents(ctx: GameContext, e: GameEvent): boolean {
  if (!e || typeof e.type !== 'string') return false;
  if (e.type === PLOT_LIBRARY_TOP_EVENT) return applyPlotLibraryTopEvent(ctx, e);
  if (e.type === ON_CAST_KEYWORD_COPY_EVENT) return applyOnCastKeywordCopyEvent(ctx, e);
  return false;
}
