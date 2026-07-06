import type { BattlefieldPermanent, PlayerID } from '../../../../shared/src/index.js';
import { computeContinuousEffects, type ContinuousEffectResult } from '../../rules-engine/staticEffects.js';
import {
  extractOracleCardLookupKeys,
  resolveCompiledOverlayForCard,
} from './oracleIrCompiledOverlayLookup.js';
import { hydrateBattlefieldOracleText } from './cardOracleHydration.js';

/** Declarative static spec (Phase 5.3). See docs/oracle-ir-phase5-continuous-effects-design.md */
export type StaticEffectScopeKind =
  | 'creatures_you_control'
  | 'other_creatures_you_control'
  | 'all_creatures'
  | 'creature_type'
  | 'player_you';

export interface StaticEffectScope {
  kind: StaticEffectScopeKind;
  creatureType?: string;
}

export interface StaticEffectGrant {
  power?: number;
  toughness?: number;
  abilities?: readonly string[];
  playerHexproof?: boolean;
  playerShroud?: boolean;
}

export type StaticEffectLayer = 4 | 5 | 6 | 7;
export type StaticEffectSublayer = '7a' | '7b' | '7c' | '7d';

export type StaticEffectConditionKind =
  | 'controller_life_at_least_starting_plus'
  | 'target_is_token'
  | 'target_is_not_token'
  | 'during_source_controller_turn';

export interface StaticEffectCondition {
  kind: StaticEffectConditionKind;
  /** Life above starting total required (Leyline of Hope). */
  offset?: number;
}

export interface StaticEffectSpec {
  id: string;
  scope: StaticEffectScope;
  grant: StaticEffectGrant;
  condition?: StaticEffectCondition;
  /** CR 613 layer (default: 7 for P/T, 6 for ability grants). */
  layer?: StaticEffectLayer;
  /** CR 613 sublayer within layer 7 (default: 7b for +N/+N). */
  sublayer?: StaticEffectSublayer;
  sourcePermanentId?: string;
  sourceController?: string;
  sourceName?: string;
}

function isCreaturePermanent(permanent: BattlefieldPermanent): boolean {
  const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
  return typeLine.includes('creature') || typeLine.includes('kindred') || typeLine.includes('tribal');
}

function hasCreatureType(permanent: BattlefieldPermanent, creatureType: string): boolean {
  const typeLine = String((permanent.card as any)?.type_line || '').toLowerCase();
  const typePattern = new RegExp(`\\b${String(creatureType || '').trim().toLowerCase()}s?\\b`, 'i');
  return typePattern.test(typeLine);
}

const SUBLAYER_SORT_ORDER: Record<StaticEffectSublayer, number> = {
  '7a': 0,
  '7b': 1,
  '7c': 2,
  '7d': 3,
};

function specHasPowerToughnessGrant(spec: StaticEffectSpec): boolean {
  return Number(spec.grant.power || 0) !== 0 || Number(spec.grant.toughness || 0) !== 0;
}

function inferStaticEffectLayer(spec: StaticEffectSpec): StaticEffectLayer {
  if (spec.layer) return spec.layer;
  if (specHasPowerToughnessGrant(spec)) return 7;
  if (Array.isArray(spec.grant.abilities) && spec.grant.abilities.length > 0) return 6;
  if (spec.grant.playerHexproof || spec.grant.playerShroud) return 6;
  return 7;
}

function inferStaticEffectSublayer(spec: StaticEffectSpec): StaticEffectSublayer {
  if (spec.sublayer) return spec.sublayer;
  return specHasPowerToughnessGrant(spec) ? '7b' : '7a';
}

