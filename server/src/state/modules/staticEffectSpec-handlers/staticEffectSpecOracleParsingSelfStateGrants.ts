// server/src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingSelfStateGrants.ts
// Self keyword grants gated on the source's own state (round 21 census tail):
//   "This creature has flying as long as it's enchanted." (Fledgling Osprey)
//   "This creature has flying as long as it's modified." (Skyward Spider) / "... as long as it's equipped."
//   "Karakyk Guardian has hexproof if it hasn't dealt damage yet." (R22) -> target_has_not_dealt_damage
// Public entry symbols: pushSelfStateGrantSpecs.

import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, parseAbilitiesFromTail, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { pushSelfCounterThresholdSpecs } from './staticEffectSpecOracleParsingSelfCounterThreshold.js';
import { pushSelfAttachmentCountSpecs } from './staticEffectSpecOracleParsingSelfAttachmentCount.js';
import { pushMaxSpeedSpecs } from './staticEffectSpecOracleParsingMaxSpeed.js';
import { pushConditionalGroupGrantSpecs } from './staticEffectSpecOracleParsingConditionalGroupGrants.js';

const STATE: Record<string, StaticEffectCondition['kind']> = {
  enchanted: 'target_is_enchanted',
  modified: 'target_is_modified',
  equipped: 'target_is_equipped',
};

export function pushSelfStateGrantSpecs(specs: StaticEffectSpec[], source: StaticEffectSpecSource, oracle: string): void {
  pushSelfCounterThresholdSpecs(specs, source, oracle);
  pushSelfAttachmentCountSpecs(specs, source, oracle);
  pushMaxSpeedSpecs(specs, source, oracle);
  pushConditionalGroupGrantSpecs(specs, source, oracle);
  const name = String((source as any).sourceName || '').toLowerCase();
  const lines = String(oracle || '').replace(/[\u2019]/g, "'").split(/\n+/).map((l) => l.replace(/\([^)]*\)/g, '').trim());
  lines.forEach((raw, index) => {
    const line = raw.toLowerCase().replace(/\.$/, '');
    const st = /^(this creature|~|[^,.]+?) has ([a-z ,]+?) as long as it's (enchanted|modified|equipped)$/.exec(line);
    // B72: Ruric Thar, Magecrusher — "… as long as they haven't dealt combat damage yet."
    // Keep "hasn't" (singular) and "haven't" (plural they).
    const dmg = st ? null : /^(this creature|~|[^,.]+?) has ([a-z ,]+?) (?:as long as|if) (?:it|they|he|she) (?:hasn'?t|haven'?t) dealt(?: combat)? damage yet$/.exec(line);
    // B87: Ratonhnhaké꞉ton — "As long as ~ hasn't dealt damage yet, it has hexproof and can't be blocked."
    const dmgFront = (st || dmg) ? null : /^as long as (this creature|~|[^,.]+?) (?:hasn'?t|haven'?t) dealt(?: combat)? damage yet, (?:it|this creature|~) has (.+)$/.exec(line);
    const m = st || dmg || dmgFront;
    if (!m) return;
    const subject = dmgFront ? m[1] : m[1];
    const abilityTail = dmgFront ? m[2] : m[2];
    if (subject !== 'this creature' && subject !== '~' && (!name || subject !== name)) return;
    const condKind: StaticEffectCondition['kind'] = st ? STATE[st[3]] : 'target_has_not_dealt_damage';
    const abilities = parseAbilitiesFromTail(abilityTail);
    if (!abilities.length) return;
    const key = JSON.stringify(abilities);
    if (specs.some((s) => String(s.sourcePermanentId) === String(source.sourcePermanentId) && JSON.stringify(s.grant?.abilities || []) === key)) return;
    specs.push(buildSpec(source, `self-state-grant:${index}`, { kind: 'self' }, { abilities }, { kind: condKind } as StaticEffectCondition));
  });
}
