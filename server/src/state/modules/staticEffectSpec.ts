import type { BattlefieldPermanent, PlayerID } from '../../../../shared/src/index.js';
import { addIntrinsicAlsoCreatureTypes } from './intrinsicAlsoCreatureTypes.js';
import { permanentHasCreatureType } from '../../../../shared/src/creatureTypes.js';
import type { ContinuousEffectResult } from '../../rules-engine/staticEffects.js';
import { buildContinuousEffectsBase } from './continuousEffectsBase.js';
import {
  extractOracleCardLookupKeys,
  resolveCompiledOverlayForCard,
} from './oracleIrCompiledOverlayLookup.js';
import { hydrateBattlefieldOracleText } from './cardOracleHydration.js';
import {
  parseStaticEffectSpecsFromOraclePermanent,
} from './staticEffectSpecOracleParsing.js';
import { getEffectiveOracleText } from './effectiveOracleText.js';
import { scanBattlefieldContinuousEffectOverlayGaps } from './oracleIrContinuousEffectGapTelemetry.js';
import {
  specMatchesStaticCondition,
  permanentHasKeywordAbility,
  type StaticConditionState,
  type StaticKeywordResolver,
} from './staticEffectSpecConditionEval.js';
import { controllerHasLeftTheGame } from '../../../../rules-engine/src/playerInGameStatus.js';
import { staticSourceAbilitiesRemoved } from '../../../../rules-engine/src/permanentKeywordAbilities.js';
import { expireSourceLinkedPtModifiers } from './sourceLinkedPtModifiers.js';
import { stampMissingPermanentTimestamps } from '../../../../rules-engine/src/permanentTimestamps.js';
import { syncAuraControlChanges } from './staticEffectSpecAuraControl.js';
import { collectActivatedAbilitiesExiledWithSource } from './staticEffectSpecCopyExiledActivated.js';
import { stampAttachedTypeSettingOverrides, typeSetOverrideIsCreature, typeSetOverrideSubtypes } from './attachedTypeSettingStamp.js';
import {
  recordDeclarativeTypeAdditions,
  seedContinuousTypeAdditionsForStaticPass,
} from './staticEffectSpecCreatureTypePass.js';

export type {
  StaticEffectScopeKind,
  StaticEffectScope,
  StaticEffectGrant,
  StaticEffectAttackYouTaxCountBasis,
  StaticEffectCountBasis,
  StaticEffectLayer,
  StaticEffectSublayer,
  StaticEffectConditionKind,
  StaticEffectCondition,
  StaticEffectSpec,
} from './staticEffectSpecTypes.js';
import type {
  StaticEffectCondition,
  StaticEffectGrant,
  StaticEffectLayer,
  StaticEffectScope,
  StaticEffectSpec,
  StaticEffectSublayer,
} from './staticEffectSpecTypes.js';
import { syncClassLevelGating } from './classLevelGating.js';
import { permanentMatchesScopeQualifier } from './staticEffectSpecScopeQualifier.js';
import { grantedAbilitiesSurvivingAbilityLoss, recordDeclarativeColorAdditions } from './staticEffectSpecGrantRecipientWrite.js';
import { resolvePhase5CountMultiplier } from './staticEffectSpecPhase5Eval.js';


function isCreaturePermanent(permanent: BattlefieldPermanent): boolean {
  const typeSet = typeSetOverrideIsCreature(permanent);
  if (typeSet !== undefined) return typeSet;
  if ((permanent as any).isCreatureFromAttachment === true) return true;
  const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
  return typeLine.includes('creature') || typeLine.includes('kindred') || typeLine.includes('tribal') || ((permanent as any).layer4AddedTypes || []).includes('Creature');
}

function isPlaneswalkerPermanent(permanent: BattlefieldPermanent): boolean {
  const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
  return typeLine.includes('planeswalker');
}

function isLandPermanent(permanent: BattlefieldPermanent): boolean {
  const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
  return typeLine.includes('land');
}

function hasCreatureType(permanent: BattlefieldPermanent, creatureType: string): boolean {
  const setSubtypes = typeSetOverrideSubtypes(permanent); // layer 4 type-setting replaced its subtypes
  if (setSubtypes) return setSubtypes.includes(String(creatureType || '').toLowerCase());
  // Use shared helper so changeling / "every creature type" / granted types count.
  return permanentHasCreatureType(permanent as any, creatureType);
}

