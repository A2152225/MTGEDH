import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { resolveTriggerStackItemEffectText } from '../src/state/modules/triggerStackItemEffectText.js';
import { isTriggerEffectOwnedByOracleIrPrimary } from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import { parseTriggerEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';

describe('Door of Destinies Oracle IR primary', () => {
  const doorOracle =
    'As Door of Destinies enters the battlefield, choose a creature type.\n' +
    'Whenever you cast a spell of the chosen type, put a charge counter on Door of Destinies.\n' +
    'Creatures you control of the chosen type get +1/+1 for each charge counter on Door of Destinies.';

  let previousPrimary: string | undefined;

  beforeEach(() => {
    previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  });

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
  });

  it('parses charge-counter trigger effect as a single wired add_counter step', () => {
    const effectText = 'put a charge counter on Door of Destinies';
    const steps = parseTriggerEffectSteps(effectText, 'Door of Destinies');
    expect(steps).toEqual([
      expect.objectContaining({ kind: 'add_counter', counter: 'charge' }),
    ]);
    expect(isTriggerEffectOwnedByOracleIrPrimary(effectText, 'Door of Destinies')).toBe(true);
  });

  it('does not parse static lord tail from malformed stack description', () => {
    const malformed =
      'Whenever you cast a spell of the chosen type, put a charge counter on Door of Destinies. Creatures you control of the chosen type get +1/+1 for each charge counter on Door of Destinies.';
    const effectText = resolveTriggerStackItemEffectText({
      triggerType: 'cast_creature_type',
      description: malformed,
    });
    expect(effectText).toBe('put a charge counter on Door of Destinies');

    const steps = parseTriggerEffectSteps(effectText, 'Door of Destinies');
    expect(steps.some((step) => step.kind === 'modify_pt')).toBe(false);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);

    const rawSteps = parseTriggerEffectSteps(malformed, 'Door of Destinies');
    expect(rawSteps.some((step) => step.kind === 'modify_pt')).toBe(false);
    expect(rawSteps.some((step) => step.kind === 'unknown')).toBe(false);
  });

  it('puts charge counter on Door via IR primary when resolving trigger', () => {
    const gameId = 't_door_ir_primary';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const doorId = 'door_1';
    (game.state as any).battlefield = [
      {
        id: doorId,
        controller: p1,
        owner: p1,
        chosenCreatureType: 'Merfolk',
        counters: {},
        card: {
          id: 'card_door',
          name: 'Door of Destinies',
          type_line: 'Artifact',
          oracle_text: doorOracle,
        },
      },
    ];

    executeTriggerEffect(
      game as any,
      p1,
      'Door of Destinies',
      'put a charge counter on Door of Destinies',
      {
        source: doorId,
        permanentId: doorId,
        sourceId: doorId,
        triggerType: 'cast_creature_type',
      },
    );

    const door = ((game.state as any).battlefield || []).find((perm: any) => perm.id === doorId);
    expect(door?.counters?.charge).toBe(1);
  });

  it('resolves charge counter when malformed description is passed without effect-text extraction', () => {
    const gameId = 't_door_malformed_ir_primary';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const doorId = 'door_1';
    const malformed =
      'Whenever you cast a spell of the chosen type, put a charge counter on Door of Destinies. Creatures you control of the chosen type get +1/+1 for each charge counter on Door of Destinies.';

    (game.state as any).battlefield = [
      {
        id: doorId,
        controller: p1,
        owner: p1,
        chosenCreatureType: 'Merfolk',
        counters: {},
        card: {
          id: 'card_door',
          name: 'Door of Destinies',
          type_line: 'Artifact',
          oracle_text: doorOracle,
        },
      },
    ];

    executeTriggerEffect(
      game as any,
      p1,
      'Door of Destinies',
      malformed,
      {
        source: doorId,
        permanentId: doorId,
        sourceId: doorId,
        triggerType: 'cast_creature_type',
      },
    );

    const door = ((game.state as any).battlefield || []).find((perm: any) => perm.id === doorId);
    expect(door?.counters?.charge).toBe(1);
  });

  it('puts charge counter on Door without explicit sourceId binding', () => {
    const gameId = 't_door_no_source_id';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const doorId = 'door_1';
    (game.state as any).battlefield = [
      {
        id: doorId,
        controller: p1,
        owner: p1,
        chosenCreatureType: 'Merfolk',
        counters: {},
        card: {
          id: 'card_door',
          name: 'Door of Destinies',
          type_line: 'Artifact',
          oracle_text: doorOracle,
        },
      },
    ];

    executeTriggerEffect(
      game as any,
      p1,
      'Door of Destinies',
      'put a charge counter on Door of Destinies',
      {
        source: doorId,
        permanentId: doorId,
        triggerType: 'cast_creature_type',
      },
    );

    const door = ((game.state as any).battlefield || []).find((perm: any) => perm.id === doorId);
    expect(door?.counters?.charge).toBe(1);
  });

  it('parses full card oracle without unknown steps on static lord', () => {
    const ir = parseOracleTextToIR(doorOracle, 'Door of Destinies');
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);
  });
});
