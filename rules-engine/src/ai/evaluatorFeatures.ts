/**
 * Board evaluator features from a seat-scoped Observation.
 *
 * Origin: AI_Upgrade Phase 1 (P1-1). Pure public-info features for seatValues /
 * winProbabilities / position logging. permanentValue mirrors evaluatePermanentValue.
 *
 * Public entry symbols: FEATURE_NAMES, FeatureName, SeatFeatures, EvalWeights,
 * FEATURE_SCALE, permanentValue, seatFeatures.
 */

import type { PlayerID } from '../../../shared/src/types.js';
import type { Observation, PermanentView } from './observation.js';

export const FEATURE_NAMES = [
  'life',
  'commanderDamageTaken',
  'boardValue',
  'otherPermanents',
  'manaSources',
  'handSize',
  'commanderInPlay',
  'loyalty',
  'attackPower',
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type SeatFeatures = Record<FeatureName, number>;
export type EvalWeights = Record<FeatureName, number>;

/** Typical mid-game raw value lands near 0..1 after dividing by these scales. */
export const FEATURE_SCALE: Record<FeatureName, number> = {
  life: 40,
  commanderDamageTaken: 21,
  boardValue: 60,
  otherPermanents: 30,
  manaSources: 10,
  handSize: 7,
  commanderInPlay: 1,
  loyalty: 10,
  attackPower: 20,
};

/**
 * Line-for-line mirror of evaluatePermanentValue (aiEngineValueSupport.ts)
 * reading PermanentView fields instead of BattlefieldPermanent.
 */
export function permanentValue(p: PermanentView): number {
  const type = (p.typeLine || '').toLowerCase();
  const text = (p.oracleText || '').toLowerCase();
  const k = p.keywords;
  let v = 0;

  if (p.types.includes('creature')) {
    v += (p.power + p.toughness) * 2;
    if (k.flying) v += 3;
    if (k.deathtouch) v += 4;
    if (k.lifelink) v += 3;
    if (k.trample) v += 2;
    if (k.indestructible) v += 10;
    if (k.doubleStrike) v += 5;

    if (text.includes('when') && text.includes('enters the battlefield')) {
      if (text.includes('draw')) v += 3;
      if (text.includes('search')) v += 3;
      if (text.includes('create')) v += 2;
      if (text.includes('return') && text.includes('from your graveyard')) v += 3;
    }
  }

  if (type.includes('artifact')) {
    v += 3;
    if (text.includes('add') && text.includes('mana')) v += 4;
  }

  if (type.includes('enchantment')) v += 4;

  if (type.includes('land')) {
    v += type.includes('basic') ? 1 : 3;
  }

  if (p.isToken) v -= 2;
  v += (p.counters?.['+1/+1'] || 0) * 2;

  return Math.max(0, v);
}

function scaleFeatures(raw: Record<FeatureName, number>): SeatFeatures {
  const out = {} as SeatFeatures;
  for (const name of FEATURE_NAMES) {
    const denom = FEATURE_SCALE[name];
    out[name] = denom === 0 ? 0 : raw[name] / denom;
  }
  return out;
}

export function seatFeatures(obs: Observation): Record<PlayerID, SeatFeatures> {
  const seats: Array<{
    id: PlayerID;
    life: number;
    hand: number;
    bf: PermanentView[];
  }> = [
    {
      id: obs.seat,
      life: obs.self.life,
      hand: obs.self.hand.length,
      bf: obs.self.battlefield,
    },
    ...obs.opponents.map((o) => ({
      id: o.id,
      life: o.life,
      hand: o.handSize,
      bf: o.battlefield,
    })),
  ];

  const out: Record<PlayerID, SeatFeatures> = {};
  for (const s of seats) {
    let board = 0;
    let other = 0;
    let mana = 0;
    let loyalty = 0;
    let attack = 0;
    let cmdr = 0;

    for (const p of s.bf) {
      const creature = p.types.includes('creature');
      const land = p.types.includes('land');
      if (creature) board += permanentValue(p);
      else if (!land) other += permanentValue(p);
      if (p.producesMana) mana += 1;
      if (p.types.includes('planeswalker')) loyalty += p.loyalty ?? 0;
      if (p.isCommander) cmdr = 1;
      if (
        creature
        && !p.tapped
        && !p.keywords.defender
        && (!p.summoningSick || p.keywords.haste)
      ) {
        attack += p.power;
      }
    }

    let worstCommander = 0;
    const dmg = obs.commanderDamage[s.id] ?? {};
    for (const d of Object.values(dmg)) {
      if (typeof d === 'number' && d > worstCommander) worstCommander = d;
    }

    out[s.id] = scaleFeatures({
      life: s.life,
      commanderDamageTaken: worstCommander,
      boardValue: board,
      otherPermanents: other,
      manaSources: mana,
      handSize: s.hand,
      commanderInPlay: cmdr,
      loyalty,
      attackPower: attack,
    });
  }
  return out;
}
