// server/src/state/modules/staticEffectSpec-handlers/batch98LongTailStatics.ts
// B98 long-tail statics: also-attacks-if-able, face-up locks, chosen-name land
// abilities, soulshift X, imprint keywords, type+saddle grants, transform emblems,
// and Ogre Enforcer's single-source lethal-damage restriction.
// Public: parseBatch98LongTailStaticKind, pushBatch98LongTailStaticSpecs.

import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import {
  parseAlsoAttacksIfAble,
  parseOpponentsCantTurnFaceUpOnYourTurn,
  parseImprintExiledKeywordList,
  parseSoulshiftXCount,
  parseAdditionalTypesAndSaddle,
  parseLandsWithChosenNameHaveAbility,
  parseFromHandMvLeqLifeLostCascade,
} from '../batch98CombatAndKeywords.js';

export function parseOgreSingleSourceLethal(oracle: string): boolean {
  return /can't be destroyed by lethal damage unless lethal damage dealt by a single source is marked on it/i.test(String(oracle || ''));
}

export function parseBatch98LongTailStaticKind(oracle: string): string[] {
  const kinds: string[] = [];
  if (parseAlsoAttacksIfAble(oracle)) kinds.push('also-attacks-if-able');
  if (parseOpponentsCantTurnFaceUpOnYourTurn(oracle)) kinds.push('opponents-cant-turn-face-up-on-your-turn');
  if (parseLandsWithChosenNameHaveAbility(oracle)) kinds.push('lands-with-chosen-name-have-ability');
  if (parseSoulshiftXCount(oracle)) kinds.push('soulshift-x-count');
  if (parseImprintExiledKeywordList(oracle).length) kinds.push('imprint-exiled-keyword-grants');
  if (parseAdditionalTypesAndSaddle(oracle)) kinds.push('additional-types-and-saddle');
  if (parseFromHandMvLeqLifeLostCascade(oracle)) kinds.push('cascade-from-hand-by-life-lost');
  if (parseOgreSingleSourceLethal(oracle)) kinds.push('single-source-lethal-damage');
  return kinds;
}

export function pushBatch98LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: unknown,
  oracle: string,
): void {
  if (parseAlsoAttacksIfAble(oracle)) {
    specs.push(buildSpec(source, 'also-attacks-if-able', { kind: 'self' }, { abilities: ['also_attacks_if_able'] }));
  }
  if (parseOpponentsCantTurnFaceUpOnYourTurn(oracle)) {
    specs.push(buildSpec(source, 'opponents-cant-turn-face-up-on-your-turn', { kind: 'player_you' }, { abilities: ['opponents_cant_turn_face_up_on_your_turn'] }));
  }
  const quoted = parseLandsWithChosenNameHaveAbility(oracle);
  if (quoted) {
    specs.push(buildSpec(source, 'lands-with-chosen-name-have-ability', { kind: 'player_you' }, { abilities: [quoted] }));
  }
  const soul = parseSoulshiftXCount(oracle);
  if (soul) {
    specs.push(buildSpec(source, 'soulshift-x-count', { kind: 'self' }, { abilities: [`soulshift X (${soul.type})`] }));
  }
  const imprint = parseImprintExiledKeywordList(oracle);
  if (imprint.length) {
    specs.push(buildSpec(source, 'imprint-exiled-keyword-grants', { kind: 'self' }, { abilities: imprint }));
  }
  const saddle = parseAdditionalTypesAndSaddle(oracle);
  if (saddle) {
    specs.push(buildSpec(
      source,
      'additional-types-and-saddle',
      { kind: 'creatures_you_control' },
      { abilities: [`saddle ${saddle.saddle}`, ...saddle.types.map((t) => `${t} is Mount`)] },
    ));
  }
  if (parseFromHandMvLeqLifeLostCascade(oracle)) {
    specs.push(buildSpec(source, 'cascade-from-hand-by-life-lost', { kind: 'self' }, { abilities: ['cascade_from_hand_by_life_lost'] }));
  }
  if (parseOgreSingleSourceLethal(oracle)) {
    specs.push(buildSpec(source, 'single-source-lethal-damage', { kind: 'self' }, { abilities: ['single_source_lethal_damage'] }));
  }
}
