/**
 * Job Select keyword ability (Rule 702.182)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.182. Job Select
 * 702.182a Job select is a triggered ability. "Job select" means "When this Equipment enters, 
 * create a 1/1 colorless Hero creature token, then attach this Equipment to it."
 */

import type { BattlefieldPermanent, PlayerID } from '../../../shared/src';

export interface JobSelectAbility {
  readonly type: 'job-select';
  readonly source: string;
  readonly hasTriggered: boolean;
  readonly heroTokenId?: string;
}

export interface JobSelectSummary {
  readonly source: string;
  readonly hasTriggered: boolean;
  readonly heroTokenId?: string;
}

export const JOB_SELECT_HERO_TOKEN = {
  name: 'Hero',
  colors: [] as string[],
  power: 1,
  toughness: 1,
  typeLine: 'Token Creature — Hero',
};

/**
 * Create a job select ability
 * Rule 702.182a
 * @param source - The Equipment with job select
 * @returns Job select ability object
 */
export function jobSelect(source: string): JobSelectAbility {
  return {
    type: 'job-select',
    source,
    hasTriggered: false,
  };
}

/**
 * Trigger job select when Equipment enters
 * Rule 702.182a - Create Hero token, attach to it
 * @param ability - Job select ability
 * @param heroTokenId - ID of created Hero token
 * @returns Updated ability
 */
export function triggerJobSelect(ability: JobSelectAbility, heroTokenId: string): JobSelectAbility {
  return {
    ...ability,
    hasTriggered: true,
    heroTokenId,
  };
}

/**
 * Get Hero token
 * @param ability - Job select ability
 * @returns Hero token ID or undefined
 */
export function getHeroToken(ability: JobSelectAbility): string | undefined {
  return ability.heroTokenId;
}

/**
 * Create the Hero token used by Job select.
 * Rule 702.182a
 */
export function createJobSelectHeroToken(tokenId: string, controllerId: PlayerID): BattlefieldPermanent {
  return {
    id: tokenId,
    controller: controllerId,
    owner: controllerId,
    tapped: false,
    summoningSickness: true,
    counters: {},
    attachments: [],
    modifiers: [],
    card: {
      id: tokenId,
      name: JOB_SELECT_HERO_TOKEN.name,
      type_line: JOB_SELECT_HERO_TOKEN.typeLine,
      oracle_text: '',
      colors: JOB_SELECT_HERO_TOKEN.colors,
      mana_cost: '',
      cmc: 0,
    } as any,
    basePower: JOB_SELECT_HERO_TOKEN.power,
    baseToughness: JOB_SELECT_HERO_TOKEN.toughness,
    isToken: true,
  } as BattlefieldPermanent;
}

/**
 * Multiple instances of job select are not redundant
 * @param abilities - Array of job select abilities
 * @returns False
 */
export function hasRedundantJobSelect(abilities: readonly JobSelectAbility[]): boolean {
  return false;
}

export function createJobSelectSummary(ability: JobSelectAbility): JobSelectSummary {
  return {
    source: ability.source,
    hasTriggered: ability.hasTriggered,
    heroTokenId: ability.heroTokenId,
  };
}
