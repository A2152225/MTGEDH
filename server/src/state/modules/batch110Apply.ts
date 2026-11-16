// server/src/state/modules/batch110Apply.ts
// B110 live apply: Clamavus, Zinnia, Kinbinding, Jetmir's six/nine thresholds,
// The Flesh Is Weak, and Beckoning Will-o'-Wisp.
// Public: applyBatch110PowerToughnessAdjustment, batch110PermanentHasKeyword,
// batch110AdditionalTypes.

import {
  parseAlsoPTAndKeywordAtCreatureCount,
  parseCreaturesAttackingLastChosenPlayerPT,
  parseCreaturesYouControlPTWhereXIsEnteredThisTurn,
  parseCreaturesYouControlWithPlusCountersAreArtifacts,
  parseEachCreatureYouControlPTPerCounter,
  parseNonartifactCreaturesGetPT,
  parseSelfPTWhereXIsOtherCreaturesWithBasePower,
  normalizeB110Oracle,
} from './batch110Parsers.js';

function oracleOf(perm: any): string {
  return normalizeB110Oracle(String(perm?.card?.oracle_text || perm?.oracle_text || ''));
}

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

function battlefieldOf(state: any): any[] {
  return Array.isArray(state?.battlefield) ? state.battlefield : [];
}

function isPhased(perm: any): boolean {
  return Boolean(perm && perm.phasedOut === true);
}

function isCreatureish(perm: any): boolean {
  if (!perm || perm.notCreature === true) return false;
  if (perm.isCreature === true) return true;
  if (/\bcreature\b/.test(typeLineOf(perm))) return true;
  return Array.isArray(perm?.layer4AddedTypes) && perm.layer4AddedTypes.includes('Creature');
}

function counterCount(perm: any, kind: string): number {
  const counters = perm?.counters;
  if (!counters || typeof counters !== 'object') return 0;
  return Math.max(0, Math.floor(Number(counters[kind]) || 0));
}

function basePower(perm: any): number {
  const raw = perm?.basePower ?? perm?.card?.power;
  const value = Number(raw);
  return Number.isFinite(value) ? value : NaN;
}

function creatureCountYouControl(battlefield: any[], controller: string): number {
  return battlefield.filter((perm) => perm && !isPhased(perm) && String(perm.controller || '') === controller && isCreatureish(perm)).length;
}

function enteredThisTurnCount(battlefield: any[], controller: string): number {
  return battlefield.filter((perm) => perm && !isPhased(perm)
    && String(perm.controller || '') === controller
    && isCreatureish(perm)
    && (perm.enteredThisTurn === true || perm.enteredBattlefieldThisTurn === true)).length;
}

function chosenPlayerId(perm: any): string {
  return String(perm?.lastChosenPlayer || perm?.chosenPlayerId || perm?.chosenPlayer || perm?.card?.chosenPlayer || '').trim();
}

function attackingPlayerId(perm: any, battlefield: any[]): string {
  const raw = perm?.attacking;
  if (typeof raw !== 'string' || !raw) return '';
  const asPermanent = battlefield.find((entry) => entry && String(entry.id || '') === raw);
  if (asPermanent) return String(asPermanent.controller || '');
  return raw;
}

export function batch110AdditionalTypes(perm: any, state: any): string[] {
  if (!perm || !state || !isCreatureish(perm)) return [];
  if (counterCount(perm, '+1/+1') <= 0) return [];
  const controller = String(perm.controller || '');
  const grants = battlefieldOf(state).some((src) => src && !isPhased(src)
    && String(src.controller || '') === controller
    && parseCreaturesYouControlWithPlusCountersAreArtifacts(oracleOf(src)));
  return grants ? ['Artifact'] : [];
}

function isArtifactNow(perm: any, state: any): boolean {
  if (/\bartifact\b/.test(typeLineOf(perm))) return true;
  if (Array.isArray(perm?.layer4AddedTypes) && perm.layer4AddedTypes.includes('Artifact')) return true;
  return batch110AdditionalTypes(perm, state).includes('Artifact');
}

export function applyBatch110PowerToughnessAdjustment(
  perm: any,
  state: any,
  power: number,
  toughness: number,
): { power: number; toughness: number } {
  let nextPower = power;
  let nextToughness = toughness;
  if (!perm || !state || !isCreatureish(perm)) return { power: nextPower, toughness: nextToughness };
  const battlefield = battlefieldOf(state);
  const controller = String(perm.controller || '');
  for (const src of battlefield) {
    if (!src || isPhased(src)) continue;
    const perCounter = parseEachCreatureYouControlPTPerCounter(oracleOf(src));
    if (perCounter && String(src.controller || '') === controller) {
      const count = counterCount(perm, perCounter.counter);
      nextPower += perCounter.power * count;
      nextToughness += perCounter.toughness * count;
    }
    const zinnia = parseSelfPTWhereXIsOtherCreaturesWithBasePower(oracleOf(src));
    if (zinnia && String(src.id || '') === String(perm.id || '')) {
      const others = battlefield.filter((other) => other && !isPhased(other)
        && String(other.id || '') !== String(perm.id || '')
        && String(other.controller || '') === controller
        && isCreatureish(other)
        && basePower(other) === zinnia.basePower).length;
      nextPower += others;
      nextToughness += zinnia.toughness;
    }
    if (parseCreaturesYouControlPTWhereXIsEnteredThisTurn(oracleOf(src)) && String(src.controller || '') === controller) {
      const entered = enteredThisTurnCount(battlefield, controller);
      nextPower += entered;
      nextToughness += entered;
    }
    if (String(src.controller || '') === controller) {
      const controlled = creatureCountYouControl(battlefield, controller);
      for (const band of parseAlsoPTAndKeywordAtCreatureCount(oracleOf(src))) {
        if (controlled >= band.min) {
          nextPower += band.power;
          nextToughness += band.toughness;
        }
      }
    }
    const chosenBuff = parseCreaturesAttackingLastChosenPlayerPT(oracleOf(src));
    if (chosenBuff) {
      const chosen = chosenPlayerId(src);
      if (chosen && attackingPlayerId(perm, battlefield) === chosen) {
        nextPower += chosenBuff.power;
        nextToughness += chosenBuff.toughness;
      }
    }
    const debuff = parseNonartifactCreaturesGetPT(oracleOf(src));
    if (debuff && !isArtifactNow(perm, state)) {
      nextPower += debuff.power;
      nextToughness += debuff.toughness;
    }
  }
  return { power: nextPower, toughness: nextToughness };
}

export function batch110PermanentHasKeyword(perm: any, state: any, keyword: string): boolean {
  if (!perm || !state || !isCreatureish(perm)) return false;
  const needle = String(keyword || '').toLowerCase().replace(/_/g, ' ').trim();
  const controller = String(perm.controller || '');
  const controlled = creatureCountYouControl(battlefieldOf(state), controller);
  for (const src of battlefieldOf(state)) {
    if (!src || isPhased(src) || String(src.controller || '') !== controller) continue;
    for (const band of parseAlsoPTAndKeywordAtCreatureCount(oracleOf(src))) {
      if (band.keyword === needle && controlled >= band.min) return true;
    }
  }
  return false;
}
