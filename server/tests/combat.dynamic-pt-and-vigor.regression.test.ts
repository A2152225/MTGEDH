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
});