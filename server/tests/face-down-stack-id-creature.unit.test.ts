import { expect, it } from 'vitest';
import { isCurrentlyCreature } from '../src/socket/combat-handlers/combatLegalityGates';

it('a nameless face-down stack_ permanent is still a creature', () => {
  const perm: any = {
    id: 'stack_3gy9zr1p',
    controller: 'p1',
    effectiveTypes: ['Creature'],
    card: { id: 'card-bears', faceDown: true, power: '2', toughness: '2' },
  };
  expect(isCurrentlyCreature(perm, [perm], 'p1')).toBe(true);
});

it('a nameless non-face-down stack_ object is not a creature', () => {
  const perm: any = {
    id: 'stack_h54reblx',
    controller: 'p1',
    card: { id: 'stack_h54reblx' },
  };
  expect(isCurrentlyCreature(perm, [perm], 'p1')).toBe(false);
});
