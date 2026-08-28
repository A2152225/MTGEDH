import { describe, expect, it } from 'vitest';

import {
  attackerHasAllAbleCreaturesMustBlock,
  attackerHasMustBeBlockedIfAble,
  attackerMustBeBlockedByKeywords,
  attackerIsAttackingDefender,
  findMustBeBlockedIfAbleViolation,
  listAttackersAgainstDefender,
  resolveMustBeBlockedIfAbleAssignments,
} from '../src/socket/combat-handlers/combatMustBeBlockedIfAble.js';
import {
  ALL_ABLE_CREATURES_MUST_BLOCK,
  MUST_BE_BLOCKED_IF_ABLE,
} from '../src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingMustBeBlocked.js';
import { typedMustBeBlockedAbility } from '../src/state/modules/staticEffectSpec-handlers/staticEffectSpecOracleParsingMustBeBlockedByType.js';

// Quoted from mtg_data.db / oracle-cards (is_token = 0), 2026-08-25.
const LURE_ORACLE =
  'Enchant creature\nAll creatures able to block enchanted creature do so.';
const NEMESIS_MASK_ORACLE =
  'All creatures able to block equipped creature do so.\nEquip {3} ({3}: Attach to target creature you control. Equip only as a sorcery.)';
const SHINEN_ORACLE =
  "All creatures able to block this creature do so.\nChannel — {2}{G}{G}, Discard this card: All creatures able to block target creature this turn do so.";
const FIRE_FIEND_ORACLE =
  'Haste\nThis creature must be blocked if able.\n{R}: This creature gets +1/+0 until end of turn.';

function creature(args: {
  id: string;
  controller: string;
  name: string;
  oracle?: string;
  typeLine?: string;
  keywords?: string[];
  attacking?: string | boolean;
  tapped?: boolean;
  attachedTo?: string;
  grantedAbilities?: string[];
}): any {
  return {
    id: args.id,
    controller: args.controller,
    owner: args.controller,
    tapped: Boolean(args.tapped),
    attachedTo: args.attachedTo,
    grantedAbilities: args.grantedAbilities,
    attacking: args.attacking,
    card: {
      name: args.name,
      type_line: args.typeLine || 'Creature — Bear',
      oracle_text: args.oracle || '',
      keywords: args.keywords || [],
    },
  };
}

function lureState(overrides?: {
  attacker?: Partial<Parameters<typeof creature>[0]>;
  blocker?: Partial<Parameters<typeof creature>[0]>;
  extra?: any[];
}): any {
  const attacker = creature({
    id: 'bear_1',
    controller: 'p1',
    name: 'Grizzly Bears',
    attacking: 'p2',
    ...overrides?.attacker,
  });
  const lure = {
    id: 'lure_1',
    controller: 'p1',
    attachedTo: attacker.id,
    card: {
      name: 'Lure',
      type_line: 'Enchantment — Aura',
      oracle_text: LURE_ORACLE,
    },
  };
  const blocker = creature({
    id: 'wall_1',
    controller: 'p2',
    name: 'Wall of Wood',
    typeLine: 'Creature — Wall',
    ...overrides?.blocker,
  });
  return {
    players: [
      { id: 'p1', name: 'Attacker' },
      { id: 'p2', name: 'Defender' },
    ],
    battlefield: [lure, attacker, blocker, ...(overrides?.extra || [])],
  };
}

