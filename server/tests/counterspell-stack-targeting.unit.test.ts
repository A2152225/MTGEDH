import { describe, expect, it } from 'vitest';

import { buildSpellTargetListFromRequirements } from '../src/socket/game-actions.js';
import { hasValidTargetsForSpell } from '../src/rules-engine/target-availability.js';
import { evaluateTargeting, parseTargetRequirements } from '../src/rules-engine/targeting.js';
import type { SpellSpec } from '../src/rules-engine/targeting-handlers/targetingSpellSpecTypes.js';
import { inferStackTargetLocations, shouldFizzleStackSpellForMissingTargets } from '../src/state/modules/stackTargetLegalityUtils.js';

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

describe('Bolt Bend / change-target stack legality', () => {
  const boltBendOracle =
    'This spell costs {3} less to cast if you control a creature with power 4 or greater.\n' +
    'Change the target of target spell or ability with a single target.';

  it('parses Bolt Bend as a single-target spell or ability on the stack', () => {
    const reqs = parseTargetRequirements(boltBendOracle);
    expect(reqs.needsTargets).toBe(true);
    expect(reqs.targetTypes).toEqual(['spell', 'ability']);
    expect(reqs.stackObjectMustHaveSingleTarget).toBe(true);
  });

  it('does not offer an untargeted creature spell such as Myrel as a Bolt Bend target', () => {
    const game = {
      state: {
        players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
        battlefield: [],
        stack: [
          {
            id: 'stack_myrel',
            type: 'spell',
            controller: 'p2',
            card: {
              name: 'Myrel, Shield of Argive',
              type_line: 'Legendary Creature — Human Soldier',
            },
            targets: [],
          },
          {
            id: 'stack_bolt',
            type: 'spell',
            controller: 'p2',
            card: { name: 'Lightning Bolt', type_line: 'Instant' },
            targets: [{ id: 'p1', type: 'player' }],
          },
        ],
      },
    };

    const reqs = parseTargetRequirements(boltBendOracle);
    const targets = buildSpellTargetListFromRequirements(game, 'p1', reqs);
    expect(targets.map((t) => t.id)).toEqual(['stack_bolt']);

    const boltBend = {
      name: 'Bolt Bend',
      type_line: 'Instant',
      oracle_text: boltBendOracle,
    };
    expect(hasValidTargetsForSpell(game.state, 'p1', boltBend, { conservative: false })).toBe(true);

    const myrelOnly = {
      ...game,
      state: {
        ...game.state,
        stack: [game.state.stack[0]],
      },
    };
    expect(buildSpellTargetListFromRequirements(myrelOnly, 'p1', reqs)).toEqual([]);
    expect(hasValidTargetsForSpell(myrelOnly.state, 'p1', boltBend, { conservative: false })).toBe(false);
  });

  it('offers Aura Shards as a Bolt Bend target while its single target is still unchosen', () => {
    const game = {
      state: {
        players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
        battlefield: [
          {
            id: 'bf_sol_ring',
            controller: 'p2',
            card: { name: 'Sol Ring', type_line: 'Artifact' },
          },
        ],
        stack: [
          {
            id: 'stack_aura_shards',
            type: 'triggered_ability',
            controller: 'p2',
            sourceName: 'Aura Shards',
            description: 'you may destroy target artifact or enchantment.',
            effect: 'you may destroy target artifact or enchantment.',
            triggerType: 'creature_etb',
            needsTargetSelection: true,
            card: {
              name: 'Aura Shards',
              type_line: 'Enchantment',
              oracle_text:
                'Whenever a creature you control enters, you may destroy target artifact or enchantment.',
            },
          },
        ],
      },
    };

    const reqs = parseTargetRequirements(boltBendOracle);
    const targets = buildSpellTargetListFromRequirements(game, 'p1', reqs);
    expect(targets.map((t) => t.id)).toEqual(['stack_aura_shards']);
    expect(targets[0]?.kind).toBe('stack');

    const boltBend = {
      name: 'Bolt Bend',
      type_line: 'Instant',
      oracle_text: boltBendOracle,
    };
    expect(hasValidTargetsForSpell(game.state, 'p1', boltBend, { conservative: false })).toBe(true);
  });
});