function getCreatureSubtypeWords(permanent: BattlefieldPermanent): string[] {
  const setSubtypes = typeSetOverrideSubtypes(permanent);
  if (setSubtypes) return setSubtypes;
  const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
  const dashSplit = typeLine.split(/—|\s-\s/);
  const subtypePart = dashSplit.length > 1 ? dashSplit.slice(1).join(' ') : '';
  return subtypePart
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9-]/g, '').trim())
    .filter(Boolean);
}

function creaturesShareCreatureType(
  left: BattlefieldPermanent,
  right: BattlefieldPermanent,
): boolean {
  const leftTypes = getCreatureSubtypeWords(left);
  const rightTypes = getCreatureSubtypeWords(right);
  if (leftTypes.length === 0 || rightTypes.length === 0) return false;
  return leftTypes.some((type) => rightTypes.includes(type));
}

function countOtherCreaturesSharingType(
  creature: BattlefieldPermanent,
  battlefield: readonly BattlefieldPermanent[],
): number {
  let count = 0;
  for (const other of battlefield) {
    if (!isCreaturePermanent(other) || other.id === creature.id) continue;
    if (creaturesShareCreatureType(creature, other)) count += 1;
  }
  return count;
}

function countOtherCreaturesMatchingScope(
  target: BattlefieldPermanent,
  spec: StaticEffectSpec,
  battlefield: readonly BattlefieldPermanent[],
): number {
  let count = 0;
  for (const other of battlefield) {
    if (!isCreaturePermanent(other) || other.id === target.id) continue;
    if (permanentMatchesScope(other, spec)) count += 1;
  }
  return count;
}

function resolveStaticCountMultiplier(
  grant: StaticEffectGrant,
  spec: StaticEffectSpec,
  target: BattlefieldPermanent,
  battlefield: readonly BattlefieldPermanent[],
  state?: unknown,
): number {
  if (!grant.countBasis) return 1;
  switch (grant.countBasis) {
    case 'other_creatures_sharing_creature_type':
      return countOtherCreaturesSharingType(target, battlefield);
    case 'other_creatures_matching_scope':
      return countOtherCreaturesMatchingScope(target, spec, battlefield);
    default:
      return resolvePhase5CountMultiplier(spec, battlefield, state);
  }
}

import {
  compareStaticEffectSpecsForApplication,
  getStaticEffectSourceTimestamp,
  normalizeOverlayStaticSpec,
  overlayHasStaticSpecs,
  readOverlayStaticSpecs,
  sortStaticEffectSpecsForApplication,
} from './staticEffectSpecLayerOrdering.js';
export { compareStaticEffectSpecsForApplication, getStaticEffectSourceTimestamp } from './staticEffectSpecLayerOrdering.js';

/** Battlefield lords do not function from GY; Anger/Wonder-style specs set this condition. */
function staticSpecFunctionsFromGraveyard(spec: StaticEffectSpec): boolean {
  return String(spec.condition?.kind || '').startsWith('source_in_graveyard');
}

