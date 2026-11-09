// server/src/state/modules/staticEffectSpec-handlers/batch62LongTailStatics.ts
// B62 long-tail statics:
//   Beast / Kid Loki ? counters-put-this-turn keyword grants
//   Aettir and Priwen ? equipped base P/T = controller life
//   Brenard ? Food-or-Golem creatures you control anthem
//   Miriam ? Mounts/Vehicles hexproof during your turn
//   Encroaching Mycosynth ? nonland permanents you control are artifacts
//   Earth Rumble ? land-creature / land-entered self pump (via condition parse elsewhere)
// Public entry symbols: pushBatch62LongTailStaticSpecs.

import type { BattlefieldPermanent } from '../../../../../shared/src/index.js';
import type { StaticEffectCondition, StaticEffectGrant, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, parseBuffSegment, parseLordAbilitiesFromTail, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { pushPlayerChoseWarPeaceAnthemSpecs } from './playerChoseWarPeaceAnthems.js';

const SUBJ = '(?:this creature|this permanent|~|he|she|it|[a-z][a-z\' ,-]{0,40}?)';

function pushCountersThisTurnGrants(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const text = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  // Beast: "as long as you've put one or more +1/+1 counters on ~ this turn, he has flying."
  const selfRe = new RegExp(
    String.raw`as long as you(?:'ve| have) put (?:one or more|a|an|\d+)(?: or more)? (?:(\+1/\+1|[a-z0-9+/-]+) )?counters? on ${SUBJ} this turn,? ${SUBJ} (?:has|have|gains?) ([^.]+)`,
    'i',
  );
  const self = text.match(selfRe);
  if (self) {
    const counterType = String(self[1] || '').trim() || '';
    const abilities = parseLordAbilitiesFromTail(self[2] || '');
    if (abilities.length) {
      const condition = {
        kind: 'target_had_counters_put_this_turn',
        ...(counterType ? { counterType } : {}),
        amount: 1,
      } as StaticEffectCondition;
      specs.push(buildSpec(source, 'self-counters-this-turn-grant', { kind: 'self' }, { abilities }, condition));
    }
  }

  // Kid Loki: "Each creature you control that you've put one or more +1/+1 counters on this turn has hexproof."
  const lordRe =
    /each creature you control that you(?:'ve| have) put (?:one or more|a|an|\d+)(?: or more)? (?:(\+1\/\+1|[a-z0-9+/-]+) )?counters? on this turn (?:has|have) ([^.]+)/i;
  const lord = text.match(lordRe);
  if (lord) {
    const counterType = String(lord[1] || '').trim() || '';
    const abilities = parseLordAbilitiesFromTail(lord[2] || '');
    if (abilities.length) {
      const condition = {
        kind: 'target_had_counters_put_this_turn',
        ...(counterType ? { counterType } : {}),
        amount: 1,
      } as StaticEffectCondition;
      specs.push(buildSpec(
        source,
        'creatures-counters-this-turn-grant',
        { kind: 'creatures_you_control' },
        { abilities },
        condition,
      ));
    }
  }
}

function pushEquippedBasePtEqualLife(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  const hostId = String((perm as any)?.attachedTo || '').trim();
  const line = String(oracle || '').toLowerCase().replace(/\u2019/g, "'");
  if (!/equipped creature has base power and toughness x\/x,? where x is your life total/.test(line)) return;
  if (!hostId) return; // unattached: classify covers the line; no host to set
  const grant: StaticEffectGrant = {
    setPowerFromControllerLife: true,
    setToughnessFromControllerLife: true,
  } as StaticEffectGrant;
  specs.push({
    ...buildSpec(source, 'equipped-base-pt-life', { kind: 'self' }, grant),
    sourcePermanentId: hostId,
    effectSourcePermanentId: source.sourcePermanentId,
    scope: { kind: 'self' },
  });
}

function pushFoodOrGolemAnthem(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().replace(/\u2019/g, "'").match(
    /each creature you control that(?:'s| is) an? (.+?) gets ([+-]\d+\s*\/\s*[+-]\d+)(?: and (?:has|have) ([^.]+))?/,
  );
  if (!m) return;
  const typesRaw = String(m[1] || '');
  const parts = typesRaw
    .replace(/\ban?\b/g, ' ')
    .split(/\bor\b/)
    .map((p) => p.trim().replace(/s$/, ''))
    .filter(Boolean);
  if (parts.length < 1) return;
  const buff = parseBuffSegment(m[2] || '');
  if (!buff) return;
  const abilities = parseLordAbilitiesFromTail(m[3] || '');
  const condition = {
    kind: 'target_has_any_subtype',
    subtypes: parts,
  } as StaticEffectCondition;
  specs.push(buildSpec(
    source,
    'food-or-golem-anthem',
    { kind: 'creatures_you_control' },
    { power: buff.power, toughness: buff.toughness, ...(abilities.length ? { abilities } : {}) },
    condition,
  ));
}

function pushMountsVehiclesDuringTurn(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().match(
    /during your turn,? (mounts? and vehicles?|vehicles? and mounts?) you control have ([^.]+)/i,
  );
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[2] || '');
  if (!abilities.length) return;
  specs.push(buildSpec(
    source,
    'mounts-vehicles-during-turn',
    { kind: 'permanents_you_control' },
    { abilities },
    { kind: 'during_source_controller_turn' } as StaticEffectCondition,
  ));
  const last = specs[specs.length - 1];
  last.conditions = [
    { kind: 'target_has_any_subtype', subtypes: ['mount', 'vehicle'] } as StaticEffectCondition,
  ];
}

export function pushBatch62LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  perm: BattlefieldPermanent,
  oracle: string,
): void {
  pushCountersThisTurnGrants(specs, source, oracle);
  pushEquippedBasePtEqualLife(specs, source, perm, oracle);
  pushPlayerChoseWarPeaceAnthemSpecs(specs, source, oracle);
  pushFoodOrGolemAnthem(specs, source, oracle);
  pushMountsVehiclesDuringTurn(specs, source, oracle);
}
