/**
 * Prototype (CR 702.160): cast for alternate cost; permanent enters with the
 * printed prototype power/toughness instead of its normal base P/T.
 *
 * Public: spellWasCastWithPrototypePaid, applyPrototypeOnPermanentEntry.
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { parsePrototypeInfo } from './alternate-costs.js';

export function spellWasCastWithPrototypePaid(stackItem?: any, card?: any): boolean {
  const alt = String(stackItem?.alternateCostId || card?.alternateCostId || '').toLowerCase().trim();
  if (alt === 'prototype') return true;
  return stackItem?.prototypeCostWasPaid === true || card?.prototypeCostWasPaid === true;
}

/**
 * When a permanent enters after being cast for its prototype cost: overwrite
 * base/effective P/T with the prototype values.
 */
export function applyPrototypeOnPermanentEntry(
  _ctx: GameContext,
  permanent: any,
  controller: PlayerID,
  sourceName: string,
  stackItem?: any,
): void {
  if (!permanent?.id) return;
  const card = permanent?.card || {};
  const oracleText = String(card?.oracle_text || '');
  const info = parsePrototypeInfo(oracleText);
  if (!info) return;
  if (!spellWasCastWithPrototypePaid(stackItem, card)) return;

  const stampedPower = Number(stackItem?.prototypePower ?? card?.prototypePower ?? info.power);
  const stampedToughness = Number(stackItem?.prototypeToughness ?? card?.prototypeToughness ?? info.toughness);
  const power = Number.isFinite(stampedPower) ? Math.floor(stampedPower) : info.power;
  const toughness = Number.isFinite(stampedToughness) ? Math.floor(stampedToughness) : info.toughness;

  permanent.prototypeCostWasPaid = true;
  permanent.wasPrototypeCast = true;
  permanent.basePower = power;
  permanent.baseToughness = toughness;
  permanent.effectivePower = power;
  permanent.effectiveToughness = toughness;
  permanent.card = {
    ...(permanent.card || {}),
    power: String(power),
    toughness: String(toughness),
    prototypeCostWasPaid: true,
    wasPrototypeCast: true,
    prototypePower: power,
    prototypeToughness: toughness,
  };

  debug(
    2,
    `[prototype] ${sourceName || card?.name || permanent.id} enters as ${power}/${toughness} for ${controller}`,
  );
}
