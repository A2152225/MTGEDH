import { describe, expect, it } from 'vitest';

import type { PlayerID, TargetRef } from '../../shared/src/index.js';
import { categorizeSpell } from '../src/rules-engine/targeting.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';

const MINDSKINNER_ORACLE =
  'If a source you control would deal damage to an opponent, prevent that damage and each opponent mills cards equal to the amount of damage prevented this way.';

function makeLibrary(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}_lib_${i}`,
    name: `${prefix} Card ${i}`,
    type_line: 'Instant',
    zone: 'library',
  }));
}

/**
 * Spec conflict: CR 103.7a skips the starting player's first draw, so a fixed
 * nextStep count no longer lands on DECLARE_BLOCKERS. Walk to that step, then
 * assign attackers before the DAMAGE transition.
 */
function normalizeStepName(step: string): string {
  return String(step || '').toUpperCase().replace(/_/g, '');
}

function advanceToStep(game: ReturnType<typeof createInitialGameState>, targetStep: string, maxSteps = 20) {
  const wanted = normalizeStepName(targetStep);
  for (let i = 0; i < maxSteps; i += 1) {
    if (normalizeStepName(String((game.state as any).step || '')) === wanted) return;
    game.applyEvent!({ type: 'nextStep' } as any);
  }
}

function addMindskinner(game: ReturnType<typeof createInitialGameState>, controller: PlayerID) {
  (game.state as any).battlefield.push({
    id: 'mindskinner_perm',
    controller,
    owner: controller,
    tapped: false,
    card: {
      id: 'mindskinner_card',
      name: 'The Mindskinner',
      type_line: 'Creature — Horror',
      oracle_text: MINDSKINNER_ORACLE,
    },
  });
}

describe('Mindskinner damage replacement (integration)', () => {
  it('prevents spell damage to an opponent and mills each opponent', () => {
    const game = createInitialGameState('mindskinner_spell_prevent');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.applyEvent!({ type: 'join', playerId: p3, name: 'P3' } as any);

    game.importDeckResolved(p2, makeLibrary('p2', 5) as any);
    game.importDeckResolved(p3, makeLibrary('p3', 5) as any);

    addMindskinner(game, p1);

    const startP2Life = game.state.life[p2];
    const startP3Life = game.state.life[p3];
    const spec = categorizeSpell('Shock', 'Shock deals 2 damage to any target.')!;

    game.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'shock',
      spec,
      chosen: [{ kind: 'player', id: p2 } as TargetRef],
    });

    expect(game.state.life[p2]).toBe(startP2Life);
    expect(game.state.life[p3]).toBe(startP3Life);
    expect(game.state.zones?.[p2]?.graveyardCount).toBe(2);
    expect(game.state.zones?.[p3]?.graveyardCount).toBe(2);
    expect(game.libraries.get(p2)?.length).toBe(3);
    expect(game.libraries.get(p3)?.length).toBe(3);
  });

  it('does not prevent damage when Mindskinner is absent', () => {
    const game = createInitialGameState('mindskinner_spell_absent');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.importDeckResolved(p2, makeLibrary('p2', 5) as any);

    const startP2Life = game.state.life[p2];
    const spec = categorizeSpell('Shock', 'Shock deals 2 damage to any target.')!;

    game.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'shock',
      spec,
      chosen: [{ kind: 'player', id: p2 } as TargetRef],
    });

    expect(game.state.life[p2]).toBe(startP2Life - 2);
    expect(game.state.zones?.[p2]?.graveyardCount ?? 0).toBe(0);
  });

  it('prevents unblocked combat damage to an opponent and mills each opponent', () => {
    const game = createInitialGameState('mindskinner_combat_prevent');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.applyEvent!({ type: 'nextTurn' } as any);

    game.importDeckResolved(p1, makeLibrary('p1', 10) as any);
    game.importDeckResolved(p2, makeLibrary('p2', 10) as any);

    const active = game.state.turnPlayer as PlayerID;
    const defending = active === p1 ? p2 : p1;

    addMindskinner(game, active);

    (game as any).createToken(active, 'Mindskinner Attacker', 1, 3, 3);
    const attacker = (game.state.battlefield || []).find(
      (perm: any) => perm?.card?.name === 'Mindskinner Attacker' && perm?.controller === active
    ) as any;
    expect(attacker).toBeTruthy();

    advanceToStep(game, 'DECLARE_ATTACKERS');
    attacker.attacking = defending;
    attacker.blockedBy = [];
    (game.state as any).attackersDeclaredBy = [active];

    const startDefendingLife = game.state.life[defending];
    game.applyEvent!({ type: 'nextStep' } as any);
    game.applyEvent!({ type: 'nextStep' } as any);

    expect(game.state.life[defending]).toBe(startDefendingLife);
    expect(game.state.zones?.[defending]?.graveyardCount).toBe(3);
    expect(game.libraries.get(defending)?.length).toBe(7);
  });

  it('does not queue deals-damage triggers when damage is fully prevented', () => {
    const game = createInitialGameState('mindskinner_no_damage_trigger');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    addMindskinner(game, p1);

    (game.state as any).battlefield.push({
      id: 'pinger_perm',
      controller: p1,
      owner: p1,
      tapped: false,
      summoningSickness: false,
      basePower: 1,
      baseToughness: 1,
      card: {
        id: 'pinger_card',
        name: 'Curious Pinger',
        type_line: 'Creature',
        oracle_text:
          'Whenever this creature deals damage to a player, draw a card.',
        power: '1',
        toughness: '1',
      },
    });

    game.importDeckResolved(
      p2,
      Array.from({ length: 6 }, (_, i) => ({
        id: `p2_lib_${i}`,
        name: `Card ${i}`,
        type_line: 'Instant',
        zone: 'library',
      })) as any
    );

    executeTriggerEffect(
      game as any,
      p1,
      'Curious Pinger',
      'Curious Pinger deals 2 damage to each opponent',
      {
        type: 'triggered_ability',
        controller: p1,
        source: 'pinger_perm',
        permanentId: 'pinger_perm',
        triggerType: 'ability',
      }
    );

    const queued = ((game.state as any).stack || []).filter(
      (item: any) =>
        item?.type === 'triggered_ability' &&
        item?.source === 'pinger_perm' &&
        item?.triggerType === 'deals_damage'
    );
    expect(queued).toHaveLength(0);
    expect(game.state.life[p2]).toBe(40);
    expect(game.state.zones?.[p2]?.graveyardCount).toBe(2);
  });

  it('does not queue deals-combat-damage triggers when combat damage is fully prevented', () => {
    const game = createInitialGameState('mindskinner_no_combat_damage_trigger');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    game.applyEvent!({ type: 'nextTurn' } as any);

    game.importDeckResolved(p1, makeLibrary('p1', 10) as any);
    game.importDeckResolved(p2, makeLibrary('p2', 10) as any);

    const active = game.state.turnPlayer as PlayerID;
    const defending = active === p1 ? p2 : p1;

    addMindskinner(game, active);

    (game as any).createToken(active, 'Combat Drawer', 1, 3, 3);
    const attacker = (game.state.battlefield || []).find(
      (perm: any) => perm?.card?.name === 'Combat Drawer' && perm?.controller === active
    ) as any;
    expect(attacker).toBeTruthy();
    attacker.card.oracle_text =
      'Whenever this creature deals combat damage to a player, draw a card.';

    advanceToStep(game, 'DECLARE_ATTACKERS');
    attacker.attacking = defending;
    attacker.blockedBy = [];
    (game.state as any).attackersDeclaredBy = [active];

    const startHand = game.state.zones?.[active]?.handCount ?? 0;
    game.applyEvent!({ type: 'nextStep' } as any);
    game.applyEvent!({ type: 'nextStep' } as any);

    const drawTriggers = ((game.state as any).stack || []).filter(
      (item: any) =>
        item?.type === 'triggered_ability' &&
        item?.source === attacker.id &&
        (item?.triggerType === 'deals_combat_damage' || /draw a card/i.test(String(item?.description || '')))
    );
    expect(drawTriggers).toHaveLength(0);
    expect(game.state.life[defending]).toBe(40);
    expect(game.state.zones?.[defending]?.graveyardCount).toBe(3);
    expect(game.state.zones?.[active]?.handCount ?? 0).toBe(startHand);
  });

  it('does not prevent damage dealt to self', () => {
    const game = createInitialGameState('mindskinner_self_damage');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);
    addMindskinner(game, p1);

    const startP1Life = game.state.life[p1];
    const spec = categorizeSpell('Pain', 'Pain deals 3 damage to target player.')!;

    game.applyEvent!({
      type: 'resolveSpell',
      caster: p1,
      cardId: 'pain',
      spec,
      chosen: [{ kind: 'player', id: p1 } as TargetRef],
    });

    expect(game.state.life[p1]).toBe(startP1Life - 3);
  });
});
