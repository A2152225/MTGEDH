import type { PlayerID, KnownCardRef } from '../../shared/src';
import {
  StaticEffectType,
  type StaticAbility,
} from './staticAbilitiesShared';

/**
 * Parse static abilities from a card's oracle text.
 */
export function parseStaticAbilities(
  card: KnownCardRef,
  permanentId: string,
  controllerId: PlayerID
): StaticAbility[] {
  const abilities: StaticAbility[] = [];
  const oracleText = (card.oracle_text || '').toLowerCase();
  const name = card.name || '';

  const lordMatch = oracleText.match(/other\s+(\w+)\s+creatures?\s+(?:you control\s+)?get\s+\+(\d+)\/\+(\d+)/i);
  if (lordMatch) {
    abilities.push({
      id: `${permanentId}-lord`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.PUMP,
      filter: {
        types: [lordMatch[1]],
        cardTypes: ['creature'],
        controller: 'you',
        other: true,
      },
      powerMod: parseInt(lordMatch[2]),
      toughnessMod: parseInt(lordMatch[3]),
      layer: 7,
    });
  }

  if (!lordMatch) {
    const creaturePumpMatch = oracleText.match(/creatures?\s+you\s+control\s+get\s+\+(\d+)\/\+(\d+)/i);
    if (creaturePumpMatch) {
      abilities.push({
        id: `${permanentId}-pump-your-creatures`,
        sourceId: permanentId,
        sourceName: name,
        controllerId,
        effectType: StaticEffectType.PUMP,
        filter: {
          cardTypes: ['creature'],
          controller: 'you',
        },
        powerMod: parseInt(creaturePumpMatch[1]),
        toughnessMod: parseInt(creaturePumpMatch[2]),
        layer: 7,
      });
    }
  }

  const colorPumpMatch = oracleText.match(/(white|blue|black|red|green)\s+creatures?\s+get\s+\+(\d+)\/\+(\d+)/i);
  if (colorPumpMatch) {
    abilities.push({
      id: `${permanentId}-color-pump`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.PUMP,
      filter: {
        cardTypes: ['creature'],
        colors: [colorPumpMatch[1].toLowerCase()],
        controller: 'any',
      },
      powerMod: parseInt(colorPumpMatch[2]),
      toughnessMod: parseInt(colorPumpMatch[3]),
      layer: 7,
    });
  }

  const colorYouPumpMatch = oracleText.match(/(white|blue|black|red|green)\s+creatures?\s+you\s+control\s+get\s+\+(\d+)\/\+(\d+)/i);
  if (colorYouPumpMatch) {
    abilities.push({
      id: `${permanentId}-color-you-pump`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.PUMP,
      filter: {
        cardTypes: ['creature'],
        colors: [colorYouPumpMatch[1].toLowerCase()],
        controller: 'you',
      },
      powerMod: parseInt(colorYouPumpMatch[2]),
      toughnessMod: parseInt(colorYouPumpMatch[3]),
      layer: 7,
    });
  }

  const abilityGrantMatch = oracleText.match(/creatures?\s+you\s+control\s+have\s+(flying|trample|lifelink|deathtouch|vigilance|haste|first strike|double strike|hexproof|indestructible|menace|reach)/i);
  if (abilityGrantMatch) {
    abilities.push({
      id: `${permanentId}-grant-${abilityGrantMatch[1]}`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.GRANT_ABILITY,
      filter: {
        cardTypes: ['creature'],
        controller: 'you',
      },
      value: abilityGrantMatch[1].toLowerCase(),
      layer: 6,
    });
  }

  const typeAbilityMatch = oracleText.match(/(\w+)\s+creatures?\s+(?:you\s+control\s+)?have\s+(flying|trample|lifelink|deathtouch|vigilance|haste|first strike|double strike|hexproof|indestructible|menace|reach|islandwalk|forestwalk|mountainwalk|swampwalk|plainswalk)/i);
  if (typeAbilityMatch && !typeAbilityMatch[1].match(/^(all|each|every|other)$/i)) {
    abilities.push({
      id: `${permanentId}-type-grant-${typeAbilityMatch[2]}`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.GRANT_ABILITY,
      filter: {
        types: [typeAbilityMatch[1]],
        cardTypes: ['creature'],
        controller: oracleText.includes('you control') ? 'you' : 'any',
      },
      value: typeAbilityMatch[2].toLowerCase(),
      layer: 6,
    });
  }

  const conditionalAbilityMatch = oracleText.match(/creatures?\s+(?:you\s+control\s+)?with\s+(first strike|flying|trample|lifelink|deathtouch|vigilance|haste|hexproof|indestructible|menace|reach)\s+have\s+(double strike|flying|trample|lifelink|deathtouch|vigilance|haste|hexproof|indestructible|menace|reach)/i);
  if (conditionalAbilityMatch) {
    abilities.push({
      id: `${permanentId}-conditional-grant-${conditionalAbilityMatch[2]}`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.GRANT_ABILITY,
      filter: {
        cardTypes: ['creature'],
        controller: oracleText.includes('you control') ? 'you' : 'any',
        hasAbility: conditionalAbilityMatch[1].toLowerCase(),
      },
      value: conditionalAbilityMatch[2].toLowerCase(),
      layer: 6,
    });
  }

  const abilityRemovalMatch = oracleText.match(/creatures?\s+your\s+opponents?\s+control\s+lose\s+(first strike|flying|trample|lifelink|deathtouch|vigilance|haste|double strike|hexproof|indestructible|menace|reach)/i);
  if (abilityRemovalMatch) {
    abilities.push({
      id: `${permanentId}-remove-${abilityRemovalMatch[1]}`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.REMOVE_ABILITY,
      filter: {
        cardTypes: ['creature'],
        controller: 'opponents',
      },
      value: abilityRemovalMatch[1].toLowerCase(),
      layer: 6,
    });
  }

  const cantGainMatch = oracleText.match(/(?:creatures?\s+your\s+opponents?\s+control\s+)?can't\s+have\s+or\s+gain\s+(first strike|flying|trample|lifelink|deathtouch|vigilance|haste|double strike|hexproof|indestructible|menace|reach)/i);
  if (cantGainMatch) {
    abilities.push({
      id: `${permanentId}-prevent-${cantGainMatch[1]}`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.REMOVE_ABILITY,
      filter: {
        cardTypes: ['creature'],
        controller: 'opponents',
        preventGaining: true,
      },
      value: cantGainMatch[1].toLowerCase(),
      layer: 6,
    });
  }

  const ignoreHexproofMatch = oracleText.match(/creatures?\s+(?:your\s+)?opponents?\s+control\s+with\s+hexproof\s+can\s+be\s+the\s+targets?\s+of\s+spells?\s+and\s+abilities?\s+you\s+control\s+as\s+though\s+they\s+didn't\s+have\s+hexproof/i);
  if (ignoreHexproofMatch) {
    abilities.push({
      id: `${permanentId}-ignore-hexproof`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.IGNORE_HEXPROOF,
      filter: {
        cardTypes: ['creature'],
        controller: 'opponents',
        hasAbility: 'hexproof',
      },
      value: 'hexproof',
      layer: 6,
    });
  }

  const loseHexproofMatch = oracleText.match(/creatures?\s+your\s+opponents?\s+control\s+lose\s+hexproof/i);
  if (loseHexproofMatch) {
    abilities.push({
      id: `${permanentId}-remove-hexproof`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.REMOVE_ABILITY,
      filter: {
        cardTypes: ['creature'],
        controller: 'opponents',
      },
      value: 'hexproof',
      layer: 6,
    });
  }

  const cantBeBlockedMatch = oracleText.match(/creatures?\s+you\s+control\s+(?:gain\s+)?(?:have\s+)?(?:and\s+)?can't\s+be\s+blocked/i);
  if (cantBeBlockedMatch) {
    abilities.push({
      id: `${permanentId}-unblockable`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.UNBLOCKABLE,
      filter: {
        cardTypes: ['creature'],
        controller: 'you',
      },
      value: 'unblockable',
      layer: 6,
    });
  }

  const landTypeGrantMatch = oracleText.match(/each\s+(other\s+)?land\s+is\s+(?:a\s+)?(\w+)\s+in\s+addition/i);
  if (landTypeGrantMatch) {
    abilities.push({
      id: `${permanentId}-add-land-type`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.ADD_LAND_TYPE,
      filter: {
        cardTypes: ['land'],
        other: !!landTypeGrantMatch[1],
        controller: 'any',
      },
      value: landTypeGrantMatch[2].toLowerCase(),
      layer: 4,
    });
  }

  const pumpPerTypeMatch = oracleText.match(/gets?\s+\+(\d+)\/\+(\d+)\s+for\s+each\s+(other\s+)?(\w+)/i);
  if (pumpPerTypeMatch) {
    abilities.push({
      id: `${permanentId}-pump-per-creature`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.PUMP_PER_CREATURE,
      filter: {
        cardTypes: ['creature'],
        selfOnly: true,
      },
      powerMod: parseInt(pumpPerTypeMatch[1]),
      toughnessMod: parseInt(pumpPerTypeMatch[2]),
      countFilter: {
        types: [pumpPerTypeMatch[4].toLowerCase()],
        other: !!pumpPerTypeMatch[3],
        controller: 'any',
      },
      layer: 7,
    });
  }

  const commanderPumpMatch = oracleText.match(/commander\s+(?:creatures?\s+)?(?:you\s+control\s+)?(?:gets?|has|have)\s+\+(\d+)\/\+(\d+)/i);
  if (commanderPumpMatch) {
    abilities.push({
      id: `${permanentId}-commander-pump`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.PUMP,
      filter: {
        cardTypes: ['creature'],
        controller: 'you',
        isCommander: true,
      } as any,
      powerMod: parseInt(commanderPumpMatch[1]),
      toughnessMod: parseInt(commanderPumpMatch[2]),
      layer: 7,
    });
  }

  const commanderIndestructibleMatch = oracleText.match(/commander\s+(?:creatures?\s+)?(?:you\s+control\s+)?(?:has|have)\s+indestructible/i);
  if (commanderIndestructibleMatch) {
    abilities.push({
      id: `${permanentId}-commander-indestructible`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.GRANT_ABILITY,
      filter: {
        cardTypes: ['creature'],
        controller: 'you',
        isCommander: true,
      } as any,
      value: 'indestructible',
      layer: 6,
    });
  }

  const powerEqualMatch = oracleText.match(/(?:~'?s?|this creature'?s?)\s+power\s+is\s+equal\s+to\s+(?:the\s+)?number\s+of\s+(\w+)s?\s+you\s+control/i);
  if (powerEqualMatch) {
    abilities.push({
      id: `${permanentId}-power-equal-count`,
      sourceId: permanentId,
      sourceName: name,
      controllerId,
      effectType: StaticEffectType.PUMP_PER_CREATURE,
      filter: {
        selfOnly: true,
      },
      powerMod: 1,
      toughnessMod: 0,
      countFilter: {
        types: [powerEqualMatch[1].toLowerCase()],
        other: false,
        controller: 'you',
      },
      layer: 7,
    });
  }

  return abilities;
}
