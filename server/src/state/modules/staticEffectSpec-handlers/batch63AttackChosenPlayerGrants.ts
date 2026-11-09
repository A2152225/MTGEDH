// server/src/state/modules/staticEffectSpec-handlers/batch63AttackChosenPlayerGrants.ts
// B63: Triarch Stalker ? "Creatures attacking the last chosen player have menace."
// Chosen player lives on the source as chosenPlayerId / lastChosenPlayerId / chosenOpponentId.
// Public: pushCreaturesAttackingLastChosenPlayerGrantSpecs.

import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, parseLordAbilitiesFromTail, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';

const LINE_RE =
  /creatures attacking the last chosen player have ([^.]+)/i;

export function pushCreaturesAttackingLastChosenPlayerGrantSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  const m = String(oracle || '').toLowerCase().match(LINE_RE);
  if (!m) return;
  const abilities = parseLordAbilitiesFromTail(m[1] || '');
  if (!abilities.length) return;
  specs.push(buildSpec(
    source,
    'creatures-attacking-last-chosen-player',
    { kind: 'all_creatures' },
    { abilities },
    { kind: 'target_is_attacking_last_chosen_player_on_source' } as StaticEffectCondition,
  ));
}

/** True when the creature is attacking the player stored on the effect source. */
export function evalTargetIsAttackingLastChosenPlayerOnSource(
  _condition: unknown,
  target: any,
  source: any,
): boolean {
  if (!target || !source) return false;
  if (!target.attacking && !target.isAttacking) return false;
  const chosen = String(
    source.lastChosenPlayerId
    || source.chosenPlayerId
    || source.chosenOpponentId
    || source.lastChosenOpponentId
    || '',
  ).trim();
  if (!chosen) return false;
  const attackTarget = String(
    target.attackingPlayerId
    || target.attackTargetPlayerId
    || target.attacking
    || '',
  ).trim();
  // attacking may be player id or permanent id; player-id match is the common case.
  return attackTarget === chosen;
}
