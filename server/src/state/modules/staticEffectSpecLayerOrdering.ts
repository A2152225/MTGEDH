// server/src/state/modules/staticEffectSpecLayerOrdering.ts
// Layer/sublayer inference and timestamp ordering for declarative static specs (CR 613), plus normalisation of
// Oracle-IR overlay static specs. Extracted from staticEffectSpec.ts (round 8) to keep that file under 40KB.
// Public entry symbols: compareStaticEffectSpecsForApplication, sortStaticEffectSpecsForApplication,
// getStaticEffectSourceTimestamp, inferStaticEffectLayer, normalizeOverlayStaticSpec, readOverlayStaticSpecs,
// overlayHasStaticSpecs.

import type { BattlefieldPermanent } from '../../../../shared/src/index.js';
import { readPermanentTimestamp } from '../../../../rules-engine/src/permanentTimestamps.js';
import type {
  StaticEffectCondition,
  StaticEffectGrant,
  StaticEffectLayer,
  StaticEffectScope,
  StaticEffectSpec,
  StaticEffectSublayer,
} from './staticEffectSpecTypes.js';

const SUBLAYER_SORT_ORDER: Record<StaticEffectSublayer, number> = { '7a': 0, '7b': 1, '7c': 2, '7d': 3 };

function specHasPowerToughnessGrant(spec: StaticEffectSpec): boolean {
  return Number(spec.grant.power || 0) !== 0 || Number(spec.grant.toughness || 0) !== 0
    || spec.grant.setPower !== undefined || spec.grant.setToughness !== undefined;
}

export function inferStaticEffectLayer(spec: StaticEffectSpec): StaticEffectLayer {
  if (spec.layer) return spec.layer;
  if (Array.isArray(spec.grant.typeAdditions) && spec.grant.typeAdditions.length > 0) return 4;
  if (specHasPowerToughnessGrant(spec)) return 7;
  if (Array.isArray(spec.grant.abilities) && spec.grant.abilities.length > 0) return 6;
  if (Array.isArray(spec.grant.removeAbilities) && spec.grant.removeAbilities.length > 0) return 6;
  if (Array.isArray(spec.grant.asThoughNoAbilities) && spec.grant.asThoughNoAbilities.length > 0) {
    return 6;
  }
  if (Array.isArray(spec.grant.asThoughNoAbilitiesForController) && spec.grant.asThoughNoAbilitiesForController.length > 0) {
    return 6;
  }
  if (spec.grant.playerHexproof || spec.grant.playerShroud) return 6;
  if (spec.grant.copyActivatedFromExiledWithCardType) return 6;
  return 7;
}

function inferStaticEffectSublayer(spec: StaticEffectSpec): StaticEffectSublayer {
  if (spec.sublayer) return spec.sublayer;
  return specHasPowerToughnessGrant(spec) ? '7b' : '7a';
}

/**
 * Continuous-effect timestamp of a static effect's source: its real entry timestamp when the permanent has
 * one (permanentTimestamps.ts), otherwise the battlefield index proxy (Phase 5.4, legacy/un-stamped states).
 */
export function getStaticEffectSourceTimestamp(
  state: { battlefield?: readonly BattlefieldPermanent[] },
  sourcePermanentId: string,
  options?: { forceIndexProxy?: boolean },
): number {
  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const index = battlefield.findIndex((perm) => String(perm?.id || '') === String(sourcePermanentId || ''));
  if (index < 0) return Number.MAX_SAFE_INTEGER;
  if (options?.forceIndexProxy) return index;
  return readPermanentTimestamp(battlefield[index]) ?? index;
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

export function sortStaticEffectSpecsForApplication(
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

export function normalizeOverlayStaticSpec(
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

export function readOverlayStaticSpecs(ability: {
  ability_type?: string;
  static_specs?: readonly unknown[];
  staticSpecs?: readonly unknown[];
}): readonly unknown[] {
  const specs = ability.static_specs ?? ability.staticSpecs;
  return Array.isArray(specs) ? specs : [];
}

export function overlayHasStaticSpecs(overlay: { abilities?: readonly any[] } | null | undefined): boolean {
  if (!overlay?.abilities?.length) return false;
  for (const ability of overlay.abilities) {
    if (String(ability.ability_type || '').toUpperCase() !== 'STATIC') continue;
    if (readOverlayStaticSpecs(ability).length > 0) return true;
  }
  return false;
}

