import { describe, expect, it } from 'vitest';
import { grantedSaddleFor } from './grantedMountSaddle';
import { parseActivatedAbilities } from './activatedAbilityParser';

const jandorText = 'Each Beast, Camel, Horse, Elephant, and Wolf creature you control is a Mount in addition to its other types and has saddle 2.';

describe('type-granted Mount saddle (Jandor)', () => {
  const jandor: any = {
    id: 'j1',
    controller: 'p1',
    card: { id: 'j1', name: 'Jandor, Fortuned Traveler', type_line: 'Legendary Creature — Human Soldier', oracle_text: jandorText },
  };
  const wolf: any = {
    id: 'w1',
    controller: 'p1',
    card: { id: 'w1', name: 'Gray Wolf', type_line: 'Creature — Wolf', oracle_text: 'Vigilance' },
  };

  it('prefers rulesStatus.grantedSaddle', () => {
    expect(grantedSaddleFor({ ...wolf, rulesStatus: { grantedSaddle: { value: 3, sourceName: 'Override' } } }, [])).toEqual({
      value: 3,
      sourceName: 'Override',
    });
  });

  it('scans the battlefield for a Jandor-style type-and-saddle grant', () => {
    expect(grantedSaddleFor(wolf, [jandor, wolf])).toEqual({ value: 2, sourceName: 'Jandor, Fortuned Traveler' });
    expect(grantedSaddleFor({ ...wolf, controller: 'p2' }, [jandor, wolf])).toBeNull();
  });

  it('adds a visible Saddle N activation wired like Crew', () => {
    const abilities = parseActivatedAbilities(wolf.card, undefined, { battlefield: [jandor, wolf], permanent: wolf });
    const saddle = abilities.find((ability: any) => ability.isSaddleAbility);
    expect(saddle).toBeTruthy();
    expect(saddle?.label).toBe('Saddle 2 (from Jandor, Fortuned Traveler)');
    expect(saddle?.saddlePower).toBe(2);
    expect(String(saddle?.id || '')).toMatch(/-saddle-/);
    expect(parseActivatedAbilities(wolf.card, undefined, { battlefield: [wolf], permanent: wolf }).some((ability: any) => ability.isSaddleAbility)).toBe(false);
  });
});
