import { describe, expect, it } from 'vitest';

import type { BattlefieldPermanent, KnownCardRef } from '../../shared/src';
import { getBattlefieldTapActionDecision } from '../src/utils/battlefieldTapAction';

function buildPermanent(card: KnownCardRef, overrides: Partial<BattlefieldPermanent> = {}): BattlefieldPermanent {
  return {
    id: `${card.id}-perm`,
    controller: 'player1',
    owner: 'player1',
    tapped: false,
    card,
    ...overrides,
  };
}

describe('getBattlefieldTapActionDecision', () => {
  const defaultContext = {
    hasThousandYearElixirEffect: false,
    controllerHasPriority: true,
    isMainPhase: true,
    isOwnTurn: true,
    stackEmpty: true,
  } as const;

  it('returns tap for permanents without tap mana abilities', () => {
    const permanent = buildPermanent({
      id: 'bear-card-1',
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    });

    expect(getBattlefieldTapActionDecision(permanent, [permanent], defaultContext)).toEqual({ kind: 'tap' });
  });

  it('routes simple tap mana sources through activateBattlefieldAbility', () => {
    const permanent = buildPermanent({
      id: 'forest-card-1',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
    });

    const decision = getBattlefieldTapActionDecision(permanent, [permanent], defaultContext);
    expect(decision.kind).toBe('activate');
    if (decision.kind !== 'activate') {
      throw new Error('expected activate decision');
    }
    expect(decision.ability.id).toBe('forest-card-1-ability-0');
  });

  it('disables generic tap when multiple tap mana abilities exist', () => {
    const permanent = buildPermanent({
      id: 'wastes-card-1',
      name: 'Adarkar Wastes',
      type_line: 'Land',
      oracle_text: '{T}: Add {C}.\n{T}: Add {W} or {U}. Adarkar Wastes deals 1 damage to you.',
    });

    expect(getBattlefieldTapActionDecision(permanent, [permanent], defaultContext)).toEqual({
      kind: 'disabled',
      reason: 'Multiple tap mana abilities; choose one below.',
    });
  });

  it('surfaces disabled tap mana requirements instead of falling back to bare tap', () => {
    const card: KnownCardRef = {
      id: 'mox-amber-card-1',
      name: 'Mox Amber',
      type_line: 'Legendary Artifact',
      oracle_text: '{T}: Add one mana of any color among legendary creatures and planeswalkers you control.',
    };
    const permanent = buildPermanent(card);

    expect(getBattlefieldTapActionDecision(permanent, [permanent], defaultContext)).toEqual({
      kind: 'disabled',
      reason: 'Needs a colored legendary creature or planeswalker',
    });
  });

  it('routes conditional tap mana abilities when battlefield context satisfies them', () => {
    const card: KnownCardRef = {
      id: 'mox-amber-card-1',
      name: 'Mox Amber',
      type_line: 'Legendary Artifact',
      oracle_text: '{T}: Add one mana of any color among legendary creatures and planeswalkers you control.',
    };
    const permanent = buildPermanent(card);
    const legend = buildPermanent({
      id: 'legend-card-1',
      name: 'Jhoira, Weatherlight Captain',
      type_line: 'Legendary Creature — Human Artificer',
      oracle_text: '',
      colors: ['U', 'R'],
    }, {
      id: 'legend-perm-1',
    });

    const decision = getBattlefieldTapActionDecision(permanent, [permanent, legend], defaultContext);
    expect(decision.kind).toBe('activate');
    if (decision.kind !== 'activate') {
      throw new Error('expected activate decision');
    }
    expect(decision.ability.id).toBe('mox-amber-card-1-ability-0');
  });
});