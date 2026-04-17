import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';

function setupToMain1(game: ReturnType<typeof createInitialGameState>, p1: PlayerID, p2: PlayerID) {
  game.applyEvent({ type: 'nextTurn' });

  const p1Deck = Array.from({ length: 20 }, (_, index) => ({
    id: `p1_card_${index}`,
    name: `P1 Card ${index}`,
    type_line: 'Creature',
    oracle_text: '',
  }));
  const p2Deck = Array.from({ length: 20 }, (_, index) => ({
    id: `p2_card_${index}`,
    name: `P2 Card ${index}`,
    type_line: 'Creature',
    oracle_text: '',
  }));

  game.importDeckResolved(p1, p1Deck);
  game.importDeckResolved(p2, p2Deck);

  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({ type: 'nextStep' });
}

function setupCombatWithBlockedOmnath(game: ReturnType<typeof createInitialGameState>, includeVigor: boolean) {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;

  game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
  game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
  setupToMain1(game, p1, p2);

  const active = game.state.turnPlayer as PlayerID;
  const defending = active === p1 ? p2 : p1;

  (game.state as any).manaPool = {
    ...((game.state as any).manaPool || {}),
    [defending]: { green: 14 },
  };

  const attacker = {
    id: 'attacker_1',
    controller: active,
    owner: active,
    tapped: false,
    counters: {},
    summoningSickness: false,
    basePower: 2,
    baseToughness: 2,
    card: {
      id: 'attacker_card_1',
      name: 'Mai, Scornful Striker',
      type_line: 'Creature — Human Warrior',
      oracle_text: '',
      power: '2',
      toughness: '2',
    },
  };

  const omnath = {
    id: 'omnath_1',
    controller: defending,
    owner: defending,
    tapped: false,
    counters: {},
    summoningSickness: false,
    basePower: 1,
    baseToughness: 1,
    card: {
      id: 'omnath_card_1',
      name: 'Omnath, Locus of Mana',
      type_line: 'Legendary Creature — Elemental',
      oracle_text: 'Green mana doesn\'t empty from your mana pool as steps and phases end.\nOmnath, Locus of Mana gets +1/+1 for each green mana in your mana pool.',
      power: '*',
      toughness: '*',
    },
  };

  const battlefield: any[] = [attacker, omnath];
  if (includeVigor) {
    battlefield.push({
      id: 'vigor_1',
      controller: defending,
      owner: defending,
      tapped: false,
      counters: {},
      summoningSickness: false,
      basePower: 6,
      baseToughness: 6,
      card: {
        id: 'vigor_card_1',
        name: 'Vigor',
        type_line: 'Creature — Elemental Incarnation',
        oracle_text: 'Trample\nIf damage would be dealt to another creature you control, prevent that damage. Put a +1/+1 counter on that creature for each 1 damage prevented this way.\nWhen Vigor is put into a graveyard from anywhere, shuffle it into its owner\'s library.',
        power: '6',
        toughness: '6',
      },
    });
  }

  (game.state as any).battlefield = battlefield;

  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({
    type: 'declareAttackers',
    playerId: active,
    attackers: [{ attackerId: 'attacker_1', defendingPlayer: defending }],
  });
  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({
    type: 'declareBlockers',
    playerId: defending,
    blockers: [{ blockerId: 'omnath_1', attackerId: 'attacker_1' }],
  });
  (game.state as any).blockersDeclaredBy = [defending];

  game.applyEvent({ type: 'nextStep' });

  return { attackerId: attacker.id, omnathId: omnath.id };
}

