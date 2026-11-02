// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingMaxSpeed.ts
// "Max speed — This creature gets +1/+2." (Walking Sarcophagus, Nesting Bot): a self P/T (and keyword) static
// that applies while its controller's speed is 4 (CR 702.179). Keyword-only / quoted riders stay with
// maxSpeedGrantedAbility in statefulPaperKeywords.
// Public entry symbols: pushMaxSpeedSpecs.

import type { StaticEffectCondition, StaticEffectGrant, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, parseAbilitiesFromTail, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';

export function pushMaxSpeedSpecs(specs: StaticEffectSpec[], source: StaticEffectSpecSource, oracle: string): void {
  const name = String((source as any).sourceName || '').toLowerCase();
  String(oracle || '').toLowerCase().replace(/\u2019/g, "'").split(/\n+/).forEach((raw, index) => {
    const line = raw.replace(/\([^)]*\)/g, '').trim().replace(/\.$/, '');
    const m = line.match(/^max speed\s*(?:\u2014|-)\s*(this creature|~|[^,.]+?) gets ([+-]\d+)\/([+-]\d+)(?: and has ([a-z ,]+))?$/);
    if (!m || (m[1] !== 'this creature' && m[1] !== '~' && m[1] !== name && m[1] !== name.split(',')[0])) return;
    const grant: StaticEffectGrant = { power: Number(m[2]), toughness: Number(m[3]) };
    const abilities = m[4] ? parseAbilitiesFromTail(m[4]) : [];
    if (abilities.length) grant.abilities = abilities;
    const condition = { kind: 'controller_speed_at_least', amount: 4 } as unknown as StaticEffectCondition;
    specs.push(buildSpec(source, `max-speed-pt:${index}`, { kind: 'self' }, grant, condition));
  });
}
