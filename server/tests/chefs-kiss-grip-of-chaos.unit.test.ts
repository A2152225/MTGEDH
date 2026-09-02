import { describe, expect, it } from 'vitest';

import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { applyChangeTargetStep } from '../../rules-engine/src/oracleIRExecutorPlayerStepHandlers.js';
import { parseTargetRequirements } from '../src/rules-engine/targeting-handlers/targetingParseTargetRequirements.js';
import { buildSpellTargetListFromRequirements } from '../src/socket/game-actions-handlers/gameActionsSpellTargetSelection.js';
import { detectStackPutTriggers, queueStackPutTriggers } from '../src/state/modules/triggers/stack-put.js';
import { notifySpellOrAbilityPutOnStack } from '../src/state/modules/stackPutNotify.js';
import { collectLegalRetargetCandidatesForStackItem } from '../src/state/modules/oracleIrRetargetLegalTargets.js';

const GRIP_TEXT =
  'Whenever a spell or ability is put onto the stack, if it has a single target, reselect its target at random. (Select from among all legal targets.)';

const CHEFS_KISS_TEXT =
  "Gain control of target spell that targets only a single permanent or player. Copy it, then reselect the targets at random for the spell and the copy. The new targets can't be you or a permanent you control.";

describe("Chef's Kiss stack targeting", () => {
  it('requires the chosen spell to target only a single permanent or player', () => {
    const reqs = parseTargetRequirements(CHEFS_KISS_TEXT);
    expect(reqs.needsTargets).toBe(true);
    expect(reqs.stackObjectMustTargetOnlySinglePermanentOrPlayer).toBe(true);
    expect(reqs.stackObjectMustHaveSingleTarget).toBeUndefined();

    const game = {
      state: {
        players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
        battlefield: [
          { id: 'perm_bear', controller: 'p2', card: { name: 'Bear', type_line: 'Creature — Bear' } },
        ],
        stack: [
          {
            id: 'stack_bolt',
            type: 'spell',
            controller: 'p2',
            card: { name: 'Lightning Bolt', type_line: 'Instant' },
            targets: [{ id: 'p1', type: 'player' }],
          },
          {
            id: 'stack_double',
            type: 'spell',
            controller: 'p2',
            card: { name: 'Two-Target Spell', type_line: 'Instant' },
            targets: [{ id: 'p1', type: 'player' }, { id: 'perm_bear', type: 'permanent' }],
          },
          {
            id: 'stack_same_twice',
            type: 'spell',
            controller: 'p2',
            card: { name: 'Same Target Twice', type_line: 'Instant' },
            targets: [{ id: 'p1', type: 'player' }, { id: 'p1', type: 'player' }],
          },
        ],
      },
    };

    const ids = buildSpellTargetListFromRequirements(game, 'p1', reqs).map((target) => target.id).sort();
    expect(ids).toEqual(['stack_bolt', 'stack_same_twice']);
  });
});

