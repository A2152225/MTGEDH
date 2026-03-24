import type { BattlefieldPermanent, PlayerID, KnownCardRef } from '../../shared/src';
import {
  StaticEffectType,
  type StaticAbility,
  type StaticEffectFilter,
} from './staticAbilitiesShared';

const KNOWN_KEYWORDS = [
  'flying', 'trample', 'lifelink', 'deathtouch', 'vigilance', 'haste',
  'first strike', 'double strike', 'hexproof', 'shroud', 'indestructible',
  'menace', 'reach', 'flash', 'defender', 'skulk', 'prowess',
  'islandwalk', 'forestwalk', 'mountainwalk', 'swampwalk', 'plainswalk',
  'protection', 'fear', 'intimidate', 'shadow', 'horsemanship', 'flanking',
  'rampage', 'phasing', 'bushido', 'provoke', 'modular', 'persist',
  'undying', 'wither', 'infect', 'battle cry', 'exalted', 'extort',
  'riot', 'afterlife', 'spectacle', 'escape', 'companion', 'daybound',
  'nightbound', 'decayed', 'disturb', 'exploit', 'myriad', 'melee',
  'partner', 'prototype', 'renown', 'riot', 'ward', 'toxic'
];

export function matchesFilter(
  permanent: BattlefieldPermanent,
  filter: StaticEffectFilter,
  sourceId: string,
  controllerId: PlayerID
): boolean {
  const card = permanent.card as KnownCardRef;
  if (!card) return false;

  const typeLine = (card.type_line || '').toLowerCase();
  const colors = card.colors || [];

  if (filter.controller === 'you' && permanent.controller !== controllerId) {
    return false;
  }
  if (filter.controller === 'opponents' && permanent.controller === controllerId) {
    return false;
  }

  if (filter.selfOnly && permanent.id !== sourceId) {
    return false;
  }

  if (filter.other && permanent.id === sourceId) {
    return false;
  }

  if ((filter as any).isCommander) {
    const isCommander = (permanent as any).isCommander === true ||
      (permanent as any).commander === true ||
      (card as any).isCommander === true;
    if (!isCommander) return false;
  }

  if (filter.cardTypes && filter.cardTypes.length > 0) {
    const hasType = filter.cardTypes.some(ct => typeLine.includes(ct.toLowerCase()));
    if (!hasType) return false;
  }

  if (filter.types && filter.types.length > 0) {
    const hasCreatureType = filter.types.some(t => typeLine.includes(t.toLowerCase()));
    if (!hasCreatureType) return false;
  }

  if (filter.colors && filter.colors.length > 0) {
    const colorMap: Record<string, string> = {
      white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
    };
    const requiredColors = filter.colors.map(c => colorMap[c.toLowerCase()] || c.toUpperCase());
    const hasColor = requiredColors.some(c => colors.includes(c));
    if (!hasColor) return false;
  }

  if (filter.name && card.name?.toLowerCase() !== filter.name.toLowerCase()) {
    return false;
  }

  if (filter.hasAbility) {
    const oracleText = (card.oracle_text || '').toLowerCase();
    const keywords = (card as any).keywords || [];
    const grantedAbilities = (permanent as any).grantedAbilities || [];
    const abilityToCheck = filter.hasAbility.toLowerCase();

    const hasAbilityInKeywords = keywords.some((k: string) => k.toLowerCase() === abilityToCheck);
    const hasAbilityInOracle = oracleText.includes(abilityToCheck);
    const hasAbilityGranted = grantedAbilities.some((a: string) =>
      typeof a === 'string' && a.toLowerCase().includes(abilityToCheck)
    );

    if (!hasAbilityInKeywords && !hasAbilityInOracle && !hasAbilityGranted) {
      return false;
    }
  }

  return true;
}

