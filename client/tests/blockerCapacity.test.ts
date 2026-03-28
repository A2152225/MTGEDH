import { describe, expect, it } from 'vitest';
import { getBlockerCapacity } from '../src/utils/blockerCapacity';

describe('getBlockerCapacity', () => {
  it('stacks multiple singular additional-creature grants', () => {
    const blocker = {
      id: 'blocker-1',
      controller: 'player1',
      owner: 'player1',
      card: {
        id: 'card-1',
        name: 'Resolute Guardian',
        type_line: 'Creature — Human Soldier',
        oracle_text: 'Resolute Guardian can block an additional creature each combat.',
      },
      grantedAbilities: ['Resolute Guardian can block an additional creature this turn.'],
    } as any;

    expect(getBlockerCapacity(blocker)).toBe(3);
  });

  it('reads temporary effect descriptions that raise blocker capacity', () => {
    const blocker = {
      id: 'blocker-2',
      controller: 'player1',
      owner: 'player1',
      card: {
        id: 'card-2',
        name: 'Shield Bearer',
        type_line: 'Creature — Human Soldier',
        oracle_text: '',
      },
      temporaryEffects: [
        { description: 'Shield Bearer can block an additional two creatures this turn.' },
      ],
    } as any;

    expect(getBlockerCapacity(blocker)).toBe(3);
  });
});