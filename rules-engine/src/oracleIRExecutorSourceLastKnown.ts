/**
 * CR 608.2h last-known information for a resolving ability whose source has left the battlefield.
 *
 * "When this creature dies, it deals damage equal to its power to any target" (Balduvian Berserker),
 * "you gain life equal to its power" (Conclave Mentor), "create an X/X ... where X is this creature's
 * power" (Flesh Carver) and "put its counters on target creature you control" (Spiteful Squad) all read
 * the source after it is gone. The server stamps the source's last battlefield state on
 * `ctx.sourceLastKnownPermanent`; stat/counter readers fall back to it only when the source is no
 * longer on the battlefield, so a live source always wins.
 */
import type { GameState } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getPermanentLastKnownStat } from './oracleIRExecutorLastKnownInfo';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';

/** Returns the source's last-known permanent (with resolved power/toughness), or null while it is live. */
export function getSourceLastKnownPermanent(
  state: GameState | any,
  ctx: OracleIRExecutionContext | any
): any | null {
  const lastKnown = (ctx as any)?.sourceLastKnownPermanent;
  if (!lastKnown || typeof lastKnown !== 'object') return null;
  const sourceId = String(ctx?.sourceId || '').trim();
  const lastKnownId = String((lastKnown as any).id || '').trim();
  if (sourceId && lastKnownId && sourceId !== lastKnownId) return null;
  const liveId = lastKnownId || sourceId;
  const battlefield = Array.isArray(state?.battlefield) ? (state.battlefield as any[]) : [];
  if (liveId && battlefield.some((perm) => String(perm?.id || '').trim() === liveId)) return null;

  const power = getPermanentLastKnownStat(lastKnown, 'power');
  const toughness = getPermanentLastKnownStat(lastKnown, 'toughness');
  return {
    ...(lastKnown as any),
    ...(power !== null ? { power, effectivePower: power } : {}),
    ...(toughness !== null ? { toughness, effectiveToughness: toughness } : {}),
  };
}

/** Last-known power / toughness / mana value of a departed source, or null when unavailable. */
export function readSourceLastKnownStat(
  state: GameState | any,
  ctx: OracleIRExecutionContext | any,
  stat: 'power' | 'toughness' | 'mana_value' | string
): number | null {
  const lastKnown = getSourceLastKnownPermanent(state, ctx);
  if (!lastKnown) return null;
  if (stat === 'mana_value') {
    const manaValue = getCardManaValue((lastKnown as any).card || lastKnown);
    return manaValue === null ? null : Math.max(0, manaValue);
  }
  if (stat !== 'power' && stat !== 'toughness') return null;
  const value = Number((lastKnown as any)[stat]);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}
