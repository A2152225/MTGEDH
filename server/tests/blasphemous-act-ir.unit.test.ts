import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { GameState, PlayerID } from '../../shared/src/index.js';
import { GamePhase } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyDealDamageStep } from '../../rules-engine/src/oracleIRExecutorDamageStepHandlers.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { collectSpellResolutionEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const BLASPHEMOUS_ORACLE =
  'This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature.';

function ensureZonesForPlayer(g: any, pid: PlayerID) {
  (g.state as any).zones = (g.state as any).zones || {};
  (g.state as any).zones[pid] = (g.state as any).zones[pid] || {
    hand: [],
    handCount: 0,
    library: [],
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
    exile: [],
    exileCount: 0,
  };
}

describe('Blasphemous Act spell resolution', () => {
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;
  const previousLegacy = process.env.ORACLE_IR_SPELL_LEGACY;

  beforeEach(() => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
  });

  afterEach(() => {
    if (previousPrimary === undefined) delete process.env.ORACLE_IR_SPELL_PRIMARY;
    else process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    if (previousLegacy === undefined) delete process.env.ORACLE_IR_SPELL_LEGACY;
    else process.env.ORACLE_IR_SPELL_LEGACY = previousLegacy;
  });

  it('classifies the damage line as a spell ability, not static', () => {
    const ir = parseOracleTextToIR(BLASPHEMOUS_ORACLE, 'Blasphemous Act');
    const damageAbility = (ir.abilities || []).find((ability: any) =>
      (ability.steps || []).some((step: any) => step.kind === 'deal_damage'),
    );
    expect(damageAbility).toBeTruthy();
    expect(String(damageAbility?.type || '').toLowerCase()).toBe('spell');
  });

  it('collects deal_damage in spell resolution steps (not cost-reduction static)', () => {
    const steps = collectSpellResolutionEffectSteps(BLASPHEMOUS_ORACLE, 'Blasphemous Act');
    expect(steps.some((step: any) => step.kind === 'deal_damage')).toBe(true);
    expect(steps.every((step: any) => step.kind !== 'grant_static_ability')).toBe(true);
  });

  it('applyDealDamageStep marks 13 damage on each creature', () => {
    const steps = collectSpellResolutionEffectSteps(BLASPHEMOUS_ORACLE, 'Blasphemous Act');
    const step = steps.find((entry: any) => entry.kind === 'deal_damage');
    expect(step).toBeTruthy();

    const state = {
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [], counters: {} },
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [], counters: {} },
      ],
      battlefield: [
        {
          id: 'c1',
          controller: 'p1',
          card: { name: 'Goblin', type_line: 'Creature — Goblin', power: '2', toughness: '2' },
          damageMarked: 0,
        },
        {
          id: 'c2',
          controller: 'p2',
          card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
          damageMarked: 0,
        },
        {
          id: 'l1',
          controller: 'p1',
          card: { name: 'Mountain', type_line: 'Basic Land — Mountain' },
        },
      ],
      stack: [],
    } as GameState;

    const result = applyDealDamageStep(
      state,
      step as any,
      {
        controllerId: 'p1',
        sourceId: 'spell_blasphemous',
        sourceName: 'Blasphemous Act',
        sourceObjectType: 'spell',
      } as any,
    );

    expect(result.applied).toBe(true);
    if (!result.applied) return;

    const creatures = (result.state.battlefield || []).filter((perm: any) =>
      String(perm?.card?.type_line || '').toLowerCase().includes('creature'),
    );
    expect(creatures).toHaveLength(2);
    for (const creature of creatures) {
      expect(Number((creature as any).damageMarked || 0)).toBe(13);
    }
  });

  it('resolves via IR primary and destroys creatures with toughness 2', () => {
    const gameId = 'blasphemous_act_ir_primary';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    g.applyEvent!({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent!({ type: 'join', playerId: p2, name: 'P2' });
    ensureZonesForPlayer(g, p1);
    ensureZonesForPlayer(g, p2);

    const ctx = g as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    g.createToken!(p1, 'Goblin', 1, 2, 2);
    g.createToken!(p2, 'Bear', 1, 2, 2);
    expect(((g.state as any).battlefield || []).filter((p: any) =>
      String(p?.card?.type_line || '').toLowerCase().includes('creature'),
    ).length).toBe(2);

    g.importDeckResolved(p1, [{
      id: 'blasphemous_1',
      name: 'Blasphemous Act',
      type_line: 'Sorcery',
      oracle_text: BLASPHEMOUS_ORACLE,
      mana_cost: '{8}{R}',
    }] as any);
    g.drawCards(p1, 1);
    ensureZonesForPlayer(g, p1);

    (g.state as any).phase = GamePhase.PRECOMBAT_MAIN;
    (g.state as any).turnPlayer = p1;
    (g.state as any).priority = p1;

    g.applyEvent!({
      type: 'castSpell',
      playerId: p1,
      cardId: 'blasphemous_1',
      targets: [],
    });

    expect((g.state as any).stack?.length || 0).toBe(1);
    g.resolveTopOfStack();

    const creatures = ((g.state as any).battlefield || []).filter((p: any) =>
      String(p?.card?.type_line || '').toLowerCase().includes('creature'),
    );
    expect(creatures).toHaveLength(0);
  });
});
