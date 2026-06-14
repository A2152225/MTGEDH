import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 286 — selector cluster fixes', () => {
  it('executes Gush alternate-cost Island bounce without unsupported_selector', () => {
    const ir = parseOracleTextToIR(
      "You may return two Islands you control to their owner's hand rather than pay this spell's mana cost.\nDraw two cards.",
      'Gush'
    );
    const steps = ir.abilities.find((ability) => ability.steps?.some((step) => step.kind === 'move_zone'))?.steps || [];
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [] }],
      battlefield: [
        { id: 'island-1', name: 'Island', type_line: 'Basic Land — Island', controller: controllerId, owner: controllerId },
        { id: 'island-2', name: 'Island', type_line: 'Basic Land — Island', controller: controllerId, owner: controllerId },
        { id: 'forest-1', name: 'Forest', type_line: 'Basic Land — Forest', controller: controllerId, owner: controllerId },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'spell-gush',
    }, { allowOptional: true });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(2);
    expect((result.state?.battlefield || []).length).toBe(1);
  });

  it('executes Brilliant Restoration return all artifact and enchantment cards from graveyard', () => {
    const ir = parseOracleTextToIR(
      'Return all artifact and enchantment cards from your graveyard to the battlefield.',
      'Brilliant Restoration'
    );
    const steps = ir.abilities[0]?.steps || [];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-artifact', name: 'Sol Ring', type_line: 'Artifact' },
            { id: 'gy-enchantment', name: 'Animate Dead', type_line: 'Enchantment — Aura' },
            { id: 'gy-creature', name: 'Bear', type_line: 'Creature — Bear' },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'spell-brilliant-restoration',
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.appliedSteps?.length).toBe(1);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.length).toBe(1);
    expect((result.state?.battlefield || []).length).toBe(2);
  });

  it('executes Aether Tide return X target creatures to owners hands', () => {
    const ir = parseOracleTextToIR(
      "As an additional cost to cast this spell, discard X creature cards.\nReturn X target creatures to their owners' hands.",
      'Aether Tide'
    );
    const steps =
      ir.abilities.find((ability) => ability.steps?.some((step) => step.kind === 'move_zone'))?.steps || [];
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [] },
        { id: 'p2', library: [], hand: [], graveyard: [] },
      ],
      battlefield: [
        { id: 'creature-1', name: 'Bear', type_line: 'Creature — Bear', controller: controllerId, owner: controllerId },
        { id: 'creature-2', name: 'Elf', type_line: 'Creature — Elf', controller: 'p2', owner: 'p2' },
        { id: 'creature-3', name: 'Goblin', type_line: 'Creature — Goblin', controller: 'p2', owner: 'p2' },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'spell-aether-tide',
      xValue: 2,
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.appliedSteps?.length).toBe(1);
    expect((result.state?.battlefield || []).length).toBe(1);
    const p1Hand = (result.state?.players.find((entry) => entry.id === controllerId) as any)?.hand?.length || 0;
    const p2Hand = (result.state?.players.find((entry) => entry.id === 'p2') as any)?.hand?.length || 0;
    expect(p1Hand + p2Hand).toBe(2);
  });
});
