import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { registerPermanentTriggers } from '../src/state/modules/triggered-abilities';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

function importSampleDeck(g: any, playerId: PlayerID, prefix: string) {
  const sampleDeck = Array.from({ length: 20 }, (_, index) => ({
    id: `${prefix}_${index}`,
    name: `Sample ${prefix} ${index}`,
    type_line: 'Creature',
    oracle_text: '',
  }));
  g.importDeckResolved(playerId, sampleDeck);
}

function setupToMain1(g: any, players: PlayerID[]) {
  g.applyEvent({ type: 'nextTurn' });
  for (const playerId of players) {
    importSampleDeck(g, playerId, String(playerId));
  }

  g.applyEvent({ type: 'nextStep' }); // UPKEEP
  g.applyEvent({ type: 'nextStep' }); // DRAW
  g.applyEvent({ type: 'nextStep' }); // MAIN1
}

describe('Postcombat main combat-damage regressions', () => {
  it('queues and resolves second-main combat-damage count triggers from permanents', () => {
    const g = createInitialGameState('postcombat_main_estinien_regression');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;

    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');
    setupToMain1(g, [p1, p2, p3]);

    const activePlayer = g.state.turnPlayer as PlayerID;
    const opponents = [p1, p2, p3].filter((playerId) => playerId !== activePlayer);

    const estinien = {
      id: 'estinien_perm',
      controller: activePlayer,
      owner: activePlayer,
      tapped: false,
      counters: {},
      summoningSickness: false,
      basePower: 3,
      baseToughness: 3,
      card: {
        id: 'estinien_card',
        name: 'Estinien Varlineau',
        type_line: 'Legendary Creature — Human Knight',
        oracle_text:
          'At the beginning of your second main phase, you draw X cards and lose X life, where X is the number of your opponents who were dealt combat damage by Estinien Varlineau or a Dragon this turn.',
        power: '3',
        toughness: '3',
      },
    };
    const dragon = {
      id: 'dragon_perm',
      controller: activePlayer,
      owner: activePlayer,
      tapped: false,
      counters: {},
      summoningSickness: false,
      basePower: 4,
      baseToughness: 4,
      card: {
        id: 'dragon_card',
        name: 'Test Dragon',
        type_line: 'Creature — Dragon',
        oracle_text: 'Flying',
        power: '4',
        toughness: '4',
      },
    };

    (g.state.battlefield as any[]).push(estinien, dragon);
    registerPermanentTriggers(g as any, estinien as any);

    const handCountBefore = Number((g.state as any).zones?.[activePlayer]?.handCount || 0);
    const lifeBefore = Number((g.state as any).life?.[activePlayer] || 40);

    g.applyEvent({ type: 'nextStep' }); // BEGIN_COMBAT
    g.applyEvent({ type: 'nextStep' }); // DECLARE_ATTACKERS
    g.applyEvent({ type: 'nextStep' }); // DECLARE_BLOCKERS

    (estinien as any).attacking = opponents[0];
    (estinien as any).blockedBy = [];
    (dragon as any).attacking = opponents[1];
    (dragon as any).blockedBy = [];

    g.applyEvent({ type: 'nextStep' }); // DAMAGE
    g.applyEvent({ type: 'nextStep' }); // END_COMBAT
    g.applyEvent({ type: 'nextStep' }); // MAIN2

    const stack = (g.state as any).stack || [];
    const queued = stack.find((item: any) => item?.type === 'triggered_ability' && item?.source === 'estinien_perm');
    expect(queued).toBeTruthy();

    g.resolveTopOfStack();

    expect(Number((g.state as any).zones?.[activePlayer]?.handCount || 0)).toBe(handCountBefore + 2);
    expect(Number((g.state as any).life?.[activePlayer] || 40)).toBe(lifeBefore - 2);
  });

  it('resolves draw-per-opponent combat-damage counts from shared tracking', () => {
    const g = createInitialGameState('postcombat_main_moonshae_count_regression');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;

    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');
    setupToMain1(g, [p1, p2, p3]);

    (g.state as any).creaturesThatDealtDamageToPlayer = {
      [p2]: {
        attacker_a: { creatureName: 'Attacker A', totalDamage: 2 },
      },
      [p3]: {
        attacker_b: { creatureName: 'Attacker B', totalDamage: 3 },
      },
    };

    const handCountBefore = Number((g.state as any).zones?.[p1]?.handCount || 0);

    (g.state as any).stack = [
      {
        id: 'moonshae_trigger',
        type: 'triggered_ability',
        controller: p1,
        source: 'moonshae_perm',
        sourceName: 'Moonshae Pixie',
        description: 'Draw cards equal to the number of opponents who were dealt combat damage this turn.',
        effect: 'Draw cards equal to the number of opponents who were dealt combat damage this turn.',
        mandatory: true,
        targets: [],
      },
    ];

    g.resolveTopOfStack();

    expect(Number((g.state as any).zones?.[p1]?.handCount || 0)).toBe(handCountBefore + 2);
  });
});