describe('must-be-blocked-if-able from derived grants', () => {
  it('grants the derived ability to a Lure host, not the aura', () => {
    const state = lureState();
    expect(attackerHasAllAbleCreaturesMustBlock(state.battlefield[1], state)).toBe(true);
    expect(attackerHasMustBeBlockedIfAble(state.battlefield[1], state)).toBe(false);
    expect(attackerHasAllAbleCreaturesMustBlock(state.battlefield[0], state)).toBe(false);
    expect(attackerHasAllAbleCreaturesMustBlock(state.battlefield[2], state)).toBe(false);
  });

  it('rejects leaving a Lure-enchanted attacker unblocked when a legal blocker is unused', () => {
    const state = lureState();
    const violation = findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [],
    });
    expect(violation?.code).toBe('MUST_BE_BLOCKED_IF_ABLE');
    expect(violation?.attackerIds).toEqual(['bear_1']);
    expect(violation?.message).toContain('Grizzly Bears');
  });

  it('accepts assigning that unused legal blocker to the Lure host', () => {
    const state = lureState();
    expect(findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [{ blockerId: 'wall_1', attackerId: 'bear_1' }],
    })).toBeNull();
  });

  it('rejects assigning the only legal blocker to a different attacker', () => {
    const other = creature({
      id: 'other_1',
      controller: 'p1',
      name: 'Runeclaw Bear',
      attacking: 'p2',
    });
    const state = lureState({ extra: [other] });
    const violation = findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [{ blockerId: 'wall_1', attackerId: 'other_1' }],
    });
    expect(violation?.attackerIds).toEqual(['bear_1']);
  });

  it('does not force a block when the attacker has flying and the defender does not', () => {
    const state = lureState({
      attacker: {
        name: 'Wind Drake',
        typeLine: 'Creature — Drake',
        oracle: 'Flying',
        keywords: ['Flying'],
      },
    });
    expect(findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [],
    })).toBeNull();
  });

  it('does not force a block when every defending creature is tapped', () => {
    const state = lureState({
      blocker: { tapped: true },
    });
    expect(findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [],
    })).toBeNull();
  });

  it('does not force a block when the unused creature cannot block', () => {
    const state = lureState({
      blocker: { grantedAbilities: ["can't block"] },
    });
    expect(findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [],
    })).toBeNull();
  });

  it('enforces Shinen of Life\'s Roar from its own derived self grant', () => {
    const shinen = creature({
      id: 'shinen_1',
      controller: 'p1',
      name: "Shinen of Life's Roar",
      typeLine: 'Creature — Spirit',
      oracle: SHINEN_ORACLE,
      attacking: 'p2',
    });
    const blocker = creature({
      id: 'wall_1',
      controller: 'p2',
      name: 'Wall of Wood',
    });
    const state = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [shinen, blocker],
    };

    expect(attackerHasAllAbleCreaturesMustBlock(shinen, state)).toBe(true);
    expect(attackerHasMustBeBlockedIfAble(shinen, state)).toBe(false);
    expect(findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [],
    })?.attackerIds).toEqual(['shinen_1']);
    expect(findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [{ blockerId: 'wall_1', attackerId: 'shinen_1' }],
    })).toBeNull();
  });

  it('enforces Nemesis Mask on the equipped host from the derived grant', () => {
    const host = creature({
      id: 'bear_1',
      controller: 'p1',
      name: 'Grizzly Bears',
      attacking: 'p2',
    });
    const mask = {
      id: 'mask_1',
      controller: 'p1',
      attachedTo: 'bear_1',
      card: {
        name: 'Nemesis Mask',
        type_line: 'Artifact — Equipment',
        oracle_text: NEMESIS_MASK_ORACLE,
      },
    };
    const blocker = creature({
      id: 'wall_1',
      controller: 'p2',
      name: 'Wall of Wood',
    });
    const state = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [mask, host, blocker],
    };

    expect(attackerHasAllAbleCreaturesMustBlock(host, state)).toBe(true);
    expect(attackerHasMustBeBlockedIfAble(host, state)).toBe(false);
    expect(attackerHasAllAbleCreaturesMustBlock(mask, state)).toBe(false);
    expect(findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [],
    })?.attackerIds).toEqual(['bear_1']);
  });

  it('allows leaving a second lure-style attacker unblocked when the only legal blocker is used', () => {
    const first = creature({
      id: 'shinen_1',
      controller: 'p1',
      name: "Shinen of Life's Roar",
      typeLine: 'Creature — Spirit',
      oracle: SHINEN_ORACLE,
      attacking: 'p2',
    });
    const second = creature({
      id: 'shinen_2',
      controller: 'p1',
      name: "Shinen of Life's Roar",
      typeLine: 'Creature — Spirit',
      oracle: SHINEN_ORACLE,
      attacking: 'p2',
    });
    const blocker = creature({
      id: 'wall_1',
      controller: 'p2',
      name: 'Wall of Wood',
    });
    const state = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [first, second, blocker],
    };

    expect(findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [{ blockerId: 'wall_1', attackerId: 'shinen_1' }],
    })).toBeNull();
  });

  it('does not treat a nameless host as must-block without a derived grant', () => {
    const attacker = creature({
      id: 'bear_1',
      controller: 'p1',
      name: 'Grizzly Bears',
      attacking: 'p2',
    });
    const blocker = creature({
      id: 'wall_1',
      controller: 'p2',
      name: 'Wall of Wood',
    });
    const state = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [attacker, blocker],
    };
    expect(attackerHasMustBeBlockedIfAble(attacker, state)).toBe(false);
    expect(attackerHasAllAbleCreaturesMustBlock(attacker, state)).toBe(false);
    expect(findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [],
    })).toBeNull();
    expect(MUST_BE_BLOCKED_IF_ABLE).toBe('must_be_blocked_if_able');
    expect(ALL_ABLE_CREATURES_MUST_BLOCK).toBe('all_able_creatures_must_block');
  });

  it('auto-assigns an unused legal blocker for an empty AI / skip repair', () => {
    const state = lureState();
    expect(resolveMustBeBlockedIfAbleAssignments({
      state,
      defendingPlayerId: 'p2',
      assignments: [],
    })).toEqual([{ blockerId: 'wall_1', attackerId: 'bear_1' }]);
  });

  it('does not invent a block when every defending creature is unable', () => {
    const state = lureState({
      attacker: {
        name: 'Wind Drake',
        typeLine: 'Creature — Drake',
        oracle: 'Flying',
        keywords: ['Flying'],
      },
    });
    expect(resolveMustBeBlockedIfAbleAssignments({
      state,
      defendingPlayerId: 'p2',
      assignments: [],
    })).toEqual([]);
  });

  it('reassigns a legal blocker from a non-requirement attacker onto the lure host', () => {
    const other = creature({
      id: 'other_1',
      controller: 'p1',
      name: 'Runeclaw Bear',
      attacking: 'p2',
    });
    const state = lureState({ extra: [other] });
    expect(resolveMustBeBlockedIfAbleAssignments({
      state,
      defendingPlayerId: 'p2',
      assignments: [{ blockerId: 'wall_1', attackerId: 'other_1' }],
    })).toEqual([{ blockerId: 'wall_1', attackerId: 'bear_1' }]);
  });

  it('rejects leaving a second able unused blocker idle versus a Lure-style attacker', () => {
    const extraBlocker = creature({
      id: 'wall_2',
      controller: 'p2',
      name: 'Wall of Roots',
      typeLine: 'Creature — Wall',
    });
    const state = lureState({ extra: [extraBlocker] });
    const violation = findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [{ blockerId: 'wall_1', attackerId: 'bear_1' }],
    });
    expect(violation?.code).toBe('MUST_BE_BLOCKED_IF_ABLE');
    expect(violation?.attackerIds).toEqual(['bear_1']);
    expect(violation?.message).toMatch(/All creatures able to block/i);
    expect(findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [
        { blockerId: 'wall_1', attackerId: 'bear_1' },
        { blockerId: 'wall_2', attackerId: 'bear_1' },
      ],
    })).toBeNull();
  });

  it('auto-assigns every unused able blocker onto a Lure-style attacker', () => {
    const extraBlocker = creature({
      id: 'wall_2',
      controller: 'p2',
      name: 'Wall of Roots',
      typeLine: 'Creature — Wall',
    });
    const state = lureState({ extra: [extraBlocker] });
    expect(resolveMustBeBlockedIfAbleAssignments({
      state,
      defendingPlayerId: 'p2',
      assignments: [],
    })).toEqual([
      { blockerId: 'wall_1', attackerId: 'bear_1' },
      { blockerId: 'wall_2', attackerId: 'bear_1' },
    ]);
  });

  it('accepts a 1-1 split when two Lure-style attackers share two able blockers', () => {
    const first = creature({
      id: 'shinen_1',
      controller: 'p1',
      name: "Shinen of Life's Roar",
      typeLine: 'Creature — Spirit',
      oracle: SHINEN_ORACLE,
      attacking: 'p2',
    });
    const second = creature({
      id: 'shinen_2',
      controller: 'p1',
      name: "Shinen of Life's Roar",
      typeLine: 'Creature — Spirit',
      oracle: SHINEN_ORACLE,
      attacking: 'p2',
    });
    const wall1 = creature({ id: 'wall_1', controller: 'p2', name: 'Wall of Wood' });
    const wall2 = creature({ id: 'wall_2', controller: 'p2', name: 'Wall of Roots' });
    const state = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [first, second, wall1, wall2],
    };

    expect(findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [
        { blockerId: 'wall_1', attackerId: 'shinen_1' },
        { blockerId: 'wall_2', attackerId: 'shinen_2' },
      ],
    })).toBeNull();
    expect(resolveMustBeBlockedIfAbleAssignments({
      state,
      defendingPlayerId: 'p2',
      assignments: [],
    })).toEqual([
      { blockerId: 'wall_1', attackerId: 'shinen_1' },
      { blockerId: 'wall_2', attackerId: 'shinen_2' },
    ]);
  });
});

