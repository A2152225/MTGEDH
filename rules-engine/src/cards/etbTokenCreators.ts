/**
 * cards/etbTokenCreators.ts
 * 
 * Cards that create tokens when entering the battlefield.
 */

import type { TokenCharacteristics } from '../tokenCreation';

export interface ETBTokenConfig {
  readonly cardName: string;
  readonly tokenType: string;
  readonly tokenCount: number | 'X';
  readonly customToken?: TokenCharacteristics;
  readonly buffEffect?: { power: number; toughness: number; types: string[] };
  readonly vanishingCounters?: number;
}

export const ETB_TOKEN_CREATORS: Record<string, ETBTokenConfig> = {
  'deranged hermit': {
    cardName: 'Deranged Hermit',
    tokenType: '1/1 Squirrel',
    tokenCount: 4,
    buffEffect: { power: 1, toughness: 1, types: ['Squirrel'] },
  },
  'drey keeper': {
    cardName: 'Drey Keeper',
    tokenType: '1/1 Squirrel',
    tokenCount: 2,
  },
  'skullport merchant': {
    cardName: 'Skullport Merchant',
    tokenType: 'Treasure',
    tokenCount: 1,
  },
  'deep forest hermit': {
    cardName: 'Deep Forest Hermit',
    tokenType: '1/1 Squirrel',
    tokenCount: 4,
    buffEffect: { power: 1, toughness: 1, types: ['Squirrel'] },
    vanishingCounters: 3,
  },
  'avenger of zendikar': {
    cardName: 'Avenger of Zendikar',
    tokenType: '0/1 Plant',
    tokenCount: 'X',
  },
  'hornet queen': {
    cardName: 'Hornet Queen',
    tokenType: '1/1 Insect',
    tokenCount: 4,
    customToken: {
      name: 'Insect',
      colors: ['G'],
      types: ['Creature'],
      subtypes: ['Insect'],
      power: 1,
      toughness: 1,
      abilities: ['Flying', 'Deathtouch'],
    },
  },
  'siege-gang commander': {
    cardName: 'Siege-Gang Commander',
    tokenType: '1/1 Goblin',
    tokenCount: 3,
  },
};

export function isETBTokenCreator(cardName: string): boolean {
  return cardName.toLowerCase() in ETB_TOKEN_CREATORS;
}

export function getETBTokenConfig(cardName: string): ETBTokenConfig | undefined {
  return ETB_TOKEN_CREATORS[cardName.toLowerCase()];
}
