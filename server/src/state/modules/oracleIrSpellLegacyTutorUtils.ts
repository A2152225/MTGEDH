import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { enqueueLibrarySearchStep } from './triggerLibrarySearchUtils.js';

export function detectTutorSpell(oracleText: string): {
  isTutor: boolean;
  searchCriteria?: string;
  destination?: 'hand' | 'top' | 'battlefield' | 'graveyard' | 'split';
  optional?: boolean;
  maxSelections?: number;
  splitDestination?: boolean;
  toBattlefield?: number;
  toHand?: number;
  entersTapped?: boolean;
} {
  if (!oracleText) return { isTutor: false };

  const text = oracleText.replace(/\([^)]*\)/g, ' ').toLowerCase();

  if (!text.includes('search your library')) {
    return { isTutor: false };
  }

  let searchCriteria = '';
  let destination: 'hand' | 'top' | 'battlefield' | 'graveyard' | 'split' = 'hand';
  let optional = false;
  let maxSelections = 1;
  let entersTapped = false;

  const forMatch = text.match(/search your library for (?:a|an|up to (\w+)) ([^,.]+)/i);
  if (forMatch) {
    if (forMatch[1]) {
      const num = forMatch[1].toLowerCase();
      if (num === 'two') maxSelections = 2;
      else if (num === 'three') maxSelections = 3;
      else if (num === 'four') maxSelections = 4;
      else {
        const parsed = parseInt(num, 10);
        if (!Number.isNaN(parsed)) maxSelections = parsed;
      }
    }
    searchCriteria = forMatch[2].trim();
  }

  if (text.includes('you may search')) {
    optional = true;
  }

  if (text.includes('put one onto the battlefield') && text.includes('the other into your hand')) {
    const entersTappedSplit = text.includes('battlefield tapped') || text.includes('enters tapped');
    return {
      isTutor: true,
      searchCriteria,
      destination: 'split',
      optional,
      maxSelections: 2,
      splitDestination: true,
      toBattlefield: 1,
      toHand: 1,
      entersTapped: entersTappedSplit,
    };
  }

  if (text.includes('put it on top of your library') ||
      text.includes('put that card on top of your library') ||
      text.includes('put them on top of your library') ||
      text.includes('put those cards on top of your library') ||
      text.includes('put it on top') ||
      text.includes('put that card on top') ||
      text.includes('put them on top') ||
      text.includes('put those cards on top')) {
    destination = 'top';
  } else if (text.includes('put it onto the battlefield') ||
           text.includes('put that card onto the battlefield') ||
           text.includes('put them onto the battlefield') ||
           text.includes('put those cards onto the battlefield') ||
           text.includes('put onto the battlefield') ||
           text.includes('enters the battlefield') ||
           text.includes('enters tapped')) {
    destination = 'battlefield';
    entersTapped = text.includes('battlefield tapped') || text.includes('enters tapped');
  } else if (text.includes('put it into your graveyard') ||
           text.includes('put that card into your graveyard') ||
           text.includes('put them into your graveyard') ||
           text.includes('put those cards into your graveyard') ||
           text.includes('put into your graveyard')) {
    destination = 'graveyard';
  } else if (text.includes('put it into your hand') ||
           text.includes('put that card into your hand') ||
           text.includes('put them into your hand') ||
           text.includes('put those cards into your hand') ||
           text.includes('add it to your hand') ||
           text.includes('add them to your hand')) {
    destination = 'hand';
  }

  return { isTutor: true, searchCriteria, destination, optional, maxSelections, entersTapped };
}

export function resolveCelestialReunionLibrarySearch(
  ctx: GameContext,
  controller: PlayerID,
  item: any,
  card: any,
  effectiveCard: any,
): void {
  const xValue = Math.max(0, Math.floor(Number(item?.xValue ?? card?.xValue ?? 0)));
  const beholdPaid = item?.additionalCostPaid === true || card?.additionalCostPaid === true;
  const chosenType = String(card?.chosenCreatureType || item?.chosenCreatureType || '').trim();

  enqueueLibrarySearchStep(ctx, controller, {
    description: `${effectiveCard.name}: Search your library for a creature card with mana value ${xValue} or less`,
    searchFor: `a creature card with mana value ${xValue} or less`,
    destination: 'hand',
    optional: false,
    source: effectiveCard.name || 'Celestial Reunion',
    shuffleAfter: true,
    filter: { types: ['creature'], maxCmc: xValue },
    maxSelections: 1,
    minSelections: 1,
    reveal: true,
    ...(beholdPaid && chosenType
      ? {
          chosenTypeBattlefieldIfPaid: {
            chosenType,
            additionalCostPaid: true,
          },
        }
      : {}),
  });
  debug(2, `[resolveTopOfStack] ${effectiveCard.name}: queued X=${xValue} creature search (beholdPaid=${beholdPaid}, chosenType=${chosenType || 'none'})`);
}

