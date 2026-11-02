// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingStationThresholds.ts
// Station (CR 702.184) threshold lines: "N+ | <text>" means the source has <text> as long as it has N or more
// charge counters on it. Static lines behind a threshold are parsed on their own and gated with
// source_counter_at_least (charge, N); the ungated remainder is parsed as usual.
// Public entry symbols: splitStationThresholdLines, gateStationThresholdSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectSpec } from '../staticEffectSpec.js';

const STATION_LINE = /^\s*(\d+)\+\s*\|\s*(.+?)\s*$/;

export interface StationThresholdSplit {
  readonly basePerm: BattlefieldPermanent;
  readonly gated: ReadonlyArray<{ readonly amount: number; readonly perm: BattlefieldPermanent }>;
}

function withOracle(perm: BattlefieldPermanent, oracleText: string): BattlefieldPermanent {
  const p: any = { ...(perm as any) };
  if (p.card) p.card = { ...p.card, oracle_text: oracleText };
  if (typeof p.oracle_text === 'string' || !p.card) p.oracle_text = oracleText;
  return p as BattlefieldPermanent;
}

export function splitStationThresholdLines(perm: BattlefieldPermanent): StationThresholdSplit | null {
  const text = String((perm as any)?.card?.oracle_text || (perm as any)?.oracle_text || '');
  if (!/^\s*\d+\+\s*\|/m.test(text)) return null;
  const base: string[] = [];
  const gated: Array<{ amount: number; perm: BattlefieldPermanent }> = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(STATION_LINE);
    if (!m) { base.push(line); continue; }
    const amount = Number.parseInt(m[1], 10);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    gated.push({ amount, perm: withOracle(perm, m[2]) });
  }
  return { basePerm: withOracle(perm, base.join('\n')), gated };
}

export function gateStationThresholdSpecs(specs: StaticEffectSpec[], amount: number): StaticEffectSpec[] {
  const gate: any = { kind: 'source_counter_at_least', counterType: 'charge', amount };
  return specs.map((spec: any) => {
    const out: any = { ...spec, id: String(spec.id || 'spec') + '-station' + amount };
    if (out.condition) out.conditions = [...(Array.isArray(out.conditions) ? out.conditions : []), gate];
    else out.condition = gate;
    return out as StaticEffectSpec;
  });
}