export function collectStaticEffectSpecsFromState(state: unknown): StaticEffectSpec[] {
  const specs: StaticEffectSpec[] = [];
  const battlefield = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  const morophonChosenType = ((state as any)?.morophonChosenType || {}) as Record<string, string>;

  for (const perm of battlefield) {
    if (!perm?.card || perm?.phasedOut === true) continue;

    const sourcePermanentId = String(perm.id || '').trim();
    const sourceController = String(perm.controller || '').trim();
    const sourceName = String(perm.card?.name || perm.name || 'Unknown').trim();
    if (!sourcePermanentId) continue;
    if (controllerHasLeftTheGame(state, sourceController) || staticSourceAbilitiesRemoved(perm, battlefield)) continue;

    const lookupKeys = extractOracleCardLookupKeys({ card: perm.card, effectiveCard: perm.card });
    const overlay = resolveCompiledOverlayForCard(lookupKeys);
    if (overlay?.abilities?.length) {
      for (const ability of overlay.abilities) {
        if (String(ability.ability_type || '').toUpperCase() !== 'STATIC') continue;
        for (const rawSpec of readOverlayStaticSpecs(ability)) {
          const normalized = normalizeOverlayStaticSpec(rawSpec, {
            sourcePermanentId,
            sourceController,
            sourceName,
          });
          if (normalized) specs.push(normalized);
        }
      }
    }

    if (!overlayHasStaticSpecs(overlay)) {
      const resolvedChosenType = String(
        perm.chosenCreatureType
        || perm.card?.chosenCreatureType
        || morophonChosenType[sourcePermanentId]
        || '',
      ).trim();
      const effectiveOracle = getEffectiveOracleText(perm, state);
      const permForParseBase =
        resolvedChosenType && !String(perm.chosenCreatureType || '').trim()
          ? { ...perm, chosenCreatureType: resolvedChosenType }
          : perm;
      const permForParse = effectiveOracle && effectiveOracle !== String(perm.card?.oracle_text || '')
        ? {
            ...permForParseBase,
            card: {
              ...(permForParseBase as any).card,
              oracle_text: effectiveOracle,
            },
          }
        : permForParseBase;
      specs.push(...parseStaticEffectSpecsFromOraclePermanent(permForParse as BattlefieldPermanent));
    }
  }

  const zones = ((state as any)?.zones && typeof (state as any).zones === 'object')
    ? (state as any).zones as Record<string, { graveyard?: readonly unknown[] }>
    : {};
  for (const [playerId, playerZones] of Object.entries(zones)) {
    const graveyard = Array.isArray(playerZones?.graveyard) ? playerZones.graveyard : [];
    for (const card of graveyard) {
      if (!card || typeof card !== 'object') continue;
      const record = card as Record<string, unknown>;
      const nested = (record.card && typeof record.card === 'object')
        ? record.card as Record<string, unknown>
        : record;
      const sourceName = String(nested.name || record.name || 'Unknown').trim();
      const sourcePermanentId = String(record.id || nested.id || `gy:${playerId}:${sourceName || 'card'}`).trim();
      const sourceController = String(playerId || record.owner || record.controller || '').trim();
      if (!sourcePermanentId || !sourceController) continue;
      if (controllerHasLeftTheGame(state, sourceController)) continue;
      const graveyardSpecs = parseStaticEffectSpecsFromOraclePermanent({
        id: sourcePermanentId,
        controller: sourceController,
        card: {
          name: sourceName,
          oracle_text: String(nested.oracle_text || record.oracle_text || ''),
          type_line: String(nested.type_line || record.type_line || ''),
        },
      } as BattlefieldPermanent);
      specs.push(...graveyardSpecs.filter(staticSpecFunctionsFromGraveyard));
    }
  }

  const emblems = Array.isArray((state as any)?.emblems) ? (state as any).emblems : [];
  for (const emblem of emblems) {
    if (!emblem) continue;
    const sourcePermanentId = String(emblem.id || '').trim() || `emblem-${specs.length}`;
    const sourceController = String(emblem.controller || '').trim();
    if (!sourceController) continue;
    if (controllerHasLeftTheGame(state, sourceController)) continue;

    specs.push(...parseStaticEffectSpecsFromOraclePermanent({
      id: sourcePermanentId,
      controller: sourceController,
      card: {
        name: String(emblem.sourceName || emblem.name || 'Emblem'),
        oracle_text: String(emblem.effect || emblem.text || emblem.oracle_text || ''),
        type_line: 'Emblem',
      },
    } as BattlefieldPermanent));
  }

  return specs;
}

function permanentMatchesScope(
  permanent: BattlefieldPermanent,
  spec: StaticEffectSpec,
): boolean {
  const controller = String(spec.sourceController || '');
  if (spec.scope.qualifier && !permanentMatchesScopeQualifier(permanent, spec.scope.qualifier)) return false;
  const mine = String(permanent.controller || '') === controller;
  const notSelf = String(permanent.id || '') !== String(spec.sourcePermanentId || '');
  switch (spec.scope.kind) {
    case 'player_you':
    case 'player_opponents':
      return false;
    case 'self':
      return String(permanent.id || '') === String(spec.sourcePermanentId || '');
    case 'all_permanents':
      return true;
    case 'permanents_you_control':
      return mine;
    case 'other_permanents_you_control':
      return mine
        && notSelf;
    case 'all_creatures':
      return isCreaturePermanent(permanent);
    case 'creatures_you_control':
      return isCreaturePermanent(permanent)
        && mine
        && (!spec.scope.creatureType || hasCreatureType(permanent, spec.scope.creatureType));
    case 'other_creatures_you_control':
      return isCreaturePermanent(permanent)
        && mine
        && notSelf
        && (!spec.scope.creatureType || hasCreatureType(permanent, spec.scope.creatureType));
    case 'planeswalkers_you_control':
      return isPlaneswalkerPermanent(permanent)
        && mine;
    case 'creature_type':
      return isCreaturePermanent(permanent)
        && mine
        && hasCreatureType(permanent, String(spec.scope.creatureType || ''));
    case 'all_creatures_of_type':
      return isCreaturePermanent(permanent)
        && hasCreatureType(permanent, String(spec.scope.creatureType || ''));
    case 'other_all_creatures_of_type':
      return isCreaturePermanent(permanent)
        && notSelf
        && hasCreatureType(permanent, String(spec.scope.creatureType || ''));
    case 'other_all_creatures':
      return isCreaturePermanent(permanent)
        && notSelf;
    case 'other_all_permanents':
      return notSelf;
    case 'opponent_creatures_of_type':
      return isCreaturePermanent(permanent)
        && String(permanent.controller || '') !== controller
        && hasCreatureType(permanent, String(spec.scope.creatureType || ''));
    case 'opponent_creatures':
      return isCreaturePermanent(permanent)
        && String(permanent.controller || '') !== controller;
    case 'opponent_permanents':
      return String(permanent.controller || '') !== controller;
    case 'lands_you_control':
      return isLandPermanent(permanent)
        && mine;
    default:
      return false;
  }
}

