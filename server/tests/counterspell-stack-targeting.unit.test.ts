import { describe, expect, it } from 'vitest';

import { buildSpellTargetListFromRequirements } from '../src/socket/game-actions.js';
import { parseTargetRequirements } from '../src/rules-engine/targeting.js';

describe('Fierce Guardianship / counterspell stack targeting', () => {
  it('parses target noncreature spell as a stack requirement, not a battlefield permanent', () => {
    const reqs = parseTargetRequirements(
      'If you control a commander, you may cast this spell without paying its mana cost.\nCounter target noncreature spell.',
    );

    expect(reqs.needsTargets).toBe(true);
    expect(reqs.targetTypes).toEqual(['noncreature spell']);
    expect(reqs.targetDescription).toContain('noncreature spell');
  });

  it('offers only noncreature spells on the stack (not battlefield permanents)', () => {
    const game = {
      state: {
        players: [
          { id: 'p1', name: 'P1', life: 40 },
          { id: 'p2', name: 'P2', life: 40 },
        ],
        battlefield: [
          {
            id: 'bf_swamp',
            controller: 'p2',
            card: { name: 'Swamp', type_line: 'Basic Land — Swamp' },
          },
          {
            id: 'bf_aura_shards',
            controller: 'p1',
            card: { name: 'Aura Shards', type_line: 'Enchantment' },
          },
          {
            id: 'bf_sol_ring',
            controller: 'p2',
            card: { name: 'Sol Ring', type_line: 'Artifact' },
          },
        ],
        stack: [
          {
            id: 'stack_creature',
            type: 'spell',
            controller: 'p2',
            card: {
              name: 'Llanowar Elves',
              type_line: 'Creature — Elf Druid',
              image_uris: { small: 'https://example.test/elves.jpg' },
            },
          },
          {
            id: 'stack_noncreature',
            type: 'spell',
            controller: 'p2',
            card: {
              name: 'Demonic Tutor',
              type_line: 'Sorcery',
              image_uris: { small: 'https://example.test/tutor.jpg' },
            },
          },
          {
            id: 'stack_trigger',
            type: 'triggered_ability',
            controller: 'p2',
            sourceName: 'Aura Shards',
            description: 'Destroy target artifact or enchantment',
          },
        ],
      },
    };

    const reqs = parseTargetRequirements('Counter target noncreature spell.');
    const targets = buildSpellTargetListFromRequirements(game, 'p1', reqs);

    expect(targets.map((t) => t.id)).toEqual(['stack_noncreature']);
    expect(targets[0]?.kind).toBe('stack');
    expect(targets[0]?.name).toBe('Demonic Tutor');
    expect(targets.every((t) => t.kind === 'stack')).toBe(true);
  });

  it('offers any spell on the stack for Counter target spell', () => {
    const game = {
      state: {
        players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
        battlefield: [
          { id: 'bf_1', controller: 'p2', card: { name: 'Forest', type_line: 'Basic Land — Forest' } },
        ],
        stack: [
          {
            id: 'stack_bolt',
            type: 'spell',
            controller: 'p2',
            card: { name: 'Lightning Bolt', type_line: 'Instant' },
          },
          {
            id: 'stack_bear',
            type: 'spell',
            controller: 'p2',
            card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          },
        ],
      },
    };

    const reqs = parseTargetRequirements('Counter target spell.');
    const targets = buildSpellTargetListFromRequirements(game, 'p1', reqs);

    expect(targets.map((t) => t.id).sort()).toEqual(['stack_bear', 'stack_bolt']);
    expect(targets.every((t) => t.kind === 'stack')).toBe(true);
  });
});