describe('must-be-blocked-if-able at-least-one grants', () => {
  function fireFiendState(extra: any[] = []): any {
    const attacker = creature({
      id: 'fiend_1',
      controller: 'p1',
      name: 'Goblin Fire Fiend',
      typeLine: 'Creature — Goblin Berserker',
      oracle: FIRE_FIEND_ORACLE,
      attacking: 'p2',
    });
    const wall1 = creature({
      id: 'wall_1',
      controller: 'p2',
      name: 'Wall of Wood',
      typeLine: 'Creature — Wall',
    });
    return {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [attacker, wall1, ...extra],
    };
  }

  it('grants at-least-one, not all-able, from Goblin Fire Fiend oracle', () => {
    const state = fireFiendState();
    expect(attackerHasMustBeBlockedIfAble(state.battlefield[0], state)).toBe(true);
    expect(attackerHasAllAbleCreaturesMustBlock(state.battlefield[0], state)).toBe(false);
  });

  it('rejects leaving a Fire Fiend unblocked when a legal blocker is unused', () => {
    const state = fireFiendState();
    expect(findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [],
    })?.attackerIds).toEqual(['fiend_1']);
  });

  it('allows a second able unused blocker to stay idle versus a Fire Fiend', () => {
    const extraBlocker = creature({
      id: 'wall_2',
      controller: 'p2',
      name: 'Wall of Roots',
      typeLine: 'Creature — Wall',
    });
    const state = fireFiendState([extraBlocker]);
    expect(findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [{ blockerId: 'wall_1', attackerId: 'fiend_1' }],
    })).toBeNull();
    expect(resolveMustBeBlockedIfAbleAssignments({
      state,
      defendingPlayerId: 'p2',
      assignments: [],
    })).toEqual([{ blockerId: 'wall_1', attackerId: 'fiend_1' }]);
  });
});