function ensureCreatureAggregate(
  result: ContinuousEffectResult,
  permanentId: string,
): void {
  if (!result.perPermanent.has(permanentId)) {
    result.perPermanent.set(permanentId, { pDelta: 0, tDelta: 0, abilities: new Set() });
  }
}

function ensurePermanentAbilities(
  result: ContinuousEffectResult,
  permanentId: string,
): Set<string> {
  const existing = result.permanentAbilities.get(permanentId);
  if (existing) return existing;
  const created = new Set<string>();
  result.permanentAbilities.set(permanentId, created);
  return created;
}

function normalizeGrantedAbilityList(abilities: readonly string[] | undefined): string[] {
  if (!Array.isArray(abilities)) return [];
  const normalized: string[] = [];
  for (const ability of abilities) {
    const value = String(ability || '').trim().toLowerCase();
    if (value && !normalized.includes(value)) normalized.push(value);
  }
  return normalized;
}

function stripAbilitiesFromContinuousResult(
  result: ContinuousEffectResult,
  permanentId: string,
  abilities: readonly string[],
): void {
  const creatureAgg = result.perPermanent.get(permanentId);
  if (creatureAgg) {
    for (const ability of abilities) creatureAgg.abilities.delete(ability);
  }
  const permanentLevel = result.permanentAbilities.get(permanentId);
  if (permanentLevel) {
    for (const ability of abilities) permanentLevel.delete(ability);
  }
}

function specConditionDependsOnKeyword(spec: StaticEffectSpec): boolean {
  const kind = spec.condition?.kind;
  return kind === 'target_has_keyword'
    || kind === 'target_lacks_keyword'
    || kind === 'target_lacks_all_keywords';
}

function specAppliesWithoutKeywordResolver(
  permanent: BattlefieldPermanent,
  spec: StaticEffectSpec,
  state: StaticConditionState,
): boolean {
  if (!permanentMatchesScope(permanent, spec)) return false;
  return specMatchesStaticCondition(permanent, spec, state);
}

/**
 * Layer-6 keyword view for Moat / Katabatic conditions: printed + unconditional
 * grants, then unconditional removeAbilities (Gravity Sphere). Specs whose own
 * condition is with/without-keyword are skipped to avoid recursion.
 */
function permanentHasEffectiveKeywordAbility(
  permanent: BattlefieldPermanent,
  keyword: string,
  specs: readonly StaticEffectSpec[],
  state: StaticConditionState,
): boolean {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return false;
  let has = permanentHasKeywordAbility(permanent, kw);
  for (const spec of specs) {
    if (specConditionDependsOnKeyword(spec)) continue;
    if (!specAppliesWithoutKeywordResolver(permanent, spec, state)) continue;
    if (normalizeGrantedAbilityList(spec.grant.abilities).includes(kw)) has = true;
  }
  for (const spec of specs) {
    if (specConditionDependsOnKeyword(spec)) continue;
    if (!specAppliesWithoutKeywordResolver(permanent, spec, state)) continue;
    if (normalizeGrantedAbilityList(spec.grant.removeAbilities).includes(kw)) has = false;
  }
  return has;
}

