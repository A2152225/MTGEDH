// server/src/state/modules/staticEffectSpec-handlers/playerChoseWarPeaceAnthems.ts
// B62: Archangel of Strife ? "Creatures controlled by players who chose war/peace get +N/+M."
// Choices live on the source as playerModeChoices: Record<playerId, 'war'|'peace'>.
// Public: pushPlayerChoseWarPeaceAnthemSpecs.

import type { StaticEffectCondition, StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, parseBuffSegment, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';

const LINE_RE =
  /creatures controlled by players who chose (war|peace) get\s+([+\-]\d+\s*\/\s*[+\-]\d+)/gi;

export function pushPlayerChoseWarPeaceAnthemSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  oracle: string,
): void {
  let index = 0;
  for (const match of String(oracle || '').matchAll(LINE_RE)) {
    const option = String(match[1] || '').toLowerCase();
    const buff = parseBuffSegment(match[2] || '');
    if (!buff || (option !== 'war' && option !== 'peace')) continue;
    const condition = {
      kind: 'target_controller_chose_option_on_source',
      option,
    } as StaticEffectCondition;
    specs.push(buildSpec(
      source,
      `player-chose-${option}-anthem:${index++}`,
      { kind: 'all_creatures' },
      { power: buff.power, toughness: buff.toughness },
      condition,
    ));
  }
}

/** True when the creature's controller's choice on the effect source matches option. */
export function evalTargetControllerChoseOptionOnSource(
  condition: { option?: string },
  target: any,
  source: any,
): boolean {
  const wanted = String(condition.option || '').toLowerCase().trim();
  const controller = String(target?.controller || '').trim();
  if (!wanted || !controller || !source) return false;
  const map = (source.playerModeChoices || source.warPeaceChoices || source.playerChoices || {}) as Record<string, string>;
  return String(map[controller] || '').toLowerCase().trim() === wanted;
}