/** Battlefield index proxy for continuous-effect timestamp (Phase 5.4). */
export function getStaticEffectSourceTimestamp(
  state: { battlefield?: readonly BattlefieldPermanent[] },
  sourcePermanentId: string,
): number {
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const index = battlefield.findIndex((perm) => String(perm?.id || '') === String(sourcePermanentId || ''));
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

export function compareStaticEffectSpecsForApplication(
  left: StaticEffectSpec,
  right: StaticEffectSpec,
  state: { battlefield?: readonly BattlefieldPermanent[] },
): number {
  const leftLayer = inferStaticEffectLayer(left);
  const rightLayer = inferStaticEffectLayer(right);
  if (leftLayer !== rightLayer) return leftLayer - rightLayer;

  if (leftLayer === 7) {
    const leftSub = SUBLAYER_SORT_ORDER[inferStaticEffectSublayer(left)];
    const rightSub = SUBLAYER_SORT_ORDER[inferStaticEffectSublayer(right)];
    if (leftSub !== rightSub) return leftSub - rightSub;
  }

  const leftTs = getStaticEffectSourceTimestamp(state, String(left.sourcePermanentId || ''));
  const rightTs = getStaticEffectSourceTimestamp(state, String(right.sourcePermanentId || ''));
  return leftTs - rightTs;
}

function sortStaticEffectSpecsForApplication(
  specs: readonly StaticEffectSpec[],
  state: { battlefield?: readonly BattlefieldPermanent[] },
): StaticEffectSpec[] {
  return [...specs].sort((left, right) => compareStaticEffectSpecsForApplication(left, right, state));
}

function parseStaticEffectLayer(value: unknown): StaticEffectLayer | undefined {
  const layer = Number(value);
  if (layer === 4 || layer === 5 || layer === 6 || layer === 7) return layer;
  return undefined;
}

function parseStaticEffectSublayer(value: unknown): StaticEffectSublayer | undefined {
  const sublayer = String(value || '').trim() as StaticEffectSublayer;
  if (sublayer === '7a' || sublayer === '7b' || sublayer === '7c' || sublayer === '7d') return sublayer;
  return undefined;
}

function normalizeOverlayStaticSpec(
  raw: unknown,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string },
): StaticEffectSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = String(record.id || '').trim();
  const scope = (record.scope && typeof record.scope === 'object')
    ? record.scope as StaticEffectScope
    : null;
  const grant = (record.grant && typeof record.grant === 'object')
    ? record.grant as StaticEffectGrant
    : null;
  if (!id || !scope?.kind || !grant) return null;

  const conditionRaw = (record.condition && typeof record.condition === 'object')
    ? record.condition as StaticEffectCondition
    : undefined;
  const condition = conditionRaw?.kind ? conditionRaw : undefined;
  const layer = parseStaticEffectLayer(record.layer);
  const sublayer = parseStaticEffectSublayer(record.sublayer);

  return {
    id: `${source.sourcePermanentId}:${id}`,
    scope,
    grant,
    condition,
    layer,
    sublayer,
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
  };
}

function readOverlayStaticSpecs(ability: {
  ability_type?: string;
  static_specs?: readonly unknown[];
  staticSpecs?: readonly unknown[];
}): readonly unknown[] {
  const specs = ability.static_specs ?? ability.staticSpecs;
  return Array.isArray(specs) ? specs : [];
}

export function collectStaticEffectSpecsFromState(state: unknown): StaticEffectSpec[] {
  const specs: StaticEffectSpec[] = [];
  const battlefield = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];

  for (const perm of battlefield) {
    if (!perm?.card || perm?.phasedOut === true) continue;

    const sourcePermanentId = String(perm.id || '').trim();
    const sourceController = String(perm.controller || '').trim();
    const sourceName = String(perm.card?.name || perm.name || 'Unknown').trim();
    if (!sourcePermanentId) continue;

    const lookupKeys = extractOracleCardLookupKeys({ card: perm.card, effectiveCard: perm.card });
    const overlay = resolveCompiledOverlayForCard(lookupKeys);
    if (!overlay?.abilities?.length) continue;

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

  return specs;
}

function permanentMatchesScope(
  permanent: BattlefieldPermanent,
  spec: StaticEffectSpec,
): boolean {
  const controller = String(spec.sourceController || '');
  switch (spec.scope.kind) {
    case 'player_you':
      return false;
    case 'all_creatures':
      return isCreaturePermanent(permanent);
    case 'creatures_you_control':
      return isCreaturePermanent(permanent)
        && String(permanent.controller || '') === controller
        && (!spec.scope.creatureType || hasCreatureType(permanent, spec.scope.creatureType));
    case 'other_creatures_you_control':
      return isCreaturePermanent(permanent)
        && String(permanent.controller || '') === controller
        && String(permanent.id || '') !== String(spec.sourcePermanentId || '')
        && (!spec.scope.creatureType || hasCreatureType(permanent, spec.scope.creatureType));
    case 'creature_type':
      return isCreaturePermanent(permanent)
        && String(permanent.controller || '') === controller
        && hasCreatureType(permanent, String(spec.scope.creatureType || ''));
    default:
      return false;
  }
}