describe('must be blocked by a creature with flying if able', () => {
  const TYPED_FLYING_ORACLE =
    'This creature must be blocked by a creature with flying if able.';

  function typedFlyingState(overrides?: {
    extra?: any[];
    blocker?: Partial<Parameters<typeof creature>[0]>;
  }): any {
    const attacker = creature({
      id: 'typed_1',
      controller: 'p1',
      name: 'Typed Must Block',
      typeLine: 'Creature — Illusion',
      oracle: TYPED_FLYING_ORACLE,
      attacking: 'p2',
    });
    const blocker = creature({
      id: 'wall_1',
      controller: 'p2',
      name: 'Wall of Wood',
      typeLine: 'Creature — Wall',
      ...overrides?.blocker,
    });
    return {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [attacker, blocker, ...(overrides?.extra || [])],
    };
  }

  it('grants must_be_blocked_by_flying, not a plain lure', () => {
    const state = typedFlyingState();
    expect(attackerMustBeBlockedByKeywords(state.battlefield[0], state)).toEqual(['flying']);
    expect(attackerHasMustBeBlockedIfAble(state.battlefield[0], state)).toBe(false);
    expect(attackerHasAllAbleCreaturesMustBlock(state.battlefield[0], state)).toBe(false);
    expect(typedMustBeBlockedAbility('flying')).toBe('must_be_blocked_by_flying');
  });

  it('rejects leaving the attacker unblocked when a flying creature can block', () => {
    const flyer = creature({
      id: 'drake_1',
      controller: 'p2',
      name: 'Wind Drake',
      typeLine: 'Creature — Drake',
      oracle: 'Flying',
      keywords: ['Flying'],
    });
    const state = typedFlyingState({ extra: [flyer] });
    const violation = findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [],
    });
    expect(violation?.code).toBe('MUST_BE_BLOCKED_IF_ABLE');
    expect(violation?.attackerIds).toEqual(['typed_1']);
    expect(violation?.message).toMatch(/flying/i);
  });

  it('allows skip when the defender has only ground creatures', () => {
    const state = typedFlyingState();
    expect(findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [],
    })).toBeNull();
    expect(resolveMustBeBlockedIfAbleAssignments({
      state,
      defendingPlayerId: 'p2',
      assignments: [],
    })).toEqual([]);
  });

  it('does not force a ground creature to block when a flyer is available', () => {
    const flyer = creature({
      id: 'drake_1',
      controller: 'p2',
      name: 'Wind Drake',
      typeLine: 'Creature — Drake',
      oracle: 'Flying',
      keywords: ['Flying'],
    });
    const state = typedFlyingState({ extra: [flyer] });
    expect(findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [{ blockerId: 'wall_1', attackerId: 'typed_1' }],
    })?.attackerIds).toEqual(['typed_1']);
    expect(findMustBeBlockedIfAbleViolation({
      state,
      defendingPlayerId: 'p2',
      assignments: [{ blockerId: 'drake_1', attackerId: 'typed_1' }],
    })).toBeNull();
    expect(resolveMustBeBlockedIfAbleAssignments({
      state,
      defendingPlayerId: 'p2',
      assignments: [],
    })).toEqual([{ blockerId: 'drake_1', attackerId: 'typed_1' }]);
  });
});