export function calculateEffectivePT(
  permanent: BattlefieldPermanent,
  battlefield: BattlefieldPermanent[],
  staticAbilities: StaticAbility[]
): { power: number; toughness: number; grantedAbilities: string[]; removedAbilities: string[] } {
  const card = permanent.card as KnownCardRef;
  if (!card) {
    return { power: 0, toughness: 0, grantedAbilities: [], removedAbilities: [] };
  }

  let power = parseInt(String(card.power || '0')) || 0;
  let toughness = parseInt(String(card.toughness || '0')) || 0;

  const plusCounters = permanent.counters?.['+1/+1'] || 0;
  const minusCounters = permanent.counters?.['-1/-1'] || 0;
  power += plusCounters - minusCounters;
  toughness += plusCounters - minusCounters;

  const grantedAbilities = Array.isArray((permanent as any).grantedAbilities)
    ? Array.from(new Set(
      ((permanent as any).grantedAbilities as unknown[])
        .filter((ability): ability is string => typeof ability === 'string')
        .map(ability => ability.toLowerCase())
    ))
    : [];
  const removedAbilities: string[] = [];

  const attachedEquipment = (permanent as any).attachedEquipment || [];
  for (const equipId of attachedEquipment) {
    const equipment = battlefield.find(p => p.id === equipId);
    if (equipment && equipment.card) {
      const equipOracle = ((equipment.card as any).oracle_text || '').toLowerCase();

      const equipAbilityMatch = equipOracle.match(/(?:equipped|enchanted)\s+creature\s+has\s+([^.]+)/i);
      if (equipAbilityMatch) {
        const abilitiesList = equipAbilityMatch[1].split(/\s+and\s+|\s*,\s*/);
        for (const ability of abilitiesList) {
          const trimmed = ability.trim().toLowerCase();
          if (trimmed && KNOWN_KEYWORDS.includes(trimmed) && !grantedAbilities.includes(trimmed)) {
            grantedAbilities.push(trimmed);
          }
        }
      }
    }
  }

  for (const equip of battlefield) {
    if (!equip || !equip.card) continue;
    const equipTypeLine = ((equip.card as any).type_line || '').toLowerCase();
    if (!equipTypeLine.includes('equipment') && !equipTypeLine.includes('aura')) continue;
    if ((equip as any).attachedTo !== permanent.id) continue;

    const equipOracle = ((equip.card as any).oracle_text || '').toLowerCase();

    const equipAbilityMatch = equipOracle.match(/(?:equipped|enchanted)\s+creature\s+has\s+([^.]+)/i);
    if (equipAbilityMatch) {
      const abilitiesList = equipAbilityMatch[1].split(/\s+and\s+|\s*,\s*/);
      for (const ability of abilitiesList) {
        const trimmed = ability.trim().toLowerCase();
        if (trimmed && KNOWN_KEYWORDS.includes(trimmed) && !grantedAbilities.includes(trimmed)) {
          grantedAbilities.push(trimmed);
        }
      }
    }

    const equipGainsMatch = equipOracle.match(/(?:equipped|enchanted)\s+creature\s+gains?\s+([^.]+)/i);
    if (equipGainsMatch) {
      const withoutUntil = equipGainsMatch[1].replace(/\s+until\s+end\s+of\s+turn.*/i, '').trim();
      const gainsList = withoutUntil.split(/\s+and\s+|\s*,\s*/);
      for (const ability of gainsList) {
        const trimmed = ability.trim().toLowerCase();
        if (trimmed && KNOWN_KEYWORDS.includes(trimmed) && !grantedAbilities.includes(trimmed)) {
          grantedAbilities.push(trimmed);
        }
      }
    }

    const ptBonusPattern = /(?:equipped|enchanted)\s+creature\s+gets?\s+([+\-]\d+)\/([+\-]\d+)(?!\s+until)/ig;
    let ptMatch: RegExpExecArray | null;
    while ((ptMatch = ptBonusPattern.exec(equipOracle)) !== null) {
      const pBonus = parseInt(ptMatch[1], 10);
      const tBonus = parseInt(ptMatch[2], 10);
      if (!isNaN(pBonus)) power += pBonus;
      if (!isNaN(tBonus)) toughness += tBonus;
    }

    const compoundMatch = equipOracle.match(/(?:equipped|enchanted)\s+creature\s+gets?\s+[+\-]\d+\/[+\-]\d+\s+and\s+(?:has|gains?)\s+([^.]+)/i);
    if (compoundMatch) {
      const extraAbilities = compoundMatch[1].split(/\s+and\s+|\s*,\s*/);
      for (const ab of extraAbilities) {
        const trimmed = ab.trim().replace(/\s+until\s+end\s+of\s+turn.*/i, '').trim().toLowerCase();
        if (trimmed && KNOWN_KEYWORDS.includes(trimmed) && !grantedAbilities.includes(trimmed)) {
          grantedAbilities.push(trimmed);
        }
      }
    }
  }

  const sortedAbilities = [...staticAbilities].sort((a, b) => a.layer - b.layer);

  for (const ability of sortedAbilities) {
    if (!matchesFilter(permanent, ability.filter, ability.sourceId, ability.controllerId)) {
      continue;
    }

    if (ability.effectType === StaticEffectType.REMOVE_ABILITY) {
      if (typeof ability.value === 'string' && !removedAbilities.includes(ability.value)) {
        removedAbilities.push(ability.value);
      }
    }
  }

  for (const ability of sortedAbilities) {
    if (!matchesFilter(permanent, ability.filter, ability.sourceId, ability.controllerId)) {
      continue;
    }

    switch (ability.effectType) {
      case StaticEffectType.PUMP:
        power += ability.powerMod || 0;
        toughness += ability.toughnessMod || 0;
        break;

      case StaticEffectType.PUMP_PER_CREATURE:
        if (ability.countFilter) {
          let count = 0;
          for (const perm of battlefield) {
            if (ability.countFilter.other && perm.id === permanent.id) {
              continue;
            }

            const permCard = perm.card as KnownCardRef;
            if (!permCard) continue;

            const permTypeLine = (permCard.type_line || '').toLowerCase();

            if (ability.countFilter.controller === 'you' && perm.controller !== ability.controllerId) {
              continue;
            }
            if (ability.countFilter.controller === 'opponents' && perm.controller === ability.controllerId) {
              continue;
            }

            if (ability.countFilter.types && ability.countFilter.types.length > 0) {
              const hasType = ability.countFilter.types.some(t =>
                permTypeLine.includes(t.toLowerCase())
              );
              const isChangeling = (permCard.oracle_text || '').toLowerCase().includes('changeling');
              if (!hasType && !isChangeling) continue;
            }

            count++;
          }

          power += (ability.powerMod || 0) * count;
          toughness += (ability.toughnessMod || 0) * count;
        }
        break;

      case StaticEffectType.SET_PT:
        if (typeof ability.value === 'string' && ability.value.includes('/')) {
          const [p, t] = ability.value.split('/').map(v => parseInt(v));
          power = p;
          toughness = t;
        }
        break;

      case StaticEffectType.GRANT_ABILITY:
        if (typeof ability.value === 'string') {
          if (!removedAbilities.includes(ability.value) && !grantedAbilities.includes(ability.value)) {
            grantedAbilities.push(ability.value);
          }
        }
        break;
    }
  }

  return { power, toughness, grantedAbilities, removedAbilities };
}
