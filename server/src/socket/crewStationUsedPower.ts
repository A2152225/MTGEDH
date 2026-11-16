// server/src/socket/crewStationUsedPower.ts
// B100: effective power used when crewing, saddling, or stationing.
// Sulu triples his power for station/crew; Tapestry Warden lets T>P creatures
// station with toughness. Public: effectiveCrewStationPower,
// stationUsesToughness, crewStationPowerMultiplier.

import { crewSaddlePowerBonus } from './crewSaddlePowerBonus.js';
import { getEffectivePower, getEffectiveToughness } from './util-handlers/getEffectivePowerToughness.js';
import { parseStationCrewPowerTripled, parseStationWithToughnessWhenGreater } from '../state/modules/batch100CombatAndKeywords.js';

function oracleOf(perm: any): string {
  const name = String(perm?.card?.name || '').toLowerCase();
  let text = String(perm?.card?.oracle_text || perm?.oracle_text || '').replace(/\u2019/g, "'");
  if (name) {
    const first = name.split(/\s*\/\/\s*/)[0];
    for (const n of [name, first, first.split(',')[0].trim()]) {
      if (n && n.length >= 3) {
        text = text.split(n).join('~');
      }
    }
  }
  return text.toLowerCase();
}

export function crewStationPowerMultiplier(perm: any, kind: 'crew' | 'saddle' | 'station' = 'crew'): number {
  if (kind === 'saddle') return 1;
  return parseStationCrewPowerTripled(oracleOf(perm)) ? 3 : 1;
}

export function stationUsesToughness(perm: any, state: any): boolean {
  const power = getEffectivePower(perm, state);
  const toughness = getEffectiveToughness(perm, state);
  if (!(Number(toughness) > Number(power))) return false;
  const controller = String(perm?.controller || '');
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return battlefield.some((source) => {
    if (!source || source.phasedOut === true) return false;
    if (String(source.controller || '') !== controller) return false;
    return parseStationWithToughnessWhenGreater(source?.card?.oracle_text || source?.oracle_text || '');
  });
}

export function effectiveCrewStationPower(perm: any, state: any, kind: 'crew' | 'saddle' | 'station' = 'crew'): number {
  const useToughness = kind === 'station' && stationUsesToughness(perm, state);
  const base = useToughness ? getEffectiveToughness(perm, state) : getEffectivePower(perm, state);
  const bonus = kind === 'station' ? 0 : crewSaddlePowerBonus(perm, kind);
  const multiplier = crewStationPowerMultiplier(perm, kind);
  const used = (Number(base) || 0) * multiplier + bonus;
  return Math.max(0, Math.floor(used));
}