type StaticConditionState = {
  battlefield?: readonly BattlefieldPermanent[];
  life?: Record<string, number>;
  startingLife?: number;
  turnPlayer?: string;
};

function specMatchesStaticCondition(
  permanent: BattlefieldPermanent,
  spec: StaticEffectSpec,
  state: StaticConditionState,
): boolean {
  const condition = spec.condition;
  if (!condition?.kind) return true;

  switch (condition.kind) {
    case 'controller_life_at_least_starting_plus': {
      const controller = String(spec.sourceController || '');
      const startingLife = Number(state.startingLife || 40);
      const currentLife = Number(state.life?.[controller] ?? startingLife);
      return currentLife >= startingLife + Number(condition.offset || 0);
    }
    case 'target_is_token':
      return permanent.isToken === true;
    case 'target_is_not_token':
      return permanent.isToken !== true;
    case 'during_source_controller_turn':
      return String(state.turnPlayer || '') === String(spec.sourceController || '');
    default:
      return true;
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
  };

  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const orderedSpecs = sortStaticEffectSpecsForApplication(specs, state);

  for (const spec of orderedSpecs) {
    if (spec.scope.kind === 'player_you') {
      const controller = String(spec.sourceController || '') as PlayerID;
      if (spec.grant.playerHexproof) result.playerHexproof.add(controller);
      if (spec.grant.playerShroud) result.playerShroud.add(controller);
      continue;
    }

    for (const permanent of battlefield) {
      if (!permanentMatchesScope(permanent, spec)) continue;
      if (!specMatchesStaticCondition(permanent, spec, state)) continue;
      const permanentId = String(permanent.id || '');
      if (!permanentId) continue;

      const power = Number(spec.grant.power || 0);
      const toughness = Number(spec.grant.toughness || 0);
      if (power !== 0 || toughness !== 0) {
        ensureCreatureAggregate(result, permanentId);
        const agg = result.perPermanent.get(permanentId)!;
        agg.pDelta += power;
        agg.tDelta += toughness;
      }

      const grantedAbilities = Array.isArray(spec.grant.abilities) ? spec.grant.abilities : [];
      if (grantedAbilities.length > 0) {
        const abilitySet = isCreaturePermanent(permanent)
          ? (() => {
            ensureCreatureAggregate(result, permanentId);
            return result.perPermanent.get(permanentId)!.abilities;
          })()
          : ensurePermanentAbilities(result, permanentId);
        for (const ability of grantedAbilities) {
          const normalized = String(ability || '').trim().toLowerCase();
          if (normalized) abilitySet.add(normalized);
        }
      }
    }
  }

  return result;
}

export function recomputeContinuousEffects(state: {
  battlefield?: readonly BattlefieldPermanent[];
}): ContinuousEffectResult {
  const base = computeContinuousEffects(state as any);
  const overlaySpecs = collectStaticEffectSpecsFromState(state);
  return applyDeclarativeStaticSpecs(base, overlaySpecs, state);
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
  const specs = sortStaticEffectSpecsForApplication(collectStaticEffectSpecsFromState(state), state);
  if (specs.length === 0) {
    return { power: 0, toughness: 0, sources: [] };
  }

  let power = 0;
  let toughness = 0;
  const sources: OverlayStaticPTBonusSource[] = [];

  for (const spec of specs) {
    if (!permanentMatchesScope(permanent, spec)) continue;
    if (!specMatchesStaticCondition(permanent, spec, state as StaticConditionState)) continue;
    const p = Number(spec.grant.power || 0);
    const t = Number(spec.grant.toughness || 0);
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
  const derived = recomputeContinuousEffects(state as { battlefield?: readonly BattlefieldPermanent[] });
  if (state && typeof state === 'object') {
    Object.defineProperty(state, '_derivedContinuousEffects', {
      value: derived,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  return derived;
}

export function readDerivedContinuousEffects(state: unknown): ContinuousEffectResult | null {
  if (!state || typeof state !== 'object') return null;
  const derived = (state as { _derivedContinuousEffects?: ContinuousEffectResult })._derivedContinuousEffects;
  return derived || null;
}
