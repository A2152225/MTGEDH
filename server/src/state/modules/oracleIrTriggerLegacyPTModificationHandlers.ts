import type { PlayerID } from '../../../../shared/src/index.js';
import { getEffectivePower } from '../utils.js';
import { debug } from '../../utils/debug.js';
import { splitGrantedTemporaryAbilities } from './oracleIrSpellLegacyTargetBuffUtils.js';

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

function pushTemporaryPTMod(
  permanent: any,
  powerMod: number,
  toughnessMod: number,
  sourceName: string,
  turnNumber: number,
): void {
  permanent.temporaryPTMods = permanent.temporaryPTMods || [];
  permanent.temporaryPTMods.push({
    power: powerMod,
    toughness: toughnessMod,
    source: sourceName,
    expiresAt: 'end_of_turn',
    turnApplied: turnNumber,
  });
}

function pushTemporaryAbilities(
  permanent: any,
  gainedAbilities: readonly string[],
  sourceName: string,
  turnNumber: number,
): void {
  if (gainedAbilities.length === 0) return;
  permanent.temporaryAbilities = permanent.temporaryAbilities || [];
  for (const ability of gainedAbilities) {
    if (!ability) continue;
    permanent.temporaryAbilities.push({
      ability,
      source: sourceName,
      expiresAt: 'end_of_turn',
      turnApplied: turnNumber,
    });
  }
}

function findSourcePermanent(state: any, triggerItem: any): any | null {
  const selfSourceId = triggerItem.source || triggerItem.permanentId;
  if (!selfSourceId) return null;
  return (state.battlefield || []).find((permanent: any) => permanent?.id === selfSourceId) || null;
}