export function bindKeywordResolver(
  specs: readonly StaticEffectSpec[],
  state: StaticConditionState,
): StaticKeywordResolver {
  return (permanent, keyword) => permanentHasEffectiveKeywordAbility(permanent, keyword, specs, state);
}

export function applyDeclarativeStaticSpecs(
  base: ContinuousEffectResult,
  specs: readonly StaticEffectSpec[],
  state: StaticConditionState,
): ContinuousEffectResult {
  if (specs.length === 0) return base;

  const result: ContinuousEffectResult = {
    perPermanent: new Map(base.perPermanent),
    playerHexproof: new Set(base.playerHexproof),
    playerShroud: new Set(base.playerShroud),
    typeAdditions: new Map(base.typeAdditions),
    permanentAbilities: new Map(
      [...base.permanentAbilities.entries()].map(([id, abilities]) => [id, new Set(abilities)]),
    ),
    colorAdditions: new Map(
      [...(base.colorAdditions || new Map()).entries()].map(([id, colors]) => [id, [...colors]]),
    ),
  };

  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  seedContinuousTypeAdditionsForStaticPass(battlefield, result.typeAdditions);
  const orderedSpecs = sortStaticEffectSpecsForApplication(specs, state);
  const keywordResolver = bindKeywordResolver(orderedSpecs, state);

  for (const spec of orderedSpecs) {
    if (spec.scope.kind === 'player_you') {
      const controller = String(spec.sourceController || '') as PlayerID;
      if (spec.grant.playerHexproof) result.playerHexproof.add(controller);
      if (spec.grant.playerShroud) result.playerShroud.add(controller);
      continue;
    }
    if (spec.scope.kind === 'player_opponents') {
      continue;
    }

    for (const permanent of battlefield) {
      if (!permanentMatchesScope(permanent, spec)) continue;
      if (!specMatchesStaticCondition(permanent, spec, state, keywordResolver)) continue;
      const permanentId = String(permanent.id || '');
      if (!permanentId) continue;

      const multiplier = resolveStaticCountMultiplier(spec.grant, spec, permanent, battlefield, state);
      const power = Number(spec.grant.power || 0) * multiplier;
      const toughness = Number(spec.grant.toughness || 0) * multiplier;
      if (power !== 0 || toughness !== 0) {
        ensureCreatureAggregate(result, permanentId);
        const agg = result.perPermanent.get(permanentId)!;
        agg.pDelta += power;
        agg.tDelta += toughness;
      }

      const grantedAbilities = Array.isArray(spec.grant.abilities) ? spec.grant.abilities : [];
      const copiedActivated = spec.grant.copyActivatedFromExiledWithCardType
        ? collectActivatedAbilitiesExiledWithSource(
          state,
          String(spec.sourcePermanentId || ''),
          spec.grant.copyActivatedFromExiledWithCardType,
        )
        : [];
      if (grantedAbilities.length > 0 || copiedActivated.length > 0) {
        const abilitySet = isCreaturePermanent(permanent)
          ? (() => {
            ensureCreatureAggregate(result, permanentId);
            return result.perPermanent.get(permanentId)!.abilities;
          })()
          : ensurePermanentAbilities(result, permanentId);
        const all = [...grantedAbilities, ...copiedActivated];
        for (const a of grantedAbilitiesSurvivingAbilityLoss(spec, permanent, all, battlefield)) abilitySet.add(a);
      }

      recordDeclarativeTypeAdditions(result, permanent, spec.grant.typeAdditions, spec.grant.loseOtherCreatureTypes);

      recordDeclarativeColorAdditions(result as any, permanentId, spec.grant.colorAdditions);
    }
  }

  // Re-apply lose / can't-have-or-gain after grants so Archetype-style removals win
  // over same-layer keyword grants regardless of battlefield timestamp.
  // asThoughNoAbilities / asThoughNoAbilitiesForController are honored at targeting
  // time — do not strip those abilities here.
  for (const spec of orderedSpecs) {
    const removedAbilities = normalizeGrantedAbilityList(spec.grant.removeAbilities);
    if (removedAbilities.length === 0 || spec.scope.kind === 'player_you') continue;
    for (const permanent of battlefield) {
      if (!permanentMatchesScope(permanent, spec)) continue;
      if (!specMatchesStaticCondition(permanent, spec, state, keywordResolver)) continue;
      const permanentId = String(permanent.id || '');
      if (!permanentId) continue;
      stripAbilitiesFromContinuousResult(result, permanentId, removedAbilities);
    }
  }

  return result;
}

