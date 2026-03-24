import type { PlayerID } from '../../shared/src';

/**
 * Static ability effect types
 */
export enum StaticEffectType {
  PUMP = 'pump',
  SET_PT = 'set_pt',
  PUMP_PER_CREATURE = 'pump_per_creature',
  GRANT_ABILITY = 'grant_ability',
  REMOVE_ABILITY = 'remove_ability',
  ADD_TYPE = 'add_type',
  REMOVE_TYPE = 'remove_type',
  ADD_LAND_TYPE = 'add_land_type',
  ADD_COLOR = 'add_color',
  REMOVE_COLOR = 'remove_color',
  COST_REDUCTION = 'cost_reduction',
  COST_INCREASE = 'cost_increase',
  CANT_ATTACK = 'cant_attack',
  CANT_BLOCK = 'cant_block',
  HEXPROOF = 'hexproof',
  SHROUD = 'shroud',
  PROTECTION = 'protection',
  IGNORE_HEXPROOF = 'ignore_hexproof',
  IGNORE_SHROUD = 'ignore_shroud',
  UNBLOCKABLE = 'unblockable',
}

/**
 * Target filter for static abilities
 */
export interface StaticEffectFilter {
  controller?: 'you' | 'opponents' | 'any';
  types?: string[];
  cardTypes?: string[];
  landTypes?: string[];
  colors?: string[];
  other?: boolean;
  selfOnly?: boolean;
  name?: string;
  hasAbility?: string;
  preventGaining?: boolean;
}

/**
 * Static ability definition
 */
export interface StaticAbility {
  id: string;
  sourceId: string;
  sourceName: string;
  controllerId: PlayerID;
  effectType: StaticEffectType;
  filter: StaticEffectFilter;
  value?: number | string | string[];
  powerMod?: number;
  toughnessMod?: number;
  layer: number;
  countFilter?: {
    types?: string[];
    other?: boolean;
    controller?: 'you' | 'opponents' | 'any';
  };
}