function setupCombatAgainstPlaneswalker(
  game: ReturnType<typeof createInitialGameState>,
  options?: { includeBlocker?: boolean }
) {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;

  game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
  game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
  setupToMain1(game, p1, p2);

  const active = game.state.turnPlayer as PlayerID;
  const defending = active === p1 ? p2 : p1;
  const includeBlocker = options?.includeBlocker === true;

  const attacker = {
    id: 'attacker_pw_1',
    controller: active,
    owner: active,
    tapped: false,
    counters: {},
    summoningSickness: false,
    basePower: includeBlocker ? 5 : 3,
    baseToughness: includeBlocker ? 5 : 3,
    card: {
      id: 'attacker_pw_card_1',
      name: includeBlocker ? 'Trampling Lifedrinker' : 'Lifedrinker Adept',
      type_line: 'Creature — Angel',
      oracle_text: includeBlocker ? 'Trample\nLifelink' : 'Lifelink',
      power: includeBlocker ? '5' : '3',
      toughness: includeBlocker ? '5' : '3',
    },
  };

  const planeswalker = {
    id: 'walker_1',
    controller: defending,
    owner: defending,
    tapped: false,
    counters: { loyalty: includeBlocker ? 4 : 2 },
    loyalty: includeBlocker ? 4 : 2,
    baseLoyalty: includeBlocker ? 4 : 2,
    summoningSickness: false,
    card: {
      id: 'walker_card_1',
      name: 'Test Walker',
      type_line: 'Legendary Planeswalker — Test',
      oracle_text: '',
      loyalty: includeBlocker ? '4' : '2',
    },
  };

  const battlefield: any[] = [attacker, planeswalker];
  if (includeBlocker) {
    battlefield.push({
      id: 'blocker_pw_1',
      controller: defending,
      owner: defending,
      tapped: false,
      counters: {},
      summoningSickness: false,
      basePower: 2,
      baseToughness: 2,
      card: {
        id: 'blocker_pw_card_1',
        name: 'Faithful Guard',
        type_line: 'Creature — Soldier',
        oracle_text: '',
        power: '2',
        toughness: '2',
      },
    });
  }

  (game.state as any).battlefield = battlefield;

  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({
    type: 'declareAttackers',
    playerId: active,
    attackers: [{ attackerId: 'attacker_pw_1', targetPermanentId: 'walker_1' }],
  });
  game.applyEvent({ type: 'nextStep' });

  if (includeBlocker) {
    game.applyEvent({
      type: 'declareBlockers',
      playerId: defending,
      blockers: [{ blockerId: 'blocker_pw_1', attackerId: 'attacker_pw_1' }],
    });
  }
  (game.state as any).blockersDeclaredBy = [defending];

  game.applyEvent({ type: 'nextStep' });

  return { active, defending, planeswalkerId: planeswalker.id };
}

function setupBlockedCombatWithKeywordPhases(
  game: ReturnType<typeof createInitialGameState>,
  options: {
    attacker: {
      id: string;
      name: string;
      power: number;
      toughness: number;
      oracleText?: string;
    };
    blocker: {
      id: string;
      name: string;
      power: number;
      toughness: number;
      oracleText?: string;
    };
  }
) {
  const p1 = 'p1' as PlayerID;
  const p2 = 'p2' as PlayerID;

  game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
  game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
  setupToMain1(game, p1, p2);

  const active = game.state.turnPlayer as PlayerID;
  const defending = active === p1 ? p2 : p1;

  const attacker = {
    id: options.attacker.id,
    controller: active,
    owner: active,
    tapped: false,
    counters: {},
    summoningSickness: false,
    basePower: options.attacker.power,
    baseToughness: options.attacker.toughness,
    card: {
      id: `${options.attacker.id}_card`,
      name: options.attacker.name,
      type_line: 'Creature',
      oracle_text: options.attacker.oracleText || '',
      power: String(options.attacker.power),
      toughness: String(options.attacker.toughness),
    },
  };

  const blocker = {
    id: options.blocker.id,
    controller: defending,
    owner: defending,
    tapped: false,
    counters: {},
    summoningSickness: false,
    basePower: options.blocker.power,
    baseToughness: options.blocker.toughness,
    card: {
      id: `${options.blocker.id}_card`,
      name: options.blocker.name,
      type_line: 'Creature',
      oracle_text: options.blocker.oracleText || '',
      power: String(options.blocker.power),
      toughness: String(options.blocker.toughness),
    },
  };

  (game.state as any).battlefield = [attacker, blocker];

  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({
    type: 'declareAttackers',
    playerId: active,
    attackers: [{ attackerId: attacker.id, defendingPlayer: defending }],
  });
  game.applyEvent({ type: 'nextStep' });
  game.applyEvent({
    type: 'declareBlockers',
    playerId: defending,
    blockers: [{ blockerId: blocker.id, attackerId: attacker.id }],
  });
  (game.state as any).blockersDeclaredBy = [defending];

  game.applyEvent({ type: 'nextStep' });

  const currentStep = String((game.state as any).step || '').toLowerCase();
  if (currentStep.includes('first_strike_damage')) {
    game.applyEvent({ type: 'nextStep' });
  }

  return { active, defending, attackerId: attacker.id, blockerId: blocker.id };
}

