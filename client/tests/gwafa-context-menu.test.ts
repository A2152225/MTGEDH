import { describe, expect, it } from 'vitest';

import type { BattlefieldPermanent, KnownCardRef } from '../../shared/src';
import { getActivatedAbilityActivationStatus, parseActivatedAbilities } from '../src/utils/activatedAbilityParser';
import { getBattlefieldTapActionDecision } from '../src/utils/battlefieldTapAction';

const GWafa_CARD: KnownCardRef = {
  id: 'gwafa-card-1',
  name: 'Gwafa Hazid, Profiteer',
  type_line: 'Legendary Creature — Human Rogue',
  colors: ['W', 'U'],
  oracle_text:
    "{W}{U}, {T}: Put a bribery counter on target creature you don't control. Its controller draws a card.\nCreatures with bribery counters on them can't attack or block.",
};

function buildPermanent(overrides: Partial<BattlefieldPermanent> = {}): BattlefieldPermanent {
  return {
    id: 'gwafa-perm-1',
    controller: 'player1',
    owner: 'player1',
    tapped: false,
    card: GWafa_CARD,
    ...overrides,
  };
}

describe('Gwafa context menu activation state', () => {
  it('parses a single non-mana tap activated ability', () => {
    const abilities = parseActivatedAbilities(GWafa_CARD);
    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.isManaAbility).toBe(false);
    expect(abilities[0]?.requiresTap).toBe(true);
  });

  it('reports no priority when the controller cannot activate non-mana abilities', () => {
    const abilities = parseActivatedAbilities(GWafa_CARD);
    const permanent = buildPermanent({ summoningSickness: false });
    const status = getActivatedAbilityActivationStatus(abilities[0]!, permanent, {
      isTapped: false,
      hasSummoningSickness: false,
      hasHaste: false,
      hasThousandYearElixirEffect: false,
      controllerHasPriority: false,
      isMainPhase: true,
      isOwnTurn: true,
      stackEmpty: true,
    }, [permanent]);
    expect(status).toEqual({ canActivate: false, reason: 'No priority' });
  });

  it('routes tap through activate when summoning sickness is cleared', () => {
    const permanent = buildPermanent({ summoningSickness: false });
    const decision = getBattlefieldTapActionDecision(permanent, [permanent], {
      hasThousandYearElixirEffect: false,
      controllerHasPriority: true,
      isMainPhase: true,
      isOwnTurn: true,
      stackEmpty: true,
    });
    expect(decision).toEqual({
      kind: 'activate',
      ability: expect.objectContaining({ id: 'gwafa-card-1-ability-0' }),
    });
  });

  it('disables generic tap when summoning sickness blocks the activated ability', () => {
    const permanent = buildPermanent({ summoningSickness: true });
    const decision = getBattlefieldTapActionDecision(permanent, [permanent], {
      hasThousandYearElixirEffect: false,
      controllerHasPriority: true,
      isMainPhase: true,
      isOwnTurn: true,
      stackEmpty: true,
    });
    expect(decision).toEqual({
      kind: 'disabled',
      reason: 'Summoning sickness',
    });
  });

  it('disables generic tap when controller lacks priority', () => {
    const permanent = buildPermanent({ summoningSickness: false });
    const decision = getBattlefieldTapActionDecision(permanent, [permanent], {
      hasThousandYearElixirEffect: false,
      controllerHasPriority: false,
      isMainPhase: true,
      isOwnTurn: true,
      stackEmpty: true,
    });
    expect(decision).toEqual({
      kind: 'disabled',
      reason: 'No priority',
    });
  });
});
