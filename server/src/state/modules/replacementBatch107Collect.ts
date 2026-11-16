// server/src/state/modules/replacementBatch107Collect.ts
// B107 replacement collect: Hawkeye / Mechanized Warfare damage plus,
// Winding Constrictor player counters, Valgavoth / Draugr zone changes,
// and Sheltered Valley named-sacrifice would-enter (apply already live).
// Hooked from collectBatch21DamageScalingSpecs and
// collectOraclePatternZoneChangeReplacementSpecsFromState — not from
// replacementEffectSpec.ts. Public: collectBatch107* helpers and
// collectBatch107ReplacementSpecsFromState.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import {
  parseCardYouDidntControlToOpponentsGyExileInstead,
  parseLandWouldEnterSacrificeEachOtherNamed,
  parseNoncombatDamagePlusSourcePower,
  parseNontokenOpponentCreatureWouldDieExileWithNamedCounter,
  parseRedOrArtifactSourceDamagePlusN,
  parseYouWouldGetCountersPlusOneEachKind,
} from './batch107Parsers.js';

function asSpec(spec: object): ReplacementEffectSpec {
  return spec as unknown as ReplacementEffectSpec;
}

function currentPower(source: { power?: unknown; card?: { power?: unknown } }): number {
  const raw = source.power ?? source.card?.power;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function collectBatch107DamageScalingSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string; power?: unknown; card?: { power?: unknown } },
): ReplacementEffectSpec[] {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const specs: ReplacementEffectSpec[] = [];
  const base = {
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
  };
  if (parseNoncombatDamagePlusSourcePower(text)) {
    const plus = currentPower(source);
    specs.push(asSpec({
      ...base,
      id: `${source.sourcePermanentId}:noncombat-damage-plus-source-power`,
      event: 'damage',
      match: {
        dealingPlayerIsSourceController: true,
        receivingPlayerIsOpponentOfSource: true,
        noncombatDamageOnly: true,
      },
      instead: { modify: 'add_flat', value: plus },
      effectId: 'noncombat-damage-plus-source-power',
      reason: 'noncombat_damage_plus_source_power',
      metadata: { plusIsSourcePower: true },
    }));
  }
  const plusN = parseRedOrArtifactSourceDamagePlusN(text);
  if (plusN != null) {
    specs.push(asSpec({
      ...base,
      id: `${source.sourcePermanentId}:red-or-artifact-source-damage-plus-${plusN}`,
      event: 'damage',
      match: {
        dealingPlayerIsSourceController: true,
        receivingPlayerIsOpponentOfSource: true,
        damageSourceIsRedOrArtifact: true,
      } as any,
      instead: { modify: 'add_flat', value: plusN },
      effectId: `red-or-artifact-source-damage-plus-${plusN}`,
      reason: `red_or_artifact_source_damage_plus_${plusN}`,
    }));
  }
  return specs;
}

export function collectBatch107ReplacementSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string; power?: unknown; card?: { power?: unknown } },
): ReplacementEffectSpec[] {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  const specs: ReplacementEffectSpec[] = [];
  const base = {
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
  };
  specs.push(...collectBatch107DamageScalingSpecs(oracle, source));

  if (parseYouWouldGetCountersPlusOneEachKind(text)) {
    specs.push(asSpec({
      ...base,
      id: `${source.sourcePermanentId}:player-counters-plus-one-each-kind`,
      event: 'counters',
      match: { receivingPlayerIsSourceController: true } as any,
      instead: { modify: 'add_flat', value: 1 },
      effectId: 'player-counters-plus-one-each-kind',
      reason: 'player_counters_plus_one_each_kind',
    }));
  }

  if (parseCardYouDidntControlToOpponentsGyExileInstead(text)) {
    specs.push(asSpec({
      ...base,
      id: `${source.sourcePermanentId}:card-you-didnt-control-opponent-gy-exile`,
      event: 'zone-change',
      match: { destinationZone: 'graveyard' },
      instead: { redirectZone: 'exile' },
      effectId: 'card-you-didnt-control-opponent-gy-exile',
      reason: 'card_you_didnt_control_opponent_gy_exile',
      metadata: {
        objectControllerIsNotSourceController: true,
        destinationOwnerIsOpponentOfSource: true,
      },
    }));
  }

  const ice = parseNontokenOpponentCreatureWouldDieExileWithNamedCounter(text);
  if (ice) {
    specs.push(asSpec({
      ...base,
      id: `${source.sourcePermanentId}:nontoken-opponent-creature-die-exile-named-counter`,
      event: 'zone-change',
      match: {
        sourceZone: 'battlefield',
        destinationZone: 'graveyard',
        objectTypeLineIncludes: 'creature',
        objectControllerIsOpponentOfSource: true,
      },
      instead: { redirectZone: 'exile' },
      effectId: 'nontoken-opponent-creature-die-exile-named-counter',
      reason: 'nontoken_opponent_creature_die_exile_named_counter',
      metadata: {
        nontokenOnly: true,
        namedCountersOnExile: ice,
        sourcePermanentId: source.sourcePermanentId,
      },
    }));
  }

  if (parseLandWouldEnterSacrificeEachOtherNamed(text)) {
    specs.push(asSpec({
      ...base,
      id: `${source.sourcePermanentId}:land-would-enter-sacrifice-each-other-named`,
      event: 'zone-change',
      match: { destinationZone: 'battlefield', objectIsSource: true } as any,
      instead: { sacrificeEachOtherPermanentNamed: true } as any,
      effectId: 'land-would-enter-sacrifice-each-other-named',
      reason: 'land_would_enter_sacrifice_each_other_named',
    }));
  }

  return specs;
}

export function collectBatch107ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; card?: any; phasedOut?: boolean; power?: unknown };
    if (rec.phasedOut === true) continue;
    const oracle = readCardOracleText(rec.card) || readCardOracleText(perm);
    if (!oracle) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    if (!sourcePermanentId) continue;
    specs.push(...collectBatch107ReplacementSpecs(oracle, {
      sourcePermanentId,
      sourceController: String(rec.controller || ''),
      sourceName: String(rec.card?.name || ''),
      power: rec.power ?? rec.card?.power,
      card: rec.card,
    }));
  }
  return specs;
}

export function collectBatch107ZoneChangeReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  return collectBatch107ReplacementSpecsFromState(state).filter((spec) => spec.event === 'zone-change');
}
