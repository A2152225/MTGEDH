import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { applyCreatureDamageFromSource, resolvePlayerDamage } from '../src/state/modules/combat-damage-processing.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyPreventDamageStep } from '../../rules-engine/src/oracleIRExecutorDamageStepHandlers.js';
import { previewPreventedDamage } from '../../rules-engine/src/oracleIRDamagePrevention.js';

const PREVENT_ALL_BUT_ORACLE =
  'If a source would deal damage to another Dinosaur you control, prevent all but 1 of that damage.';

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

describe('prevent all but N damage replacement', () => {
  it('caps noncombat damage to another Dinosaur you control', () => {
    const dino = {
      id: 'dino_1',
      controller: 'p1',
      card: { name: 'Other Dino', type_line: 'Creature — Dinosaur' },
      markedDamage: 0,
    };
    const shield = {
      id: 'shield_1',
      controller: 'p1',
      card: {
        name: 'Anonymous Temple',
        type_line: 'Creature — Dinosaur',
        oracle_text: PREVENT_ALL_BUT_ORACLE,
      },
    };
    const ctx = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [dino, shield],
      },
    } as any;

    const result = applyCreatureDamageFromSource(
      ctx,
      { id: 'src_1', controller: 'p2', card: { name: 'Shock' } },
      dino,
      5,
      'markedDamage',
    );

    expect(result.appliedAmount).toBe(1);
    expect(dino.markedDamage).toBe(1);
  });

  it('does not cap damage to the source permanent itself', () => {
    const shield = {
      id: 'shield_1',
      controller: 'p1',
      markedDamage: 0,
      card: {
        name: 'Anonymous Temple',
        type_line: 'Creature — Dinosaur',
        oracle_text: PREVENT_ALL_BUT_ORACLE,
      },
    };
    const ctx = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [shield],
      },
    } as any;

    const result = applyCreatureDamageFromSource(
      ctx,
      { id: 'src_1', controller: 'p2', card: { name: 'Shock' } },
      shield,
      5,
      'markedDamage',
    );

    expect(result.appliedAmount).toBe(5);
    expect(shield.markedDamage).toBe(5);
  });

  it('caps combat damage assigned to another Dinosaur you control', () => {
    const game = createInitialGameState('prevent_all_but_combat');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    game.applyEvent({ type: 'join', playerId: p2, name: 'P2' });
    setupToMain1(game, p1, p2);

    const active = game.state.turnPlayer as PlayerID;
    const defending = active === p1 ? p2 : p1;

    const attacker = {
      id: 'attacker_1',
      controller: active,
      owner: active,
      tapped: false,
      counters: {},
      summoningSickness: false,
      basePower: 5,
      baseToughness: 5,
      card: {
        id: 'attacker_card_1',
        name: 'Big Attacker',
        type_line: 'Creature — Beast',
        oracle_text: '',
        power: '5',
        toughness: '5',
      },
    };
    const blocker = {
      id: 'dino_1',
      controller: defending,
      owner: defending,
      tapped: false,
      counters: {},
      summoningSickness: false,
      markedDamage: 0,
      basePower: 3,
      baseToughness: 4,
      card: {
        id: 'dino_card_1',
        name: 'Other Dino',
        type_line: 'Creature — Dinosaur',
        oracle_text: '',
        power: '3',
        toughness: '4',
      },
    };
    const shield = {
      id: 'shield_1',
      controller: defending,
      owner: defending,
      tapped: false,
      counters: {},
      summoningSickness: false,
      card: {
        id: 'shield_card_1',
        name: 'Anonymous Temple',
        type_line: 'Creature — Dinosaur',
        oracle_text: PREVENT_ALL_BUT_ORACLE,
        power: '3',
        toughness: '4',
      },
    };

    (game.state as any).battlefield = [attacker, blocker, shield];

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
      blockers: [{ blockerId: 'dino_1', attackerId: 'attacker_1' }],
    });
    (game.state as any).blockersDeclaredBy = [defending];
    game.applyEvent({ type: 'nextStep' });

    const after = (game.state.battlefield as any[]).find((perm) => perm.id === 'dino_1');
    expect(Number(after?.markedDamage || 0)).toBe(1);
    expect((game.state.battlefield as any[]).some((perm) => perm.id === 'dino_1')).toBe(true);
  });

  it('caps noncombat damage to a Hero you control, including the source', () => {
    const hyperionOracle =
      'Flash\nFlying\nIf a source would deal damage to you or a Hero you control, prevent all but 1 of that damage.';
    const hero = {
      id: 'hero_1',
      controller: 'p1',
      markedDamage: 0,
      card: {
        name: 'Anonymous Hyperion',
        type_line: 'Legendary Creature — Eternal Hero',
        oracle_text: hyperionOracle,
      },
    };
    const ctx = {
      state: {
        players: [{ id: 'p1' }, { id: 'p2' }],
        battlefield: [hero],
      },
    } as any;

    const result = applyCreatureDamageFromSource(
      ctx,
      { id: 'src_1', controller: 'p2', card: { name: 'Shock' } },
      hero,
      7,
      'markedDamage',
    );

    expect(result.appliedAmount).toBe(1);
    expect(hero.markedDamage).toBe(1);
  });

  it('caps player damage that goes through resolvePlayerDamage', () => {
    const hyperionOracle =
      'If a source would deal damage to you or a Hero you control, prevent all but 1 of that damage.';
    const ctx = {
      state: {
        players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
        life: { p1: 40, p2: 40 },
        battlefield: [{
          id: 'hero_1',
          controller: 'p1',
          card: {
            name: 'Anonymous Hyperion',
            type_line: 'Legendary Creature — Eternal Hero',
            oracle_text: hyperionOracle,
          },
        }],
      },
      life: { p1: 40, p2: 40 },
    } as any;

    const resolved = resolvePlayerDamage(ctx, {
      targetPlayerId: 'p1',
      amount: 7,
      sourcePermanent: { id: 'src_1', controller: 'p2', card: { name: 'Shock' } },
    });

    expect(resolved.damageDealt).toBe(1);
    expect(ctx.state.life.p1).toBe(39);
  });

  it('parses Forcefield as a one-shot combat cap and applies it to the chosen attacker', () => {
    const parsed = parseOracleTextToIR(
      '{1}: The next time an unblocked creature of your choice would deal combat damage to you this turn, prevent all but 1 of that damage.',
    );
    const prevent = parsed.abilities.flatMap((ability) => ability.steps).find((step) => step.kind === 'prevent_damage');
    expect(prevent).toMatchObject({
      kind: 'prevent_damage',
      combatOnly: true,
      leaveAmount: 1,
    });

    const state = {
      turnNumber: 3,
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [{
        id: 'attacker_1',
        controller: 'p2',
        attacking: 'p1',
        blockedBy: [],
        card: { name: 'Big Attacker', type_line: 'Creature — Beast' },
      }],
      stack: [],
    } as any;

    const applied = applyPreventDamageStep(state, prevent as any, {
      controllerId: 'p1',
      sourceId: 'forcefield_1',
      sourceName: 'Anonymous Field',
      targetPermanentId: 'attacker_1',
    } as any);

    expect(applied.applied).toBe(true);
    const preview = previewPreventedDamage(applied.state as any, 5, 'attacker_1', {
      combatDamage: true,
      targetPlayerId: 'p1',
    });
    expect(preview.remainingDamage).toBe(1);
    expect(preview.prevented).toBe(4);
  });
});
