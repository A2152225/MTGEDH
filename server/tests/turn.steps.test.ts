import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID, KnownCardRef } from '../../shared/src';
import { GamePhase, GameStep } from '../../shared/src';
import { setPermanentPrepared } from '../src/state/modules/prepared.js';
import { markPlayerSkipsNextUntapStep } from '../src/state/modules/skipUntapStepUtils.js';

function buildPreparedCleanupCard() {
  return {
    id: 'prepared_cleanup_card',
    name: 'Prepared Borrower // Sudden Pivot',
    layout: 'prepare',
    mana_cost: '{2}{U} // {1}{U}',
    type_line: 'Creature — Human Rogue // Instant',
    colors: ['U'],
    color_identity: ['U'],
    card_faces: [
      {
        name: 'Prepared Borrower',
        mana_cost: '{2}{U}',
        type_line: 'Creature — Human Rogue',
        oracle_text: "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
        power: '2',
        toughness: '3',
      },
      {
        name: 'Sudden Pivot',
        mana_cost: '{1}{U}',
        type_line: 'Instant',
        oracle_text: 'Return target creature to its owner\'s hand.',
      },
    ],
  };
}

function markAttackersDeclaredForTurnPlayer(g: ReturnType<typeof createInitialGameState>) {
  const turnPlayer = String(g.state.turnPlayer || '');
  (g.state as any).attackersDeclaredBy = turnPlayer ? [turnPlayer] : [];
}