describe('combat regression: dynamic P/T and Vigor', () => {
  it('uses Omnath\'s dynamic toughness when checking lethal combat damage', () => {
    const game = createInitialGameState('combat_dynamic_pt_omnath');
    const { omnathId } = setupCombatWithBlockedOmnath(game, false);

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.some((perm: any) => perm?.id === omnathId)).toBe(true);
  });

  it('lets Vigor prevent combat damage to another creature and add +1/+1 counters', () => {
    const game = createInitialGameState('combat_vigor_prevention');
    const { omnathId } = setupCombatWithBlockedOmnath(game, true);

    const battlefield = (game.state as any).battlefield || [];
    const omnath = battlefield.find((perm: any) => perm?.id === omnathId);

    expect(omnath).toBeTruthy();
    expect(Number(omnath?.markedDamage || 0)).toBe(0);
    expect(Number(omnath?.counters?.['+1/+1'] || 0)).toBe(2);
  });

  it('applies unblocked combat damage to an attacked planeswalker with a normal permanent id and grants lifelink', () => {
    const game = createInitialGameState('combat_planeswalker_unblocked');
    const { active, defending, planeswalkerId } = setupCombatAgainstPlaneswalker(game);

    const battlefield = (game.state as any).battlefield || [];
    const graveyard = (game.state as any).zones?.[defending]?.graveyard || [];

    expect(battlefield.some((perm: any) => perm?.id === planeswalkerId)).toBe(false);
    expect(graveyard.some((card: any) => String(card?.name || '') === 'Test Walker')).toBe(true);
    expect((game.state as any).life?.[defending]).toBe(40);
    expect((game.state as any).life?.[active]).toBe(43);
    expect((game.state as any).life?.[planeswalkerId]).toBeUndefined();
  });

  it('applies trample excess combat damage to an attacked planeswalker and keeps player life unchanged', () => {
    const game = createInitialGameState('combat_planeswalker_trample');
    const { active, defending, planeswalkerId } = setupCombatAgainstPlaneswalker(game, { includeBlocker: true });

    const battlefield = (game.state as any).battlefield || [];
    const planeswalker = battlefield.find((perm: any) => perm?.id === planeswalkerId);

    expect(planeswalker).toBeTruthy();
    expect(Number(planeswalker?.counters?.loyalty || 0)).toBe(1);
    expect(Number(planeswalker?.loyalty || 0)).toBe(1);
    expect(battlefield.some((perm: any) => perm?.id === 'blocker_pw_1')).toBe(false);
    expect((game.state as any).life?.[defending]).toBe(40);
    expect((game.state as any).life?.[active]).toBe(45);
    expect((game.state as any).life?.[planeswalkerId]).toBeUndefined();
  });

  it('lets a first-strike blocker kill a normal attacker before the regular damage step', () => {
    const game = createInitialGameState('combat_first_strike_blocker');
    const { attackerId, blockerId } = setupBlockedCombatWithKeywordPhases(game, {
      attacker: {
        id: 'attacker_fs_bug',
        name: 'Vanilla Attacker',
        power: 3,
        toughness: 3,
      },
      blocker: {
        id: 'blocker_fs_bug',
        name: 'First Strike Blocker',
        power: 4,
        toughness: 3,
        oracleText: 'First strike',
      },
    });

    const battlefield = (game.state as any).battlefield || [];
    const blocker = battlefield.find((perm: any) => perm?.id === blockerId);

    expect(battlefield.some((perm: any) => perm?.id === attackerId)).toBe(false);
    expect(blocker).toBeTruthy();
    expect(Number(blocker?.markedDamage || 0)).toBe(0);
  });

  it('lets a surviving normal blocker deal regular combat damage back to a first-strike attacker', () => {
    const game = createInitialGameState('combat_first_strike_attacker');
    const { attackerId, blockerId } = setupBlockedCombatWithKeywordPhases(game, {
      attacker: {
        id: 'attacker_first_strike_only',
        name: 'First Strike Attacker',
        power: 2,
        toughness: 2,
        oracleText: 'First strike',
      },
      blocker: {
        id: 'blocker_regular',
        name: 'Regular Blocker',
        power: 3,
        toughness: 3,
      },
    });

    const battlefield = (game.state as any).battlefield || [];
    const blocker = battlefield.find((perm: any) => perm?.id === blockerId);

    expect(battlefield.some((perm: any) => perm?.id === attackerId)).toBe(false);
    expect(blocker).toBeTruthy();
    expect(Number(blocker?.markedDamage || 0)).toBe(2);
  });
});