export function applyRetiredTriggerLegacyPTModificationBatch(params: {
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
}): boolean {
  const { controller, sourceName, desc, triggerItem, state } = params;
  const turnNumber = state.turnNumber || 0;
  const sourcePermanent = findSourcePermanent(state, triggerItem);

  const selfGetsMatch =
    desc.match(/(?:it|this creature|he|she) gets ([+-]\d+)\/([+-]\d+)(?: and gains (.+?))? until end of turn\.?$/i) ||
    desc.match(/until end of turn,? (?:it|this creature|he|she) gets ([+-]\d+)\/([+-]\d+)(?: and gains (.+?))?\.?$/i);
  if (selfGetsMatch && sourcePermanent) {
    const powerMod = parseInt(selfGetsMatch[1], 10);
    const toughnessMod = parseInt(selfGetsMatch[2], 10);
    const gainedAbilities = selfGetsMatch[3] ? splitGrantedTemporaryAbilities(selfGetsMatch[3]) : [];
    pushTemporaryPTMod(sourcePermanent, powerMod, toughnessMod, sourceName, turnNumber);
    pushTemporaryAbilities(sourcePermanent, gainedAbilities, sourceName, turnNumber);
    if (gainedAbilities.length > 0) {
      debug(2, `[executeTriggerEffect] ${sourcePermanent.card?.name || triggerItem.source} gets ${powerMod >= 0 ? '+' : ''}${powerMod}/${toughnessMod >= 0 ? '+' : ''}${toughnessMod} and gains ${gainedAbilities.join(', ')} until end of turn`);
    } else {
      debug(2, `[executeTriggerEffect] ${sourcePermanent.card?.name || triggerItem.source} gets ${powerMod >= 0 ? '+' : ''}${powerMod}/${toughnessMod >= 0 ? '+' : ''}${toughnessMod} until end of turn`);
    }
    return true;
  }

  const selfGainsMatch =
    desc.match(/(?:it|this creature|he|she) gains (.+?) until end of turn\.?$/i) ||
    desc.match(/until end of turn,? (?:it|this creature|he|she) gains (.+?)\.?$/i);
  if (selfGainsMatch && sourcePermanent) {
    const gainedAbilities = splitGrantedTemporaryAbilities(selfGainsMatch[1]);
    pushTemporaryAbilities(sourcePermanent, gainedAbilities, sourceName, turnNumber);
    if (gainedAbilities.length > 0) {
      debug(2, `[executeTriggerEffect] ${sourcePermanent.card?.name || triggerItem.source} gains ${gainedAbilities.join(', ')} until end of turn`);
    }
    return true;
  }

  const yourCreaturesGetMatch = desc.match(/(?:(other)\s+)?creatures you control get ([+-]\d+)\/([+-]\d+)(?: and gains? (.+?))? until end of turn\.?$/i);
  if (yourCreaturesGetMatch) {
    const otherCreaturesOnly = Boolean(yourCreaturesGetMatch[1]);
    const powerMod = parseInt(yourCreaturesGetMatch[2], 10);
    const toughnessMod = parseInt(yourCreaturesGetMatch[3], 10);
    const gainedAbilities = yourCreaturesGetMatch[4] ? splitGrantedTemporaryAbilities(yourCreaturesGetMatch[4]) : [];
    const buffSourceId = triggerItem.source || triggerItem.permanentId;
    const battlefield = state.battlefield || [];

    for (const perm of battlefield) {
      if (!perm) continue;
      if (perm.controller !== controller) continue;
      if (otherCreaturesOnly && String(perm.id || '') === String(buffSourceId || '')) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;

      pushTemporaryPTMod(perm, powerMod, toughnessMod, sourceName, turnNumber);
      pushTemporaryAbilities(perm, gainedAbilities, sourceName, turnNumber);

      if (gainedAbilities.length > 0) {
        debug(2, `[executeTriggerEffect] ${perm.card?.name || perm.id} gets ${powerMod >= 0 ? '+' : ''}${powerMod}/${toughnessMod >= 0 ? '+' : ''}${toughnessMod} and gains ${gainedAbilities.join(', ')} until end of turn`);
      } else {
        debug(2, `[executeTriggerEffect] ${perm.card?.name || perm.id} gets ${powerMod >= 0 ? '+' : ''}${powerMod}/${toughnessMod >= 0 ? '+' : ''}${toughnessMod} until end of turn`);
      }
    }
    return true;
  }

  const creatureGetsCounterScaledMatch = desc.match(/(?:until end of turn,?\s*)?(?:another\s+)?(?:up to (?:one|two|three|four|five|\d+) )?target creatures?(?: you control)? gets? \+X\/\+X(?: and gains (.+?))?(?: until end of turn)?, where X is the number of counters on permanents you control/i);
  if (creatureGetsCounterScaledMatch && (triggerItem as any).targets?.length > 0) {
    const gainedAbilities = creatureGetsCounterScaledMatch[1] ? splitGrantedTemporaryAbilities(creatureGetsCounterScaledMatch[1]) : [];
    const targets = (triggerItem as any).targets || [];
    const battlefield = state.battlefield || [];
    const xValue = battlefield.reduce((sum: number, permanent: any) => {
      if (String(permanent?.controller || '') !== String(controller || '')) return sum;
      const counters = permanent?.counters;
      if (!counters || typeof counters !== 'object' || Array.isArray(counters)) return sum;
      for (const amount of Object.values(counters)) {
        const numericAmount = Number(amount || 0);
        if (Number.isFinite(numericAmount) && numericAmount > 0) {
          sum += numericAmount;
        }
      }
      return sum;
    }, 0);

    for (const targetRef of targets) {
      const targetId = typeof targetRef === 'string' ? targetRef : targetRef?.id;
      const targetCreature = battlefield.find((p: any) => p.id === targetId);
      if (!targetCreature) continue;

      pushTemporaryPTMod(targetCreature, xValue, xValue, sourceName, turnNumber);
      pushTemporaryAbilities(targetCreature, gainedAbilities, sourceName, turnNumber);

      if (gainedAbilities.length > 0) {
        debug(2, `[executeTriggerEffect] ${targetCreature.card?.name || targetId} gets +${xValue}/+${xValue} and gains ${gainedAbilities.join(', ')} until end of turn`);
      } else {
        debug(2, `[executeTriggerEffect] ${targetCreature.card?.name || targetId} gets +${xValue}/+${xValue} until end of turn`);
      }
    }
    return true;
  }

  const doubleCreaturePowerMatch = desc.match(/double (?:another\s+)?(?:up to (?:one|two|three|four|five|\d+) )?target creature(?: you control)?'s power until end of turn\.?$/i);
  if (doubleCreaturePowerMatch && (triggerItem as any).targets?.length > 0) {
    const targets = (triggerItem as any).targets || [];
    const battlefield = state.battlefield || [];

    for (const targetRef of targets) {
      const targetId = typeof targetRef === 'string' ? targetRef : targetRef?.id;
      const targetCreature = battlefield.find((p: any) => p.id === targetId);
      if (!targetCreature) continue;

      const currentPower = Math.max(0, Number(getEffectivePower(targetCreature as any) || 0));
      pushTemporaryPTMod(targetCreature, currentPower, 0, sourceName, turnNumber);
      debug(2, `[executeTriggerEffect] ${targetCreature.card?.name || targetId} gets +${currentPower}/+0 until end of turn`);
    }
    return true;
  }

  const creatureGetsMatch = desc.match(/(?:until end of turn,?\s*)?(?:another\s+)?(?:up to (?:one|two|three|four|five|\d+) )?target creatures?(?: you control)? gets? ([+-]\d+)\/([+-]\d+)(?: and gains (.+?))?(?: until end of turn)?\.?$/i);
  if (creatureGetsMatch && (triggerItem as any).targets?.length > 0) {
    const powerMod = parseInt(creatureGetsMatch[1], 10);
    const toughnessMod = parseInt(creatureGetsMatch[2], 10);
    const gainedAbilities = creatureGetsMatch[3] ? splitGrantedTemporaryAbilities(creatureGetsMatch[3]) : [];
    const targets = (triggerItem as any).targets || [];
    const battlefield = state.battlefield || [];

    for (const targetRef of targets) {
      const targetId = typeof targetRef === 'string' ? targetRef : targetRef?.id;
      const targetCreature = battlefield.find((p: any) => p.id === targetId);
      if (!targetCreature) continue;

      pushTemporaryPTMod(targetCreature, powerMod, toughnessMod, sourceName, turnNumber);
      pushTemporaryAbilities(targetCreature, gainedAbilities, sourceName, turnNumber);

      if (gainedAbilities.length > 0) {
        debug(2, `[executeTriggerEffect] ${targetCreature.card?.name || targetId} gets ${powerMod >= 0 ? '+' : ''}${powerMod}/${toughnessMod >= 0 ? '+' : ''}${toughnessMod} and gains ${gainedAbilities.join(', ')} until end of turn`);
      } else {
        debug(2, `[executeTriggerEffect] ${targetCreature.card?.name || targetId} gets ${powerMod >= 0 ? '+' : ''}${powerMod}/${toughnessMod >= 0 ? '+' : ''}${toughnessMod} until end of turn`);
      }
    }
    return true;
  }

  const creatureGainsMatch =
    desc.match(/(?:up to (?:one|two|three|four|five|\d+) )?target creatures?(?: you control| an opponent controls)? gains? (.+?) until end of turn\.?/i) ||
    desc.match(/(?:until end of turn,?\s*)(?:up to (?:one|two|three|four|five|\d+) )?target creatures?(?: you control| an opponent controls)? gains? (.+?)\.?$/i);
  if (creatureGainsMatch && (triggerItem as any).targets?.length > 0) {
    const gainedAbilities = splitGrantedTemporaryAbilities(creatureGainsMatch[1]);
    const targets = (triggerItem as any).targets || [];
    const battlefield = state.battlefield || [];

    for (const targetRef of targets) {
      const targetId = typeof targetRef === 'string' ? targetRef : targetRef?.id;
      const targetCreature = battlefield.find((p: any) => p.id === targetId);
      if (!targetCreature) continue;

      targetCreature.temporaryAbilities = Array.isArray(targetCreature.temporaryAbilities) ? targetCreature.temporaryAbilities : [];
      pushTemporaryAbilities(targetCreature, gainedAbilities, sourceName, turnNumber);

      if (gainedAbilities.length > 0) {
        debug(2, `[executeTriggerEffect] ${targetCreature.card?.name || targetId} gains ${gainedAbilities.join(', ')} until end of turn`);
      }
    }
    return true;
  }

  const creatureCantBlockMatch = desc.match(/(?:up to (?:one|two|three|four|five|\d+) )?target creatures? can't block this turn\.?$/i);
  if (creatureCantBlockMatch && (triggerItem as any).targets?.length > 0) {
    const targets = (triggerItem as any).targets || [];
    const battlefield = state.battlefield || [];

    for (const targetRef of targets) {
      const targetId = typeof targetRef === 'string' ? targetRef : targetRef?.id;
      const targetCreature = battlefield.find((permanent: any) => permanent.id === targetId);
      if (!targetCreature) continue;

      targetCreature.temporaryAbilities = Array.isArray(targetCreature.temporaryAbilities)
        ? targetCreature.temporaryAbilities
        : [];

      const alreadyCantBlock = targetCreature.temporaryAbilities.some((entry: any) => {
        const abilityText = typeof entry === 'string' ? entry : entry?.ability;
        return String(abilityText || '').toLowerCase().includes("can't block");
      });
      if (!alreadyCantBlock) {
        targetCreature.temporaryAbilities.push({
          ability: "can't block",
          source: sourceName,
          expiresAt: 'end_of_turn',
          turnApplied: turnNumber,
        });
      }

      debug(2, `[executeTriggerEffect] ${targetCreature.card?.name || targetId} can't block this turn`);
    }
    return true;
  }

  return false;
}
