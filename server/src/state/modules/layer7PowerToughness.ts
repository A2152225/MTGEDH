// server/src/state/modules/layer7PowerToughness.ts
// Origin parent: currentPowerToughness.ts (computeCurrentPowerToughnessWithSources body).
// The single layer-7 power/toughness evaluator (CR 613.4), shared by the client view tooltip,
// combat damage, fight/bite and goad (all read getCurrentPowerToughness):
//   7a characteristic-defining abilities / variable P/T (*/*)
//   7b set-base effects in timestamp order (Humility, "becomes a 4/4", Aura setters)
//   7c modifications: counters, anthems/lords/equipment (calculateAllPTBonusesWithSources),
//      until-end-of-turn and longer pumps
//   7d switching (switchPowerToughness modifiers; odd count swaps)
// Public entry symbols: evaluateLayer7PowerToughness, countActivePowerToughnessSwitches.

import { sumActiveTemporaryPTMods } from "./temporaryPtMods.js";
import { parsePT, calculateVariablePT, calculateAllPTBonusesWithSources, type PTBonusSource } from "../utils.js";
import { applyLayer7bSetBasePowerToughness } from "./setBasePtTimestampResolution.js";
import { sumLongDurationPtModifiers } from "./longDurationPtModifiers.js";
import { typeSetOverrideIsCreature } from "./attachedTypeSettingStamp.js";

export interface Layer7PowerToughness {
  power: number;
  toughness: number;
  sources: PTBonusSource[];
}

export function countActivePowerToughnessSwitches(perm: any): number {
  const modifiers = Array.isArray(perm?.modifiers) ? perm.modifiers : [];
  let count = 0;
  for (const modifier of modifiers) {
    const type = String(modifier?.type || '');
    if (type === 'switchPowerToughness' || type === 'SWITCH_POWER_TOUGHNESS') count++;
  }
  return count;
}

export function evaluateLayer7PowerToughness(perm: any, state: any): Layer7PowerToughness | undefined {
  // Type-set to a noncreature (Imprisoned in the Moon): no P/T.
  if (typeSetOverrideIsCreature(perm) === false) return undefined;
  const card = perm?.card as any;
  let baseP = typeof perm?.basePower === "number" ? perm.basePower : parsePT(card?.power);
  let baseT = typeof perm?.baseToughness === "number" ? perm.baseToughness : parsePT(card?.toughness);

  // Variable P/T (*/*) creatures like Morophon
  if (baseP === undefined || baseT === undefined) {
    const variablePT = calculateVariablePT({ ...card, controller: perm?.controller }, state);
    if (variablePT) {
      baseP = baseP ?? variablePT.power;
      baseT = baseT ?? variablePT.toughness;
    }
  }

  // Layer 7b set-base effects: Auras, static specs (lords) and rules-engine "becomes an X/Y" /
  // "has base P/T X/Y" modifiers (type setPowerToughness) ordered by timestamp, last one wins.
  // Applied before counters and modifications (anthems, equipment, pumps), added below.
  // Layer 4 type-setters with a paired base P/T (Opalescence) are timestamped among the other 7b setters.
  const layer7b = applyLayer7bSetBasePowerToughness(perm, state, { power: baseP, toughness: baseT });
  baseP = layer7b.power;
  baseT = layer7b.toughness;

  if (typeof baseP !== "number" || typeof baseT !== "number") return undefined;

  // Same counter keys as getActualPowerToughness (legacy aliases: plusOne, p1p1, ...).
  const counters = perm?.counters || {};
  const plus = Number(counters["+1/+1"] || counters.plus_one || counters.plusOne || counters.p1p1 || 0) || 0;
  const minus = Number(counters["-1/-1"] || counters.minus_one || counters.minusOne || counters.m1m1 || 0) || 0;
  const counterDelta = plus - minus;

  // +1/+0, +0/+1, +2/+2, -2/-2 ... counters
  let otherCounterPower = 0;
  let otherCounterToughness = 0;
  if (perm?.counters) {
    for (const [counterType, count] of Object.entries(perm.counters)) {
      if (counterType === "+1/+1" || counterType === "-1/-1") continue;
      const counterMatch = counterType.match(/^([+-]?\d+)\/([+-]?\d+)$/);
      if (counterMatch) {
        otherCounterPower += parseInt(counterMatch[1], 10) * (count as number);
        otherCounterToughness += parseInt(counterMatch[2], 10) * (count as number);
      }
    }
  }

  // Equipment, auras, anthems, lords, emblems, pump fields (with source tracking)
  const allBonusesResult = calculateAllPTBonusesWithSources(perm, state);
  const temporaryPtBonus = sumActiveTemporaryPTMods(perm);
  // Pumps lasting longer than end of turn (until your next turn, until end of combat, permanent).
  const longPtBonus = sumLongDurationPtModifiers(perm, state);

  const sources: PTBonusSource[] = [];
  if (counterDelta !== 0) {
    sources.push({ name: '+1/+1 counters', power: counterDelta, toughness: counterDelta, type: 'counter' });
  }
  if (otherCounterPower !== 0 || otherCounterToughness !== 0) {
    sources.push({ name: 'Other counters', power: otherCounterPower, toughness: otherCounterToughness, type: 'counter' });
  }
  if (temporaryPtBonus.power !== 0 || temporaryPtBonus.toughness !== 0) {
    sources.push({ name: 'Until end of turn', power: temporaryPtBonus.power, toughness: temporaryPtBonus.toughness, type: 'modifier' });
  }
  if (longPtBonus.power !== 0 || longPtBonus.toughness !== 0) {
    sources.push({ name: 'Lasting effects', power: longPtBonus.power, toughness: longPtBonus.toughness, type: 'modifier' });
  }
  sources.push(...allBonusesResult.sources);

  // 7c total, then 7d switching (CR 613.4d): an odd number of active switch effects swaps P/T.
  let power = baseP + counterDelta + otherCounterPower + allBonusesResult.power + temporaryPtBonus.power + longPtBonus.power;
  let toughness = baseT + counterDelta + otherCounterToughness + allBonusesResult.toughness + temporaryPtBonus.toughness + longPtBonus.toughness;
  if (countActivePowerToughnessSwitches(perm) % 2 === 1) {
    [power, toughness] = [toughness, power];
    sources.push({ name: 'Switched power and toughness', power: 0, toughness: 0, type: 'modifier' } as PTBonusSource);
  }
  return { power, toughness, sources };
}