export function parseLibrarySearchFilter(criteria: string): {
  supertypes?: string[];
  types?: string[];
  subtypes?: string[];
  minCmc?: number;
  maxCmc?: number;
  minPower?: number;
  maxPower?: number;
  minToughness?: number;
  maxToughness?: number;
} {
  if (!criteria) return {};

  const result: {
    supertypes?: string[];
    types?: string[];
    subtypes?: string[];
    minCmc?: number;
    maxCmc?: number;
    minPower?: number;
    maxPower?: number;
    minToughness?: number;
    maxToughness?: number;
  } = {};
  const text = criteria.toLowerCase();

  const manaValueGreaterMatch = text.match(/(?:with\s+)?(?:mana (?:value|cost)|converted mana cost|cmc)\s+(\d+)\s+or\s+(?:greater|more)/);
  if (manaValueGreaterMatch) {
    result.minCmc = parseInt(manaValueGreaterMatch[1], 10);
  }

  const manaValueLessMatch = text.match(/(?:with\s+)?(?:mana (?:value|cost)|converted mana cost|cmc)\s+(\d+)\s+or\s+(?:less|fewer)/);
  if (manaValueLessMatch) {
    result.maxCmc = parseInt(manaValueLessMatch[1], 10);
  }

  const powerGreaterMatch = text.match(/power\s+(\d+)\s+or\s+(?:greater|more)/);
  if (powerGreaterMatch) {
    result.minPower = parseInt(powerGreaterMatch[1], 10);
  }

  const powerLessMatch = text.match(/power\s+(\d+)\s+or\s+(?:less|fewer)/);
  if (powerLessMatch) {
    result.maxPower = parseInt(powerLessMatch[1], 10);
  }

  const toughnessGreaterMatch = text.match(/toughness\s+(\d+)\s+or\s+(?:greater|more)/);
  if (toughnessGreaterMatch) {
    result.minToughness = parseInt(toughnessGreaterMatch[1], 10);
  }

  const toughnessLessMatch = text.match(/toughness\s+(\d+)\s+or\s+(?:less|fewer)/);
  if (toughnessLessMatch) {
    result.maxToughness = parseInt(toughnessLessMatch[1], 10);
  }

  const supertypes: string[] = [];
  if (text.includes('basic')) supertypes.push('basic');
  if (text.includes('legendary')) supertypes.push('legendary');
  if (text.includes('snow')) supertypes.push('snow');
  if (text.includes('world')) supertypes.push('world');
  if (text.includes('ongoing')) supertypes.push('ongoing');
  if (text.includes('host')) supertypes.push('host');
  if (supertypes.length > 0) {
    result.supertypes = supertypes;
  }

  const types: string[] = [];
  if (text.includes('creature')) types.push('creature');
  if (text.includes('instant')) types.push('instant');
  if (text.includes('sorcery')) types.push('sorcery');
  if (text.includes('artifact')) types.push('artifact');
  if (text.includes('enchantment')) types.push('enchantment');
  if (text.includes('planeswalker')) types.push('planeswalker');
  if (text.includes('land')) types.push('land');
  if (text.includes('tribal') || text.includes('kindred')) types.push('tribal');
  if (text.includes('battle')) types.push('battle');
  if (types.length > 0) {
    result.types = types;
  }

  const subtypes: string[] = [];
  if (text.includes('forest')) subtypes.push('forest');
  if (text.includes('plains')) subtypes.push('plains');
  if (text.includes('island')) subtypes.push('island');
  if (text.includes('swamp')) subtypes.push('swamp');
  if (text.includes('mountain')) subtypes.push('mountain');
  if (text.includes('equipment')) subtypes.push('equipment');
  if (text.includes('aura')) subtypes.push('aura');
  if (text.includes('vehicle')) subtypes.push('vehicle');
  if (subtypes.length > 0) {
    result.subtypes = subtypes;
  }

  return result;
}