describe('listAttackersAgainstDefender', () => {
  it('matches attackers whose attacking field is the defending player id', () => {
    const attacker = creature({
      id: 'bear_1',
      controller: 'p1',
      name: 'Grizzly Bears',
      attacking: 'p2',
    });
    const other = creature({
      id: 'bear_2',
      controller: 'p1',
      name: 'Other Bear',
      attacking: 'p3',
    });
    const battlefield = [attacker, other];

    expect(attackerIsAttackingDefender(attacker, 'p2', battlefield)).toBe(true);
    expect(listAttackersAgainstDefender(battlefield, 'p2').map((perm: any) => perm.id)).toEqual(['bear_1']);
    expect(listAttackersAgainstDefender(battlefield, 'p2')).not.toEqual(
      battlefield.filter((perm: any) => perm.attacking === true),
    );
  });

  it('matches attackers aimed at a planeswalker the defending player controls', () => {
    const walker = {
      id: 'pw_1',
      controller: 'p2',
      card: { name: 'Jace, the Mind Sculptor', type_line: 'Legendary Planeswalker — Jace' },
    };
    const attacker = creature({
      id: 'bear_1',
      controller: 'p1',
      name: 'Grizzly Bears',
      attacking: 'pw_1',
    });
    const battlefield = [walker, attacker];

    expect(attackerIsAttackingDefender(attacker, 'p2', battlefield)).toBe(true);
    expect(listAttackersAgainstDefender(battlefield, 'p2').map((perm: any) => perm.id)).toEqual(['bear_1']);
    expect(listAttackersAgainstDefender(battlefield, 'p3')).toEqual([]);
  });
});
