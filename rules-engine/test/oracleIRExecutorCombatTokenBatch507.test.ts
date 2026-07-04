import { describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { collectOracleEffectSteps } from '../../server/src/state/modules/trigger-runtime-wiring.js';

describe('Oracle IR batch 507 combat and replacement tokens', () => {
  const p1 = 'p1' as PlayerID;

  it('creates an attacking Cat Soldier token on Brimaz attack trigger', () => {
    const effectText = "create a 1/1 white Cat Soldier creature token with vigilance that's attacking.";
    const steps = collectOracleEffectSteps(effectText, 'Brimaz, King of Oreskos');
    const state = {
      players: [{ id: p1 }, { id: 'p2' }],
      battlefield: [{
        id: 'brimaz',
        controller: p1,
        attacking: 'p2',
        card: { name: 'Brimaz, King of Oreskos', type_line: 'Legendary Creature — Cat Soldier' },
      }],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'brimaz',
      sourceName: 'Brimaz, King of Oreskos',
      sourceObjectType: 'ability',
      selectorContext: { targetPlayerId: 'p2' as PlayerID },
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const token = (result.state as GameState).battlefield?.find((perm) => perm.isToken);

    expect(steps[0]).toMatchObject({ kind: 'create_token', attacking: 'defending_player' });
    expect(token?.attacking).toBe('p2');
    expect(token?.tapped).toBe(false);
  });

  it('creates a blocking Cat Soldier token on Brimaz block trigger', () => {
    const effectText = "create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature.";
    const steps = collectOracleEffectSteps(effectText, 'Brimaz, King of Oreskos');
    const state = {
      players: [{ id: p1 }, { id: 'p2' }],
      battlefield: [
        { id: 'attacker', controller: 'p2', attacking: 'p1', blockedBy: [] as string[] },
        { id: 'brimaz', controller: p1, blocking: ['attacker'], card: { name: 'Brimaz, King of Oreskos' } },
      ],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'brimaz',
      sourceName: 'Brimaz, King of Oreskos',
      sourceObjectType: 'ability',
      selectorContext: { targetPermanentId: 'attacker', chosenObjectIds: ['attacker'] },
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const nextState = result.state as GameState;
    const token = nextState.battlefield?.find((perm) => perm.isToken);
    const attacker = nextState.battlefield?.find((perm) => perm.id === 'attacker');

    expect(steps[0]).toMatchObject({ kind: 'create_token', blocking: 'that_creature' });
    expect(token?.blocking).toEqual(['attacker']);
    expect(attacker?.blockedBy).toContain(String(token?.id || ''));
  });

  it('creates a tapped attacking copy token for exert reward text', () => {
    const effectText = "create a tapped and attacking token that's a copy of target creature you control. sacrifice the token at the beginning of the next end step.";
    const steps = collectOracleEffectSteps(effectText, 'Combat Celebrant');
    const state = {
      players: [{ id: p1 }, { id: 'p2' }],
      battlefield: [
        { id: 'celebrant', controller: p1, attacking: 'p2', card: { name: 'Combat Celebrant', type_line: 'Creature — Human Warrior' } },
        { id: 'target', controller: p1, card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' } },
      ],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'celebrant',
      sourceName: 'Combat Celebrant',
      sourceObjectType: 'ability',
      selectorContext: { targetPermanentId: 'target', chosenObjectIds: ['target'], targetPlayerId: 'p2' as PlayerID },
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const token = (result.state as GameState).battlefield?.find((perm) => perm.isToken);

    expect(token?.attacking).toBe('p2');
    expect(token?.tapped).toBe(true);
    expect(token?.card?.name).toBe('Grizzly Bears');
  });

  it('creates an intervening-if copy token of the entering creature', () => {
    const effectText = "create a token that's a copy of that creature. those tokens gain haste. exile them at the beginning of the next end step.";
    const steps = collectOracleEffectSteps(effectText, 'Mirror March');
    const state = {
      players: [{ id: p1 }],
      battlefield: [{
        id: 'entering',
        controller: p1,
        card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      }],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'mirror',
      sourceName: 'Mirror March',
      sourceObjectType: 'ability',
      selectorContext: { chosenObjectIds: ['entering'], targetPermanentId: 'entering' },
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const token = (result.state as GameState).battlefield?.find((perm) => perm.isToken);

    expect(token?.card?.name).toBe('Grizzly Bears');
    expect(token?.isToken).toBe(true);
  });

  it('registers a lose-the-game replacement instead of drawing immediately', () => {
    const effectText = 'the next time you would lose the game this turn, instead draw three cards and your life total becomes 5.';
    const steps = collectOracleEffectSteps(effectText, 'Nira, Hellkite Duelist');
    const state = {
      players: [{ id: p1 }],
      life: { p1: 2 },
      library: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
    } as GameState;

    const ctx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'nira',
      sourceName: 'Nira, Hellkite Duelist',
      sourceObjectType: 'ability',
    });

    const result = applyOracleIRStepsToGameState(state, steps, ctx, { allowOptional: true });
    const nextState = result.state as any;

    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'register_lose_game_replacement',
        drawCount: 3,
        lifeTotal: 5,
      }),
    ]);
    expect(nextState.pendingLoseGameReplacements).toHaveLength(1);
    expect(nextState.pendingLoseGameReplacements[0]).toMatchObject({
      playerId: 'p1',
      drawCount: 3,
      lifeTotal: 5,
      sourceName: 'Nira, Hellkite Duelist',
    });
    expect(nextState.library).toHaveLength(3);
    expect(nextState.life?.p1).toBe(2);
  });
});
