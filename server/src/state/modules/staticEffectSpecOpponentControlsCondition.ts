// server/src/state/modules/staticEffectSpecOpponentControlsCondition.ts
// Condition kind 'opponent_controls_matching': "as long as an opponent controls a white permanent"
// (Black Scarab, the Scarab/Ward cycle). Optional color and card type ('permanent' = any).
// Public entry symbols: opponentControlsMatching.

import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import { landAwareTypeLine } from './effectiveLandTypeLine.js';

const COLOR_SYMBOL: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

function permanentColors(perm: any): string[] {
  if (perm?.typeSetOverride?.colorless === true) return [];
  const printed = Array.isArray(perm?.colors) ? perm.colors : Array.isArray(perm?.card?.colors) ? perm.card.colors : [];
  const added = Array.isArray(perm?.colorAdditions) ? perm.colorAdditions : [];
  return [...printed, ...added].map((c: unknown) => {
    const s = String(c || '').trim().toLowerCase();
    return COLOR_SYMBOL[s] || s.toUpperCase();
  });
}

export function opponentControlsMatching(
  condition: { color?: string; cardType?: string },
  sourceController: string,
  battlefield: readonly BattlefieldPermanent[],
  state?: unknown,
): boolean {
  const controller = String(sourceController || '').trim();
  if (!controller) return false;
  const color = COLOR_SYMBOL[String(condition.color || '').toLowerCase()] || '';
  const cardType = String(condition.cardType || '').trim().toLowerCase();
  return battlefield.some((perm: any) => {
    if (!perm || String(perm.controller || '') === controller) return false;
    if (cardType && cardType !== 'permanent') {
      const typeLine = landAwareTypeLine(state, perm, String(perm.typeSetOverride?.typeLine || perm.card?.type_line || ''));
      if (!typeLine.includes(cardType)) return false;
      if (cardType === 'creature' && perm.notCreature === true) return false;
    }
    return !color || permanentColors(perm).includes(color);
  });
}
