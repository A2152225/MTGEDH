// server/src/state/modules/continuousEffectsBase.ts
// Seed ContinuousEffectResult for the StaticEffectSpec pass: layer-4 type-setting stamp, empty
// per-permanent aggregates, and the conditional keyword grants of stateful paper keywords
// (max speed / infinity, CR 702.178 / 702.186). Replaces the retired legacy regex static scan
// (rules-engine/staticEffects.ts); every oracle-text static now comes from StaticEffectSpecs.
// Public entry symbols: buildContinuousEffectsBase.

import type { BattlefieldPermanent, PlayerID } from '../../../../shared/src/index.js';
import { controllerHasLeftTheGame } from '../../../../rules-engine/src/playerInGameStatus.js';
import { staticSourceAbilitiesRemoved } from '../../../../rules-engine/src/permanentKeywordAbilities.js';
import { stampLayer4TypeSetting } from './layer4TypeSetting.js';
import { infinityGrantedAbility, maxSpeedGrantedAbility } from './statefulPaperKeywords.js';
import type { ContinuousEffectResult, EffectAggregate } from '../../rules-engine/staticEffects-handlers/staticEffectsScanHelpers.js';
import { isCreature } from '../../rules-engine/staticEffects-handlers/staticEffectsScanHelpers.js';

export function buildContinuousEffectsBase(state: { battlefield?: readonly BattlefieldPermanent[] }): ContinuousEffectResult {
  const perPermanent = new Map<string, EffectAggregate>();
  const permanentAbilities = new Map<string, Set<string>>();
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  if (battlefield.length > 0) stampLayer4TypeSetting(state as any);
  for (const perm of battlefield) {
    permanentAbilities.set(perm.id, new Set());
    if (isCreature(perm)) perPermanent.set(perm.id, { pDelta: 0, tDelta: 0, abilities: new Set() });
  }
  for (const source of battlefield) {
    if (controllerHasLeftTheGame(state as any, source.controller)) continue;
    if (staticSourceAbilitiesRemoved(source, battlefield as any)) continue;
    for (const granted of [maxSpeedGrantedAbility(source, state as any), infinityGrantedAbility(source)]) {
      if (!granted) continue;
      const normalized = granted.toLowerCase();
      permanentAbilities.get(source.id)?.add(normalized);
      perPermanent.get(source.id)?.abilities.add(normalized);
    }
  }
  return {
    perPermanent,
    playerHexproof: new Set<PlayerID>(),
    playerShroud: new Set<PlayerID>(),
    typeAdditions: new Map<string, string[]>(),
    permanentAbilities,
    colorAdditions: new Map<string, string[]>(),
  };
}