function cacheDerivedStaticEffectSpecs(state: unknown, specs: readonly StaticEffectSpec[]): void {
  if (!state || typeof state !== 'object') return;
  Object.defineProperty(state, '_derivedStaticEffectSpecs', {
    value: specs,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

export function readDerivedStaticEffectSpecs(state: unknown): StaticEffectSpec[] | null {
  if (!state || typeof state !== 'object') return null;
  const specs = (state as { _derivedStaticEffectSpecs?: StaticEffectSpec[] })._derivedStaticEffectSpecs;
  return Array.isArray(specs) ? specs : null;
}

export function recomputeContinuousEffects(state: {
  battlefield?: readonly BattlefieldPermanent[];
}): ContinuousEffectResult {
  const specs = collectStaticEffectSpecsFromState(state);
  cacheDerivedStaticEffectSpecs(state, specs);
  const base = buildContinuousEffectsBase(state);
  // CDA "is also a Cleric, Rogue..." must apply even when no declarative spec exists on the battlefield.
  addIntrinsicAlsoCreatureTypes(Array.isArray(state.battlefield) ? state.battlefield : [], base.typeAdditions as Map<string, string[]>);
  return applyDeclarativeStaticSpecs(base, specs, state);
}

export interface OverlayStaticPTBonusSource {
  name: string;
  power: number;
  toughness: number;
}

/** Regex + overlay P/T from derived continuous effects (Phase 5.3 unified path). */
export function getContinuousPTBonusForPermanent(
  permanent: BattlefieldPermanent,
  state: { battlefield?: readonly BattlefieldPermanent[] },
): { power: number; toughness: number } {
  if (!Array.isArray(state?.battlefield)) return { power: 0, toughness: 0 };
  const continuous = readDerivedContinuousEffects(state) ?? recomputeContinuousEffects(state);
  const permanentId = String(permanent?.id || '').trim();
  if (!permanentId) return { power: 0, toughness: 0 };
  const agg = continuous.perPermanent.get(permanentId);
  return { power: agg?.pDelta ?? 0, toughness: agg?.tDelta ?? 0 };
}

export interface ContinuousStaticPTBonusSource {
  name: string;
  power: number;
  toughness: number;
}

/** Source breakdown for tooltips: overlay specs per card + lump-sum regex statics. */
export function getContinuousPTBonusSourcesForPermanent(
  permanent: BattlefieldPermanent,
  state: { battlefield?: readonly BattlefieldPermanent[] },
): { power: number; toughness: number; sources: ContinuousStaticPTBonusSource[] } {
  const total = getContinuousPTBonusForPermanent(permanent, state);
  const overlay = getOverlayStaticPTBonusForPermanent(permanent, state);
  const sources: ContinuousStaticPTBonusSource[] = overlay.sources.map((source) => ({
    name: source.name,
    power: source.power,
    toughness: source.toughness,
  }));
  const regexPower = total.power - overlay.power;
  const regexToughness = total.toughness - overlay.toughness;
  if (regexPower !== 0 || regexToughness !== 0) {
    sources.push({
      name: 'Continuous effects',
      power: regexPower,
      toughness: regexToughness,
    });
  }
  return { power: total.power, toughness: total.toughness, sources };
}

/** Overlay-only P/T bonuses — does not duplicate regex anthem/lord paths in calculateAllPTBonuses. */
export function getOverlayStaticPTBonusForPermanent(
  permanent: BattlefieldPermanent,
  state: { battlefield?: readonly BattlefieldPermanent[] },
): { power: number; toughness: number; sources: OverlayStaticPTBonusSource[] } {
  const specs = sortStaticEffectSpecsForApplication(
    readDerivedStaticEffectSpecs(state) ?? collectStaticEffectSpecsFromState(state),
    state,
  );
  if (specs.length === 0) {
    return { power: 0, toughness: 0, sources: [] };
  }

  let power = 0;
  let toughness = 0;
  const sources: OverlayStaticPTBonusSource[] = [];
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];

  const keywordResolver = bindKeywordResolver(specs, state as StaticConditionState);

  for (const spec of specs) {
    if (!permanentMatchesScope(permanent, spec)) continue;
    if (!specMatchesStaticCondition(permanent, spec, state as StaticConditionState, keywordResolver)) continue;
    const multiplier = resolveStaticCountMultiplier(spec.grant, spec, permanent, battlefield, state);
    const p = Number(spec.grant.power || 0) * multiplier;
    const t = Number(spec.grant.toughness || 0) * multiplier;
    if (p === 0 && t === 0) continue;
    power += p;
    toughness += t;
    sources.push({
      name: String(spec.sourceName || spec.id || 'Overlay static'),
      power: p,
      toughness: t,
    });
  }

  return { power, toughness, sources };
}

/** Layer 7b characteristic-setting from lords (Kudo / Godhead / Graaz). Later timestamp wins. */
export function resolveSetBasePTFromStaticSpecs(
  permanent: BattlefieldPermanent,
  state: { battlefield?: readonly BattlefieldPermanent[] } | null | undefined,
): { power: number; toughness: number } | null {
  if (!state || !Array.isArray(state.battlefield)) return null;
  const specs = sortStaticEffectSpecsForApplication(
    readDerivedStaticEffectSpecs(state) ?? collectStaticEffectSpecsFromState(state),
    state,
  );
  let result: { power: number; toughness: number } | null = null;
  const keywordResolver = bindKeywordResolver(specs, state as StaticConditionState);
  for (const spec of specs) {
    if (spec.grant.setPower === undefined && spec.grant.setToughness === undefined) continue;
    if (!permanentMatchesScope(permanent, spec)) continue;
    if (!specMatchesStaticCondition(permanent, spec, state as StaticConditionState, keywordResolver)) continue;
    result = {
      power: Number(spec.grant.setPower ?? result?.power ?? 0),
      toughness: Number(spec.grant.setToughness ?? result?.toughness ?? 0),
    };
  }
  return result;
}

/** Per-spec layer 7b set-base entries (timestamp = source battlefield index) for timestamp interleaving. */
export function collectSetBasePTEntriesFromStaticSpecs(
  permanent: BattlefieldPermanent,
  state: { battlefield?: readonly BattlefieldPermanent[] } | null | undefined,
  options?: { forceIndexProxy?: boolean },
): Array<{ power?: number; toughness?: number; timestamp: number }> {
  if (!state || !Array.isArray(state.battlefield)) return [];
  const specs = sortStaticEffectSpecsForApplication(
    readDerivedStaticEffectSpecs(state) ?? collectStaticEffectSpecsFromState(state),
    state,
  );
  const entries: Array<{ power?: number; toughness?: number; timestamp: number }> = [];
  const keywordResolver = bindKeywordResolver(specs, state as StaticConditionState);
  for (const spec of specs) {
    if (spec.grant.setPower === undefined && spec.grant.setToughness === undefined) continue;
    if (!permanentMatchesScope(permanent, spec)) continue;
    if (!specMatchesStaticCondition(permanent, spec, state as StaticConditionState, keywordResolver)) continue;
    entries.push({
      ...(spec.grant.setPower !== undefined ? { power: Number(spec.grant.setPower) } : {}),
      ...(spec.grant.setToughness !== undefined ? { toughness: Number(spec.grant.setToughness) } : {}),
      timestamp: getStaticEffectSourceTimestamp(state, String(spec.sourcePermanentId || ''), options),
    });
  }
  return entries;
}

/** Merged static ability grants from derived continuous effects (regex + overlay). */
export function getContinuousGrantedAbilitiesForPermanent(
  permanent: BattlefieldPermanent,
  state: unknown,
): string[] {
  if (!state || typeof state !== 'object' || !Array.isArray((state as { battlefield?: unknown }).battlefield)) {
    return [];
  }
  const continuous = readDerivedContinuousEffects(state) ?? recomputeContinuousEffects((state || {}) as {
    battlefield?: readonly BattlefieldPermanent[];
  });
  const abilities = new Set<string>();
  const permanentId = String(permanent?.id || '');
  if (!permanentId) return [];

  const creatureEffects = continuous.perPermanent.get(permanentId);
  if (creatureEffects) {
    for (const ability of creatureEffects.abilities) {
      const normalized = String(ability || '').trim().toLowerCase();
      if (normalized) abilities.add(normalized);
    }
  }

  const permanentLevel = continuous.permanentAbilities.get(permanentId);
  if (permanentLevel) {
    for (const ability of permanentLevel) {
      const normalized = String(ability || '').trim().toLowerCase();
      if (normalized) abilities.add(normalized);
    }
  }

  return [...abilities];
}

/** Ephemeral derived view — recomputed at SBA; never persisted to replay events. */
export function syncDerivedContinuousEffects(state: unknown): ContinuousEffectResult | null {
  if (!state || typeof state !== 'object') return null;
  if (!Array.isArray((state as { battlefield?: unknown }).battlefield)) return null;
  try {
    hydrateBattlefieldOracleText((state as { battlefield?: unknown }).battlefield);
  } catch {
    // best-effort only
  }
  try {
    // Class level sections (CR 716): only levels <= current level are active.
    syncClassLevelGating(state);
  } catch {
    // best-effort only
  }
  try {
    // "For as long as this artifact remains tapped" style pumps end as soon as their condition stops.
    expireSourceLinkedPtModifiers(state);
  } catch {
    // best-effort only
  }
  try {
    // Real timestamps (CR 613.7) for anything that entered/attached through a path without explicit stamping.
    stampMissingPermanentTimestamps(state);
    syncAuraControlChanges(state); // layer 2 control Auras
    stampAttachedTypeSettingOverrides(state); // layer 4/5 type-setting Auras (Imprisoned in the Moon)
  } catch {
    // best-effort only
  }
  const derived = recomputeContinuousEffects(state as { battlefield?: readonly BattlefieldPermanent[] });
  try {
    const battlefield = (state as { battlefield?: BattlefieldPermanent[] }).battlefield;
    if (Array.isArray(battlefield)) {
      for (const perm of battlefield) {
        const extra = derived.typeAdditions.get(String(perm?.id || '')) || [];
        (perm as any).continuousTypeAdditions = extra;
      }
    }
  } catch {
    // Derived type stamps must never break SBA sync.
  }
  try {
    scanBattlefieldContinuousEffectOverlayGaps(state);
  } catch {
    // Telemetry must never break derived-view sync.
  }
  if (state && typeof state === 'object') {
    // recomputeContinuousEffects already caches _derivedStaticEffectSpecs on state.
    cacheDerivedContinuousEffects(state, derived);
    const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
    for (const permanent of battlefield) {
      if (!permanent) continue;
      const id = String(permanent.id || '');
      // Abilities granted by continuous effects whose conditions hold right now (lords, auras,
      // "As long as ..., this creature has X"). The shared keyword helper reads this stamp so
      // conditional grants are never treated as always on.
      const granted = new Set<string>();
      for (const a of derived.perPermanent.get(id)?.abilities || []) {
        const n = String(a || '').trim().toLowerCase();
        if (n) granted.add(n);
      }
      for (const a of derived.permanentAbilities.get(id) || []) {
        const n = String(a || '').trim().toLowerCase();
        if (n) granted.add(n);
      }
      if (granted.size > 0) (permanent as any).continuousAbilities = [...granted];
      else if ((permanent as any).continuousAbilities) delete (permanent as any).continuousAbilities;
      const fromDerived = derived.colorAdditions?.get(id) || [];
      if (fromDerived.length > 0) {
        (permanent as any).colorAdditions = [...fromDerived];
      } else if ((permanent as any).colorAdditions) {
        delete (permanent as any).colorAdditions;
      }
    }
  }
  return derived;
}

export function readDerivedContinuousEffects(state: unknown): ContinuousEffectResult | null {
  if (!state || typeof state !== 'object') return null;
  const derived = (state as { _derivedContinuousEffects?: ContinuousEffectResult })._derivedContinuousEffects;
  return derived || null;
}

function cacheDerivedContinuousEffects(state: object, derived: ContinuousEffectResult): void {
  Object.defineProperty(state, '_derivedContinuousEffects', {
    value: derived,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

/**
 * Compute-once primer for read-only detector scan states built as `{ ...state, battlefield }`.
 * The spread drops the non-enumerable `_derivedContinuousEffects`, so without this every
 * `detect*Triggers` call in a battlefield-wide scan recomputed all continuous effects
 * (N permanents x N-permanent recompute = the multi-second sacrifice stalls in large games).
 * Only call this on throwaway copies; the real game state is refreshed by SBA sync.
 */
export function primeDerivedContinuousEffectsForScan(scanState: unknown): ContinuousEffectResult | null {
  if (!scanState || typeof scanState !== 'object') return null;
  if (!Array.isArray((scanState as { battlefield?: unknown }).battlefield)) return null;
  const existing = readDerivedContinuousEffects(scanState);
  if (existing) return existing;
  const derived = recomputeContinuousEffects(scanState as { battlefield?: readonly BattlefieldPermanent[] });
  cacheDerivedContinuousEffects(scanState, derived);
  return derived;
}