describe('COUNTER_TARGET_SPELL may target the caster\'s own stack spell', () => {
  const counterAny: SpellSpec = {
    op: 'COUNTER_TARGET_SPELL',
    filter: 'ANY',
    minTargets: 1,
    maxTargets: 1,
  };
  const counterspell = {
    name: 'Counterspell',
    type_line: 'Instant',
    oracle_text: 'Counter target spell.',
  };

  function ownSpellState() {
    return {
      players: [
        { id: 'p1', name: 'P1' },
        { id: 'p2', name: 'P2' },
      ],
      battlefield: [],
      stack: [
        {
          id: 'stack_own',
          type: 'spell',
          controller: 'p1',
          card: { name: 'Lightning Bolt', type_line: 'Instant' },
        },
      ],
    };
  }

  it('evaluateTargeting includes the caster’s spell on the stack', () => {
    const state = ownSpellState();
    const targets = evaluateTargeting(state as any, 'p1', counterAny);
    expect(targets.map((t) => t.id)).toEqual(['stack_own']);
    expect(targets[0]?.kind).toBe('stack');
  });

  it('hasValidTargetsForSpell is true when only the caster’s spell is on the stack', () => {
    const state = ownSpellState();
    expect(hasValidTargetsForSpell(state, 'p1', counterspell, { conservative: false })).toBe(true);
  });

  it('still skips abilities and uncounterable stack items', () => {
    const state = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [],
      stack: [
        {
          id: 'stack_trigger',
          type: 'triggered_ability',
          controller: 'p2',
          card: { name: 'Aura Shards', type_line: 'Enchantment' },
        },
        {
          id: 'stack_uncounterable',
          type: 'spell',
          controller: 'p2',
          canBeCountered: false,
          card: { name: 'Force of Will', type_line: 'Instant' },
        },
      ],
    };
    expect(evaluateTargeting(state as any, 'p1', counterAny)).toEqual([]);
    expect(hasValidTargetsForSpell(state, 'p1', counterspell, { conservative: false })).toBe(false);
  });
});

describe('Mindbreak Trap stack targeting', () => {
  const mindbreakOracle =
    "If an opponent cast three or more spells this turn, you may pay {0} rather than pay this spell's mana cost.\nExile any number of target spells.";

  it('parses any number of target spells as optional stack spells', () => {
    const reqs = parseTargetRequirements(mindbreakOracle);
    expect(reqs.needsTargets).toBe(true);
    expect(reqs.targetTypes).toEqual(['spell']);
    expect(reqs.minTargets).toBe(0);
    expect(reqs.stackTargetsIgnoreCantBeCountered).toBe(true);
    expect(inferStackTargetLocations(mindbreakOracle).has('stack')).toBe(true);
    expect(inferStackTargetLocations(mindbreakOracle).has('battlefield')).toBe(false);
  });

  it('offers uncounterable stack spells as legal exile targets', () => {
    const game = {
      state: {
        players: [
          { id: 'p1', name: 'P1', life: 40 },
          { id: 'p2', name: 'P2', life: 40 },
        ],
        battlefield: [],
        stack: [
          {
            id: 'stack_uncounterable',
            type: 'spell',
            controller: 'p2',
            canBeCountered: false,
            card: { name: 'Force of Will', type_line: 'Instant' },
          },
          {
            id: 'stack_warp',
            type: 'spell',
            controller: 'p2',
            card: { name: 'Warp World', type_line: 'Sorcery' },
          },
          {
            id: 'stack_trigger',
            type: 'triggered_ability',
            controller: 'p2',
            sourceName: 'Hive Mind',
          },
        ],
      },
    };

    const reqs = parseTargetRequirements(mindbreakOracle);
    const targets = buildSpellTargetListFromRequirements(game, 'p1', reqs);
    expect(targets.map((t) => t.id).sort()).toEqual(['stack_uncounterable', 'stack_warp']);
    expect(targets.every((t) => t.kind === 'stack')).toBe(true);
  });

  it('does not fizzle on resolve when chosen stack spells are still there', () => {
    const state = {
      players: [
        { id: 'p1', name: 'P1', life: 40 },
        { id: 'p2', name: 'P2', life: 40 },
      ],
      battlefield: [],
      stack: [
        {
          id: 'stack_uncounterable',
          type: 'spell',
          controller: 'p2',
          canBeCountered: false,
          card: { name: 'Force of Will', type_line: 'Instant' },
        },
        {
          id: 'stack_warp',
          type: 'spell',
          controller: 'p2',
          card: { name: 'Warp World', type_line: 'Sorcery' },
        },
      ],
    };
    const item = {
      id: 'stack_mindbreak',
      type: 'spell',
      controller: 'p1',
      targets: ['stack_uncounterable', 'stack_warp'],
      card: {
        name: 'Mindbreak Trap',
        type_line: 'Instant — Trap',
        oracle_text: mindbreakOracle,
      },
    };
    expect(shouldFizzleStackSpellForMissingTargets(state, item, 'p1')).toBe(false);
  });
});
