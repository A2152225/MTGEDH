import { calculateVariablePT } from "../state/utils.js";

function matchesTypeFilter(typeLine: string, types: string[]): boolean {
  return types.some((rawType: string) => {
    const type = String(rawType || '').toLowerCase();
    if (!type) return false;
    if (type === 'historic') {
      return typeLine.includes('artifact') || typeLine.includes('legendary') || typeLine.includes('saga');
    }
    if (type === 'permanent') {
      return typeLine.includes('creature') ||
        typeLine.includes('artifact') ||
        typeLine.includes('enchantment') ||
        typeLine.includes('land') ||
        typeLine.includes('planeswalker') ||
        typeLine.includes('battle');
    }
    if (type === 'noncreature') return !typeLine.includes('creature');
    if (type === 'nonland') return !typeLine.includes('land');
    if (type === 'nonartifact') return !typeLine.includes('artifact');
    return typeLine.includes(type);
  });
}

export function toAvailableLibraryCard(card: any): any {
  return {
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    image_uris: card.image_uris,
    imageUrl: card.image_uris?.normal,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    colors: card.colors,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
  };
}

export function filterLibraryCardsForSearch(library: any[], filter: any, gameState?: any, controllerId?: string): any[] {
  const availableCards: any[] = [];
  const searchCriteria = filter || {};

  const gameStateForCDA = gameState ? {
    battlefield: gameState.battlefield || [],
    zones: gameState.zones || {},
    players: gameState.players || [],
    life: gameState.life || {},
    manaPool: gameState.manaPool || {},
  } : undefined;

  for (const card of Array.isArray(library) ? library : []) {
    let matches = true;

    if (searchCriteria.types && searchCriteria.types.length > 0) {
      const typeLine = String(card?.type_line || '').toLowerCase();
      matches = matchesTypeFilter(typeLine, searchCriteria.types);
    }

    if (matches && searchCriteria.allTypes && searchCriteria.allTypes.length > 0) {
      const typeLine = String(card?.type_line || '').toLowerCase();
      matches = searchCriteria.allTypes.every((requiredType: string) => typeLine.includes(String(requiredType || '').toLowerCase()));
    }

    if (matches && searchCriteria.subtypes && searchCriteria.subtypes.length > 0) {
      const typeLine = String(card?.type_line || '').toLowerCase();
      matches = searchCriteria.subtypes.some((subtype: string) => typeLine.includes(String(subtype).toLowerCase()));
    }

    if (matches && searchCriteria.supertypes && searchCriteria.supertypes.length > 0) {
      const typeLine = String(card?.type_line || '').toLowerCase();
      matches = searchCriteria.supertypes.some((supertype: string) => typeLine.includes(String(supertype).toLowerCase()));
    }

    if (matches && searchCriteria.colors && searchCriteria.colors.length > 0) {
      const cardColors = Array.isArray(card?.colors) ? card.colors : [];
      matches = searchCriteria.colors.some((color: string) => cardColors.includes(color));
    }

    if (matches && (typeof searchCriteria.maxCmc === 'number' || typeof searchCriteria.maxManaValue === 'number')) {
      const maxCmc = typeof searchCriteria.maxCmc === 'number' ? searchCriteria.maxCmc : searchCriteria.maxManaValue;
      matches = Number(card?.cmc || 0) <= Number(maxCmc);
    }

    if (matches && typeof searchCriteria.maxPower === 'number') {
      if (card?.power !== undefined && card?.power !== null) {
        const powerStr = String(card.power);
        const powerNum = Number.parseInt(powerStr, 10);
        if (!Number.isNaN(powerNum)) {
          matches = powerNum <= searchCriteria.maxPower;
        } else if (powerStr.includes('*') && gameStateForCDA) {
          const cardWithOwner = { ...card, owner: controllerId, controller: controllerId };
          const calculatedPT = calculateVariablePT(cardWithOwner, gameStateForCDA);
          if (calculatedPT) {
            matches = calculatedPT.power <= searchCriteria.maxPower;
          }
        }
      }
    }

    if (matches && typeof searchCriteria.minPower === 'number') {
      if (card?.power !== undefined && card?.power !== null) {
        const powerStr = String(card.power);
        const powerNum = Number.parseInt(powerStr, 10);
        if (!Number.isNaN(powerNum)) {
          matches = powerNum >= searchCriteria.minPower;
        } else if (powerStr.includes('*') && gameStateForCDA) {
          const cardWithOwner = { ...card, owner: controllerId, controller: controllerId };
          const calculatedPT = calculateVariablePT(cardWithOwner, gameStateForCDA);
          if (calculatedPT) {
            matches = calculatedPT.power >= searchCriteria.minPower;
          }
        }
      }
    }

    if (matches && typeof searchCriteria.maxToughness === 'number') {
      if (card?.toughness !== undefined && card?.toughness !== null) {
        const toughnessStr = String(card.toughness);
        const toughnessNum = Number.parseInt(toughnessStr, 10);
        if (!Number.isNaN(toughnessNum)) {
          matches = toughnessNum <= searchCriteria.maxToughness;
        } else if (toughnessStr.includes('*') && gameStateForCDA) {
          const cardWithOwner = { ...card, owner: controllerId, controller: controllerId };
          const calculatedPT = calculateVariablePT(cardWithOwner, gameStateForCDA);
          if (calculatedPT) {
            matches = calculatedPT.toughness <= searchCriteria.maxToughness;
          }
        }
      }
    }

    if (matches && typeof searchCriteria.minToughness === 'number') {
      if (card?.toughness !== undefined && card?.toughness !== null) {
        const toughnessStr = String(card.toughness);
        const toughnessNum = Number.parseInt(toughnessStr, 10);
        if (!Number.isNaN(toughnessNum)) {
          matches = toughnessNum >= searchCriteria.minToughness;
        } else if (toughnessStr.includes('*') && gameStateForCDA) {
          const cardWithOwner = { ...card, owner: controllerId, controller: controllerId };
          const calculatedPT = calculateVariablePT(cardWithOwner, gameStateForCDA);
          if (calculatedPT) {
            matches = calculatedPT.toughness >= searchCriteria.minToughness;
          }
        }
      }
    }

    if (matches && typeof searchCriteria.minCmc === 'number') {
      matches = Number(card?.cmc || 0) >= searchCriteria.minCmc;
    }

    if (matches) {
      availableCards.push(toAvailableLibraryCard(card));
    }
  }

  return availableCards;
}