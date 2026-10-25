// server/src/state/utils-handlers/variablePowerGreatestPower.ts
// CDA "~'s power [and toughness] is/are [each] equal to the greatest power/toughness among [other] <type>s
// you control / on the battlefield" (CR 604.3). Other permanents' current P/T is read through the shared
// current-P/T hook; a module-level reentrancy guard stops X -> Y -> X recursion when two such creatures
// look at each other (the inner read then falls back to printed P/T plus counters).
// Public entry symbols: calculateGreatestPowerAmongCDA.

import { readCurrentPowerFromHook, readCurrentToughnessFromHook } from '../../../../rules-engine/src/currentPowerToughnessHook.js';

const RE = /\b(power|toughness|power and toughness) (?:is|are) (?:each )?equal to the greatest (power|toughness) among (other )?([a-z]+?)s?(?: you control| on the battlefield)\b/;
const ON_BATTLEFIELD_RE = /greatest (?:power|toughness) among (?:other )?[a-z]+? on the battlefield/;
const resolving = new Set<string>();

function printedStat(perm: any, stat: 'power' | 'toughness'): number {
  const base = Number(perm?.[stat === 'power' ? 'basePower' : 'baseToughness'] ?? perm?.card?.[stat]);
  const counters = perm?.counters || {};
  const delta = Number(counters['+1/+1'] || 0) - Number(counters['-1/-1'] || 0);
  return (Number.isFinite(base) ? base : 0) + delta;
}

function statOf(perm: any, stat: 'power' | 'toughness', state: any): number {
  const id = String(perm?.card?.id || perm?.id || '');
  if (id && resolving.has(id)) return printedStat(perm, stat);
  const read = stat === 'power' ? readCurrentPowerFromHook(state, perm) : readCurrentToughnessFromHook(state, perm);
  return typeof read === 'number' ? read : printedStat(perm, stat);
}

export function calculateGreatestPowerAmongCDA(
  card: any,
  oracleTextLower: string,
  gameState: any,
  controllerId: string,
): { power: number; toughness: number } | undefined {
  const m = RE.exec(oracleTextLower);
  if (!m) return undefined;
  const selfId = String(card?.id || '');
  if (selfId && resolving.has(selfId)) return undefined;
  const sets = m[1] === 'power and toughness' ? ['power', 'toughness'] : [m[1]];
  const printedOther = Number(card?.[m[1] === 'power' ? 'toughness' : 'power']);
  if (sets.length === 1 && !Number.isFinite(printedOther)) return undefined;
  const want = m[4] === 'permanent' ? '' : m[4];
  const anyController = ON_BATTLEFIELD_RE.test(oracleTextLower);
  const stat = m[2] as 'power' | 'toughness';
  if (selfId) resolving.add(selfId);
  try {
    let best = 0;
    for (const perm of gameState?.battlefield || []) {
      if (!perm || perm.phasedOut) continue;
      if (!anyController && String(perm.controller || '') !== controllerId) continue;
      const isSelf = selfId && (String(perm.card?.id || '') === selfId || String(perm.id || '') === selfId);
      if (isSelf && m[3]) continue;
      if (isSelf) continue; // a CDA never reads its own result (avoids self-recursion); "among" self contributes 0 here
      if (want && !new RegExp('\\b' + want + 's?\\b').test(String(perm.card?.type_line || '').toLowerCase())) continue;
      best = Math.max(best, statOf(perm, stat, gameState));
    }
    if (sets.length === 2) return { power: best, toughness: best };
    return m[1] === 'power' ? { power: best, toughness: printedOther } : { power: printedOther, toughness: best };
  } finally {
    if (selfId) resolving.delete(selfId);
  }
}
