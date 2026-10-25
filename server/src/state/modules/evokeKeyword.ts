import type { GameContext } from '../context.js';
import type { PlayerID } from '../../../../shared/src/index.js';
import { getCardColorSymbolsForPitchCost } from './alternate-costs.js';
import { sacrificePermanent } from './upkeep-triggers.js';

/**
 * Evoke (CR 702.74): when a permanent enters after its evoke cost was paid,
 * "When this permanent enters, if its evoke cost was paid, its controller sacrifices it."
 * Also supports the MH2 non-mana evoke cost "Evoke-Exile a <color> card from your hand."
 */

export const EVOKE_SACRIFICE_TRIGGER_TYPE = 'evoke_sacrifice';
export const EVOKE_EXILE_ALTERNATE_COST_ID = 'evoke_exile';

const COLOR_WORDS: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

export function parseEvokeExileColor(oracleText: string): { symbol: string; word: string } | null {
  const m = String(oracleText || '').toLowerCase().match(/\bevoke\s*[\u2014\u2013-]+\s*exile an? (white|blue|black|red|green) card from your hand/);
  if (!m) return null;
  return { symbol: COLOR_WORDS[m[1]], word: m[1] };
}

export function cardMatchesEvokeExileColor(card: any, symbol: string): boolean {
  try {
    return getCardColorSymbolsForPitchCost(card).includes(String(symbol || '').toUpperCase());
  } catch {
    return false;
  }
}

export function getEvokeExileCandidates(hand: any[], spellCardId: string, symbol: string): any[] {
  return (Array.isArray(hand) ? hand : [])
    .filter((c: any) => c && String(c.id) !== String(spellCardId))
    .filter((c: any) => cardMatchesEvokeExileColor(c, symbol));
}

export function spellWasEvoked(stackItem?: any, card?: any): boolean {
  const alt = String(stackItem?.alternateCostId || card?.alternateCostId || '').toLowerCase().trim();
  if (alt === 'evoke' || alt === EVOKE_EXILE_ALTERNATE_COST_ID) return true;
  return stackItem?.evokeCostWasPaid === true || card?.evokeCostWasPaid === true;
}

export function scheduleEvokeSacrificeOnPermanentEntry(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
  sourceName: string,
  stackItem?: any,
): boolean {
  if (!permanent || !spellWasEvoked(stackItem, permanent.card)) return false;
  const state = ctx.state as any;
  const permanentId = String(permanent.id || '');
  if (!permanentId) return false;
  permanent.evoked = true;
  if (permanent.card && typeof permanent.card === 'object') permanent.card.evokeCostWasPaid = true;
  state.stack = Array.isArray(state.stack) ? state.stack : [];
  const already = state.stack.some((s: any) => s?.triggerType === EVOKE_SACRIFICE_TRIGGER_TYPE && String(s?.source || '') === permanentId);
  if (already) return false;
  state.stack.push({
    id: `evoke_sac_${permanentId}`,
    type: 'triggered_ability',
    controller,
    source: permanentId,
    sourceName,
    triggerType: EVOKE_SACRIFICE_TRIGGER_TYPE,
    description: `When ${sourceName} enters, if its evoke cost was paid, its controller sacrifices it.`,
    mandatory: true,
  });
  return true;
}

export function maybeResolveEvokeSacrificeTrigger(ctx: GameContext, item: any): boolean {
  if (String(item?.triggerType || '') !== EVOKE_SACRIFICE_TRIGGER_TYPE) return false;
  const state = ctx.state as any;
  const permanentId = String(item?.source || '');
  const perm = (state.battlefield || []).find((p: any) => p && String(p.id) === permanentId);
  // "its controller sacrifices it" - if it left or is a new object, do nothing.
  if (perm) {
    sacrificePermanent(ctx, permanentId, String(perm.controller || item.controller));
    try { (ctx as any).bumpSeq?.(); } catch { /* noop */ }
  }
  return true;
}