describe('Turn step engine basics', () => {
  it('advances steps with untap and draw automation, and maps phases for main steps', () => {
    const g = createInitialGameState('t_steps_1');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Set up libraries for both players so draw step can actually draw
    const sampleDeck = Array.from({ length: 10 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.importDeckResolved(p2, sampleDeck);

    // Start of game: nextTurn leaves the designated starting player active (turnPlayer from join/claim/randomize)
    g.applyEvent({ type: 'nextTurn' });
    expect(g.state.turnPlayer).toBe(p1);
    expect(g.state.phase).toBe(GamePhase.BEGINNING);
    expect(g.state.step).toBe(GameStep.UNTAP);

    // Put a tapped token for p2, then nextStep should untap it
    g.createToken(g.state.turnPlayer, 'Test', 1, 2, 2);
    const permId = g.state.battlefield[0].id;
    g.state.battlefield[0].tapped = true;

    g.applyEvent({ type: 'nextStep' }); // UPKEEP
    expect(g.state.phase).toBe(GamePhase.BEGINNING);
    expect(g.state.step).toBe(GameStep.UPKEEP);
    // Untap was applied when we entered UNTAP, so token is untapped now
    const perm = g.state.battlefield.find(p => p.id === permId)!;
    expect(perm.tapped).toBe(false);

    // Capture hand count BEFORE entering draw step (draw happens when entering DRAW).
    // Turn 1 starting player skips their first draw in two-player games (Rule 103.8a).
    (g.state as any).turn = 2;
    (g.state as any).turnNumber = 2;
    const startHand = g.state.zones?.[g.state.turnPlayer]?.handCount ?? 0;
    g.applyEvent({ type: 'nextStep' }); // DRAW - card is drawn here
    expect(g.state.step).toBe(GameStep.DRAW);

    g.applyEvent({ type: 'nextStep' }); // MAIN1
    expect(g.state.phase).toBe(GamePhase.PRECOMBAT_MAIN);
    expect(g.state.step).toBe(GameStep.MAIN1);
    const afterHand = g.state.zones?.[g.state.turnPlayer]?.handCount ?? 0;
    expect(afterHand).toBe(startHand + 1);

    // Advance to MAIN2 and then END/CLEANUP then turn rolls
    // Skip through combat micro-steps
    g.applyEvent({ type: 'nextStep' }); // BEGIN_COMBAT
    g.applyEvent({ type: 'nextStep' }); // DECLARE_ATTACKERS
    markAttackersDeclaredForTurnPlayer(g);
    g.applyEvent({ type: 'nextStep' }); // DECLARE_BLOCKERS
    g.applyEvent({ type: 'nextStep' }); // DAMAGE
    g.applyEvent({ type: 'nextStep' }); // END_COMBAT
    g.applyEvent({ type: 'nextStep' }); // MAIN2
    expect(g.state.phase).toBe(GamePhase.POSTCOMBAT_MAIN);
    expect(g.state.step).toBe(GameStep.MAIN2);

    g.applyEvent({ type: 'nextStep' }); // END
    expect(g.state.phase).toBe(GamePhase.ENDING);
    expect(g.state.step).toBe(GameStep.END);

    // When advancing from END step with no discard needed and no Sundial effect,
    // cleanup step auto-advances to next turn (Rule 514.3 - no priority during cleanup)
    const prevTurnPlayer = g.state.turnPlayer;
    g.applyEvent({ type: 'nextStep' }); // CLEANUP -> auto-advances to next turn
    expect(g.state.turnPlayer).not.toBe(prevTurnPlayer);
    expect(g.state.phase).toBe(GamePhase.BEGINNING);
    expect(g.state.step).toBe(GameStep.UNTAP);
  });

  it('skips the untap step turn action when Stasis is on the battlefield', () => {
    const g = createInitialGameState('t_steps_stasis');

    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    g.applyEvent({ type: 'nextTurn' });
    expect(g.state.step).toBe(GameStep.UNTAP);

    g.createToken(p1, 'Tapped Test', 1, 1, 1);
    const permId = g.state.battlefield[0].id;
    g.state.battlefield[0].tapped = true;

    (g.state.battlefield as any[]).push({
      id: 'stasis_perm',
      controller: p1,
      owner: p1,
      card: {
        id: 'stasis_card',
        name: 'Stasis',
        type_line: 'Enchantment',
        oracle_text: 'Players skip their untap steps.',
      },
      tapped: false,
    });

    g.applyEvent({ type: 'nextStep' }); // UPKEEP — untap step action skipped

    expect(g.state.step).toBe(GameStep.UPKEEP);
    const perm = g.state.battlefield.find((p) => p.id === permId)!;
    expect(perm.tapped).toBe(true);
  });

  it('skips the untap step when the active player has a skip-next-untap flag', () => {
    const g = createInitialGameState('t_steps_player_skip_untap');
    const p1 = 'p1' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'nextTurn' });
    markPlayerSkipsNextUntapStep(g, p1);

    g.createToken(p1, 'Tapped Test', 1, 1, 1);
    const permId = g.state.battlefield[0].id;
    g.state.battlefield[0].tapped = true;

    g.applyEvent({ type: 'nextStep' });

    expect(g.state.step).toBe(GameStep.UPKEEP);
    const perm = g.state.battlefield.find((p) => p.id === permId)!;
    expect(perm.tapped).toBe(true);
  });

  it('clears damageMarked from permanents during cleanup step (Rule 514.2)', () => {
    const g = createInitialGameState('t_steps_cleanup_damage');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const sampleDeck = Array.from({ length: 10 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.importDeckResolved(p2, sampleDeck);

    g.applyEvent({ type: 'nextTurn' });

    g.createToken(g.state.turnPlayer, 'Damaged Test', 3, 3, 3);
    const damagedPerm = g.state.battlefield[0] as any;
    damagedPerm.damageMarked = 2;
    damagedPerm.markedDamage = 1;

    g.applyEvent({ type: 'nextStep' }); // UPKEEP
    g.applyEvent({ type: 'nextStep' }); // DRAW
    g.applyEvent({ type: 'nextStep' }); // MAIN1
    g.applyEvent({ type: 'nextStep' }); // BEGIN_COMBAT
    g.applyEvent({ type: 'nextStep' }); // DECLARE_ATTACKERS
    markAttackersDeclaredForTurnPlayer(g);
    g.applyEvent({ type: 'nextStep' }); // DECLARE_BLOCKERS
    g.applyEvent({ type: 'nextStep' }); // DAMAGE
    g.applyEvent({ type: 'nextStep' }); // END_COMBAT
    g.applyEvent({ type: 'nextStep' }); // MAIN2
    g.applyEvent({ type: 'nextStep' }); // END

    expect(Number(damagedPerm.damageMarked || 0)).toBe(2);

    g.applyEvent({ type: 'nextStep' }); // CLEANUP -> next turn

    expect(Number(damagedPerm.damageMarked || 0)).toBe(0);
    expect(Number(damagedPerm.markedDamage || 0)).toBe(0);
    expect(Boolean(damagedPerm.deathtouchDamageMarked)).toBe(false);
  });

  it('pauses at cleanup step when Sundial of the Infinite is on battlefield', () => {
    const g = createInitialGameState('t_steps_sundial');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    // Set up libraries for both players
    const sampleDeck = Array.from({ length: 10 }, (_, i) => ({
      id: `card_${i}`,
      name: `Test Card ${i}`,
      type_line: 'Creature',
      oracle_text: '',
    }));
    g.importDeckResolved(p1, sampleDeck);
    g.importDeckResolved(p2, sampleDeck);

    // Start of game: first active player is whoever joined first (p1)
    g.applyEvent({ type: 'nextTurn' });
    expect(g.state.turnPlayer).toBe(p1);

    // Add Sundial of the Infinite to the active player's battlefield
    const sundialPermanent = {
      id: 'sundial_1',
      controller: p1,
      owner: p1,
      card: {
        id: 'sundial_card',
        name: 'Sundial of the Infinite',
        type_line: 'Artifact',
        oracle_text: '{1}, {T}: End the turn. Activate only during your turn.',
        mana_cost: '{2}',
      },
      tapped: false,
    };
    // Use array push with type assertion since we're in a test context
    // with a minimal game state that may not have full type coverage
    (g.state.battlefield as typeof g.state.battlefield).push(sundialPermanent as typeof g.state.battlefield[0]);

    // Advance to END step
    g.applyEvent({ type: 'nextStep' }); // UPKEEP
    g.applyEvent({ type: 'nextStep' }); // DRAW
    g.applyEvent({ type: 'nextStep' }); // MAIN1
    g.applyEvent({ type: 'nextStep' }); // BEGIN_COMBAT
    g.applyEvent({ type: 'nextStep' }); // DECLARE_ATTACKERS
    markAttackersDeclaredForTurnPlayer(g);
    g.applyEvent({ type: 'nextStep' }); // DECLARE_BLOCKERS
    g.applyEvent({ type: 'nextStep' }); // DAMAGE
    g.applyEvent({ type: 'nextStep' }); // END_COMBAT
    g.applyEvent({ type: 'nextStep' }); // MAIN2
    g.applyEvent({ type: 'nextStep' }); // END

    expect(g.state.phase).toBe(GamePhase.ENDING);
    expect(g.state.step).toBe(GameStep.END);

    // When advancing from END step with Sundial available, should pause at CLEANUP
    // to give player a chance to use it
    const prevTurnPlayer = g.state.turnPlayer;
    g.applyEvent({ type: 'nextStep' }); // Should stay at CLEANUP
    
    expect(g.state.turnPlayer).toBe(prevTurnPlayer); // Same player's turn
    expect(g.state.phase).toBe(GamePhase.ENDING);
    expect(g.state.step).toBe(GameStep.CLEANUP); // Paused at cleanup

    // Now if player decides to pass (not use Sundial), another nextStep should advance
    g.applyEvent({ type: 'nextStep' }); // Now should advance to next turn
    expect(g.state.turnPlayer).not.toBe(prevTurnPlayer);
    expect(g.state.phase).toBe(GamePhase.BEGINNING);
    expect(g.state.step).toBe(GameStep.UNTAP);
  });

  it('reverts temporary control changes and migrates prepared copies during cleanup', () => {
    const g = createInitialGameState('t_steps_control_revert_prepared');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const preparedCard = buildPreparedCleanupCard();
    const frontFace = preparedCard.card_faces[0];

    (g.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (g.state as any).turnOrder = [p1, p2];
    (g.state as any).turnPlayer = p1;
    (g.state as any).activePlayer = p1;
    (g.state as any).phase = GamePhase.ENDING;
    (g.state as any).step = GameStep.CLEANUP;
    (g.state as any).stack = [];
    (g.state as any).zones = {
      [p1]: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      [p2]: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };

    const permanent = {
      id: 'prepared_cleanup_perm',
      controller: p2,
      owner: p1,
      tapped: false,
      card: {
        ...preparedCard,
        name: frontFace.name,
        mana_cost: frontFace.mana_cost,
        type_line: frontFace.type_line,
        oracle_text: frontFace.oracle_text,
        zone: 'battlefield',
      },
    } as any;
    (g.state as any).battlefield = [permanent];
    setPermanentPrepared((g.state as any), permanent);
    (g.state as any).controlChangeEffects = [
      {
        permanentId: 'prepared_cleanup_perm',
        originalController: p1,
        newController: p2,
        duration: 'eot',
        appliedAt: 1,
      },
    ];

    expect((g.state as any).zones[p2].exile).toHaveLength(1);
    expect((g.state as any).zones[p1].exile).toHaveLength(0);

    g.applyEvent({ type: 'nextStep' } as any);

    const updatedPermanent = (g.state as any).battlefield.find((entry: any) => entry.id === 'prepared_cleanup_perm');
    expect(updatedPermanent?.controller).toBe(p1);
    expect((g.state as any).zones[p2].exile).toHaveLength(0);
    expect((g.state as any).zones[p1].exile).toHaveLength(1);
    expect((g.state as any).zones[p1].exile[0]).toMatchObject({
      canBePlayedBy: p1,
      preparedSourcePermanentId: 'prepared_cleanup_perm',
    });
    expect((g.state as any).controlChangeEffects).toBeUndefined();
  });
});

describe('Declare attackers step guards', () => {
  it('blocks turn player from passing priority until attackers are declared', () => {
    const g = createInitialGameState('declare_attackers_pass_block');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'Attacker' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'Defender' });

    g.createToken(p1, 'Goblin', 1, 2, 1);

    (g.state as any).phase = GamePhase.COMBAT;
    (g.state as any).step = GameStep.DECLARE_ATTACKERS;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;
    (g.state as any).stack = [];
    (g.state as any).attackersDeclaredBy = [];

    const blocked = g.passPriority(p1);
    expect(blocked.changed).toBe(false);
    expect(blocked.advanceStep).toBe(false);
    expect(g.state.priority).toBe(p1);
    expect(String((g.state as any).step || '').toUpperCase()).toBe('DECLARE_ATTACKERS');
  });

  it('does not advance to declare blockers when all opponents pass without attacker declaration', () => {
    const g = createInitialGameState('declare_attackers_no_skip');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'Attacker' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'Defender' });

    g.createToken(p1, 'Goblin', 1, 2, 1);

    (g.state as any).phase = GamePhase.COMBAT;
    (g.state as any).step = GameStep.DECLARE_ATTACKERS;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p2;
    (g.state as any).stack = [];
    (g.state as any).attackersDeclaredBy = [];
    (g.state as any).priorityPassedBy = new Set([p1]);

    const result = g.passPriority(p2, true);
    expect(result.advanceStep).toBe(false);
    expect(String((g.state as any).step || '').toUpperCase()).toBe('DECLARE_ATTACKERS');
    expect(g.state.priority).toBe(p1);
  });

  it('allows advancing after turn player declares attackers and all players pass', () => {
    const g = createInitialGameState('declare_attackers_after_declare');

    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent({ type: 'join', playerId: p1, name: 'Attacker' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'Defender' });

    (g.state as any).phase = GamePhase.COMBAT;
    (g.state as any).step = GameStep.DECLARE_ATTACKERS;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;
    (g.state as any).stack = [];
    (g.state as any).attackersDeclaredBy = [p1];

    g.passPriority(p1);
    expect(g.state.priority).toBe(p2);

    const result = g.passPriority(p2);
    expect(result.advanceStep).toBe(true);
  });
});