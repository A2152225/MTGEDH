/**
 * Shared CombatCreature builders for P2-1…P2-3 tests.
 */

import type { CombatCreature, CombatKeywords } from '../../src/combatAutomation.js';

export const EMPTY_KW: CombatKeywords = {
  flying: false,
  reach: false,
  firstStrike: false,
  doubleStrike: false,
  deathtouch: false,
  trample: false,
  lifelink: false,
  menace: false,
  vigilance: false,
  haste: false,
  indestructible: false,
  defender: false,
  shadow: false,
  horsemanship: false,
  skulk: false,
  fear: false,
  intimidate: false,
  protectionColors: [],
  protectionTypes: [],
};

export function creature(
  id: string,
  power: number,
  toughness: number,
  kw: Partial<CombatKeywords> = {},
  opts: {
    controllerId?: string;
    oracle?: string;
    isCommander?: boolean;
    cardId?: string;
    damage?: number;
    tapped?: boolean;
  } = {},
): CombatCreature {
  const keywords: CombatKeywords = { ...EMPTY_KW, ...kw };
  if (keywords.doubleStrike) {
    (keywords as { firstStrike: boolean }).firstStrike = false;
  }
  return {
    id,
    name: id,
    controllerId: opts.controllerId || 'p_atk',
    power,
    toughness,
    damage: opts.damage || 0,
    keywords,
    permanent: {
      id,
      controller: opts.controllerId || 'p_atk',
      owner: opts.controllerId || 'p_atk',
      tapped: Boolean(opts.tapped),
      summoningSickness: false,
      counters: opts.damage ? { damage: opts.damage } : {},
      isCommander: opts.isCommander || false,
      card: {
        id: opts.cardId || `c_${id}`,
        name: id,
        type_line: 'Creature',
        oracle_text: opts.oracle || '',
        power: String(power),
        toughness: String(toughness),
      },
    } as any,
  };
}