describe('Grip of Chaos stack-put trigger', () => {
  it('parses to a triggered change_target at random', () => {
    const ir = parseOracleTextToIR(GRIP_TEXT, 'Grip of Chaos');
    const triggered = ir.abilities.find((ability) => ability.type === 'triggered');
    expect(triggered).toBeTruthy();
    const found: any[] = [];
    const walk = (steps: readonly any[] | undefined) => {
      for (const step of steps || []) {
        found.push(step);
        walk(step?.then);
        walk(step?.else);
        walk(step?.steps);
      }
    };
    walk(triggered?.steps);
    expect(found.some((step) => step?.kind === 'change_target' && step?.random === true)).toBe(true);
  });

  it('detects the generic stack-put template from oracle text', () => {
    const triggers = detectStackPutTriggers(
      { name: 'Grip of Chaos', oracle_text: GRIP_TEXT },
      { id: 'perm_grip', controller: 'p1' },
    );
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.effect.toLowerCase()).toMatch(/reselect its target at random/);
  });

  it('queues a trigger when a single-target spell is put on the stack and skips untargeted spells', () => {
    const gripPermanent = {
      id: 'perm_grip',
      controller: 'p1',
      card: { name: 'Grip of Chaos', oracle_text: GRIP_TEXT },
    };
    const state: any = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [gripPermanent],
      stack: [
        {
          id: 'stack_bolt',
          type: 'spell',
          controller: 'p2',
          card: { name: 'Lightning Bolt', type_line: 'Instant' },
          targets: [{ id: 'p1', type: 'player' }],
        },
        {
          id: 'stack_bears',
          type: 'spell',
          controller: 'p2',
          card: { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          targets: [],
        },
      ],
    };

    const ctx = { state, gameId: 'test_grip_of_chaos' } as any;
    const queuedBolt = queueStackPutTriggers(ctx, 'stack_bolt');
    expect(queuedBolt.some((item) => item?.sourceName === 'Grip of Chaos')).toBe(true);
    expect(queuedBolt[0]?.triggeringStackItemId).toBe('stack_bolt');
    expect(queuedBolt[0]?.effect.toLowerCase()).toMatch(/reselect/);

    const before = state.stack.length;
    const queuedBears = queueStackPutTriggers(ctx, 'stack_bears');
    expect(queuedBears).toEqual([]);
    expect(state.stack).toHaveLength(before);
  });

  it('fires on an activated ability put on the stack via notifySpellOrAbilityPutOnStack', () => {
    const gripPermanent = {
      id: 'perm_grip',
      controller: 'p1',
      card: { name: 'Grip of Chaos', oracle_text: GRIP_TEXT },
    };
    const state: any = {
      players: [{ id: 'p1' }, { id: 'p2' }],
      battlefield: [gripPermanent],
      stack: [
        {
          id: 'stack_ability',
          type: 'ability',
          controller: 'p2',
          source: 'perm_prodigal',
          sourceName: 'Prodigal Sorcerer',
          activatedAbilityText: '{T}: Prodigal Sorcerer deals 1 damage to any target.',
          targets: [{ id: 'p1', type: 'player' }],
        },
      ],
    };

    const ctx = { state, gameId: 'test_grip_ability_stack_put' } as any;
    const queued = notifySpellOrAbilityPutOnStack(ctx, 'stack_ability');
    expect(queued).toBeUndefined();
    expect(state.stack.some((item: any) => item?.sourceName === 'Grip of Chaos')).toBe(true);
  });

  it('reselects among legal targets including the original', () => {
    const ir = parseOracleTextToIR(GRIP_TEXT, 'Grip of Chaos');
    const found: any[] = [];
    const walk = (steps: readonly any[] | undefined) => {
      for (const step of steps || []) {
        found.push(step);
        walk(step?.then);
        walk(step?.else);
        walk(step?.steps);
      }
    };
    for (const ability of ir.abilities) walk(ability.steps);
    const changeTarget = found.find((step) => step?.kind === 'change_target');
    expect(changeTarget).toBeTruthy();

    const state = {
      players: [
        { id: 'p1', name: 'P1' },
        { id: 'p2', name: 'P2' },
      ],
      battlefield: [],
      stack: [
        {
          id: 'stack_bolt',
          type: 'spell',
          controller: 'p2',
          card: { name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.' },
          targets: [{ id: 'p1', type: 'player' }],
          copyRetargetValidTargets: [
            { id: 'p1', name: 'P1', type: 'player' },
            { id: 'p2', name: 'P2', type: 'player' },
          ],
        },
      ],
    };

    const result = applyChangeTargetStep(
      state as any,
      changeTarget as Extract<typeof changeTarget, { kind: 'change_target' }>,
      {
        controllerId: 'p1',
        sourceId: 'perm_grip',
        sourceName: 'Grip of Chaos',
        targetSpellId: 'stack_bolt',
      } as any,
    );

    expect(result.applied).toBe(true);
    const nextId = String((result.state as any).stack[0].targets[0]?.id || (result.state as any).stack[0].targets[0]);
    expect(['p1', 'p2']).toContain(nextId);
  });

  it('reselects from live legal targets when copyRetargetValidTargets is missing', () => {
    const ir = parseOracleTextToIR(GRIP_TEXT, 'Grip of Chaos');
    const found: any[] = [];
    const walk = (steps: readonly any[] | undefined) => {
      for (const step of steps || []) {
        found.push(step);
        walk(step?.then);
        walk(step?.else);
        walk(step?.steps);
      }
    };
    walk(ir.abilities.find((ability) => ability.type === 'triggered')?.steps);
    const changeTarget = found.find((step) => step?.kind === 'change_target' && step?.random === true);
    expect(changeTarget).toBeTruthy();

    const state = {
      players: [
        { id: 'p1', name: 'P1' },
        { id: 'p2', name: 'P2' },
      ],
      battlefield: [
        { id: 'perm_bear', controller: 'p2', card: { name: 'Bear', type_line: 'Creature — Bear' } },
      ],
      stack: [
        {
          id: 'stack_bolt',
          type: 'spell',
          controller: 'p2',
          card: {
            name: 'Lightning Bolt',
            type_line: 'Instant',
            oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          },
          targets: [{ id: 'p1', type: 'player' }],
        },
      ],
    };

    const result = applyChangeTargetStep(
      state as any,
      changeTarget as Extract<typeof changeTarget, { kind: 'change_target' }>,
      {
        controllerId: 'p1',
        sourceId: 'perm_grip',
        sourceName: 'Grip of Chaos',
        targetSpellId: 'stack_bolt',
        collectLegalRetargetCandidates: (gameState: any, spell: any, targetingPlayerId: string) =>
          collectLegalRetargetCandidatesForStackItem(gameState, spell, targetingPlayerId),
      } as any,
    );

    expect(result.applied).toBe(true);
    const nextId = String((result.state as any).stack[0].targets[0]?.id || (result.state as any).stack[0].targets[0]);
    expect(['p1', 'p2', 'perm_bear']).toContain(nextId);
  });
});
