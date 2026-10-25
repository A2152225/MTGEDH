// Origin parent: replacementEffectSpecZoneChangeOracleTemplates.ts
// Generic "would die, exile it instead" replacements (CR 614.6) scoped to the source itself or to
// opponents' creatures: "If ~ would die, exile it instead", "If a creature an opponent controls would die,
// exile it instead" (also "nontoken creature").
// Public entry symbols: collectDiesExileReplacementSpecsFromState, matchesZoneChangeOwnershipExtras.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpecTypes.js';
import { readCardOracleText } from './replacementEffectSpecOracleTextUtils.js';
import { selfReferenceSentences } from './replacementEffectSpecDamagePreventionOracleTemplates.js';

export function collectDiesExileReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield as any[]) {
    if (!perm || typeof perm !== 'object' || !perm.card || perm.phasedOut === true) continue;
    const sourcePermanentId = String(perm.id || '').trim();
    const oracle = readCardOracleText(perm.card);
    if (!sourcePermanentId || !oracle || !/would die/i.test(oracle)) continue;
    const sourceName = String(perm.card?.name || 'Unknown').trim();
    const base = { sourcePermanentId, sourceController: String(perm.controller || '').trim(), sourceName };
    for (const s of selfReferenceSentences(oracle, sourceName)) {
      if (/^if ~ would die, exile it instead$/.test(s)) {
        specs.push({
          ...base, id: `${sourcePermanentId}:self-die-exile-instead`, event: 'zone-change',
          match: { sourceZone: 'battlefield', destinationZone: 'graveyard', objectIsSource: true },
          instead: { redirectZone: 'exile' }, effectId: 'self-die-exile-instead', reason: 'self_die_exile_instead',
        });
      }
      const k = s.match(/^if a creature dealt damage by (~|enchanted creature|equipped creature|[a-z' -]+) this turn would die, exile it instead$/);
      const shortName = sourceName.split(',')[0].trim().toLowerCase();
      if (k && (k[1] === '~' || k[1] === shortName || k[1].endsWith(' creature'))) {
        const damagerId = k[1].endsWith(' creature') && k[1] !== shortName ? String(perm.attachedTo || '').trim() : sourcePermanentId;
        const damaged = (state as any)?.creaturesDamagedByThisCreatureThisTurn?.[damagerId];
        specs.push({
          ...base, id: `${sourcePermanentId}:damaged-by-source-die-exile-instead`, event: 'zone-change',
          match: { sourceZone: 'battlefield', destinationZone: 'graveyard', objectTypeLineIncludes: 'creature' },
          instead: { redirectZone: 'exile' }, effectId: 'damaged-by-source-die-exile-instead', reason: 'damaged_by_source_die_exile_instead',
          metadata: { damagedObjectIds: damaged && typeof damaged === 'object' ? Object.keys(damaged).filter((id) => damaged[id]) : [] },
        });
      }
      const m = s.match(/^if an? (nontoken )?creature an opponent controls would die, exile it instead$/);
      if (m) {
        specs.push({
          ...base, id: `${sourcePermanentId}:opponent-creature-die-exile-instead`, event: 'zone-change',
          match: {
            sourceZone: 'battlefield', destinationZone: 'graveyard', objectTypeLineIncludes: 'creature',
            objectControllerIsOpponentOfSource: true,
          },
          instead: { redirectZone: 'exile' }, effectId: 'opponent-creature-die-exile-instead', reason: 'opponent_creature_die_exile_instead',
          ...(m[1] ? { metadata: { nontokenOnly: true } } : {}),
        });
      }
    }
  }
  return specs;
}

/** Extra zone-change match fields that need the spec source; true when none apply. */
export function matchesZoneChangeOwnershipExtras(
  event: { object?: any; objectId?: string; controller?: string; owner?: string },
  spec: ReplacementEffectSpec,
): boolean {
  const match = spec.match || {};
  const object = event.object;
  const objectId = String(object?.id || event.objectId || '').trim();
  if (match.objectIsSource === true && (!objectId || objectId !== String(spec.sourcePermanentId || '').trim())) return false;
  if (match.objectControllerIsOpponentOfSource === true) {
    const controller = String(object?.controller || event.controller || '').trim();
    if (!controller || controller === String(spec.sourceController || '').trim()) return false;
  }
  const damagedIds = spec.metadata?.damagedObjectIds;
  if (Array.isArray(damagedIds) && (!objectId || !damagedIds.includes(objectId))) return false;
  if (spec.metadata?.nontokenOnly === true && (object?.isToken === true || object?.card?.isToken === true)) return false;
  if (spec.metadata?.objectOwnerIsSourceController === true) {
    const owner = String(event.owner || object?.owner || object?.card?.owner || object?.controller || event.controller || '').trim();
    if (!owner || owner !== String(spec.sourceController || '').trim()) return false;
  }
  return true;
}
