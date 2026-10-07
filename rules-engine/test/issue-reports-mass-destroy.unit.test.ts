import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src/index.js';
import { applyDestroyStep } from '../src/oracleIRExecutorBattlefieldStepHandlers.js';
import { moveBattlefieldPermanentsByIdToOwnersHands } from '../src/oracleIRExecutorBattlefieldOps.js';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';
import { executeTriggeredAbilityEffectWithOracleIR } from '../src/triggeredAbilitiesExecution.js';
import type { OracleIRPendingTransition } from '../src/oracleIRTransitionTypes.js';

const p1 = 'p1';
const p2 = 'p2';

function creature(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    controller: p1,
    owner: p1,
    type_line: 'Creature — Bear',
    card: { id: `${id}_card`, name: id, type_line: 'Creature — Bear', cmc: 2 },
    ...extra,
  };
}

describe('mass destroy with a deferred commander replacement', () => {
  it('destroys non-commanders while the commander stays for the command-zone choice', () => {
    const state = {
      players: [
        { id: p1, graveyard: [] },
        { id: p2, graveyard: [] },
      ],
      battlefield: [
        creature('bear'),
        creature('giada', {
          isCommander: true,
          type_line: 'Legendary Creature — Angel',
          card: { id: 'giada_card', name: 'Giada', type_line: 'Legendary Creature — Angel', cmc: 2 },
        }),
      ],
    } as GameState;

    const result = applyDestroyStep(
      state,
      {
        kind: 'destroy',
        target: { kind: 'raw', text: 'all creatures' },
        raw: 'destroy all creatures',
      } as any,
      {
        controllerId: p1,
        sourceId: 'nova',
        currentStepIndex: 0,
        serverBridge: {
          proposeTransitions(transitions: readonly OracleIRPendingTransition[]) {
            const deferred = transitions.filter((transition) =>
              transition.snapshotSubjects.some((subject) => subject.objectId === 'giada' || subject.isCommander),
            );
            const ready = transitions.filter((transition) => !deferred.includes(transition));
            return { halt: deferred.length > 0, deferred, ready };
          },
        },
      } as any,
    );

    expect(result.applied).toBe(true);
    const ids = (result.state?.battlefield || []).map((perm: any) => perm.id);
    expect(ids).toContain('giada');
    expect(ids).not.toContain('bear');
  });

  it('destroys only creatures with mana value 3 or less', () => {
    const state = {
      players: [{ id: p1, graveyard: [] }],
      battlefield: [
        creature('small', { card: { name: 'Small', type_line: 'Creature', cmc: 2 } }),
        creature('three', { card: { name: 'Three', type_line: 'Creature', cmc: 3 } }),
        creature('big', { card: { name: 'Big', type_line: 'Creature', cmc: 5 } }),
        {
          id: 'plains',
          controller: p1,
          owner: p1,
          type_line: 'Basic Land — Plains',
          card: { name: 'Plains', type_line: 'Basic Land — Plains', cmc: 0 },
        },
      ],
    } as GameState;

    const result = applyDestroyStep(
      state,
      {
        kind: 'destroy',
        target: { kind: 'raw', text: 'all creatures with mana value 3 or less' },
        raw: 'destroy all creatures with mana value 3 or less',
      } as any,
      { controllerId: p1, sourceId: 'austere' } as any,
    );

    expect(result.applied).toBe(true);
    expect(result.reason).toBeUndefined();
    const ids = (result.state?.battlefield || []).map((perm: any) => perm.id).sort();
    expect(ids).toEqual(['big', 'plains']);
  });

  it('leaves flying creatures indestructible under Sephara and still destroys Sephara', () => {
    const sepharaOracle =
      'Flying, lifelink\nOther creatures you control with flying have indestructible.';
    const state = {
      players: [
        { id: p1, graveyard: [] },
        { id: p2, graveyard: [] },
      ],
      battlefield: [
        creature('sephara', {
          card: {
            name: 'Sephara, Sky\'s Blade',
            type_line: 'Legendary Creature — Angel',
            oracle_text: sepharaOracle,
            keywords: ['Flying', 'Lifelink'],
            cmc: 7,
          },
          keywords: ['Flying'],
          type_line: 'Legendary Creature — Angel',
        }),
        creature('giada', {
          card: {
            name: 'Giada, Font of Hope',
            type_line: 'Legendary Creature — Angel',
            keywords: ['Flying'],
            cmc: 2,
          },
          keywords: ['Flying'],
          type_line: 'Legendary Creature — Angel',
        }),
        creature('bear'),
        creature('opp-angel', {
          controller: p2,
          owner: p2,
          keywords: ['Flying'],
          type_line: 'Creature — Angel',
          card: { name: 'Angel', type_line: 'Creature — Angel', keywords: ['Flying'], cmc: 3 },
        }),
      ],
    } as GameState;

    const result = applyDestroyStep(
      state,
      {
        kind: 'destroy',
        target: { kind: 'raw', text: 'all creatures' },
        raw: 'destroy all creatures',
      } as any,
      { controllerId: p1, sourceId: 'nova' } as any,
    );

    const ids = (result.state?.battlefield || []).map((perm: any) => perm.id);
    expect(ids).toContain('giada');
    expect(ids).not.toContain('sephara');
    expect(ids).not.toContain('bear');
    expect(ids).not.toContain('opp-angel');
    expect(result.log?.some((line) => /Giada/.test(line) && /indestructible/i.test(line))).toBe(true);
  });

  it('leaves a commander on the battlefield when a bounce defers the hand replacement', () => {
    const state = {
      players: [
        { id: p1, hand: [], graveyard: [] },
        { id: p2, hand: [], graveyard: [] },
      ],
      battlefield: [
        creature('bear'),
        creature('giada', { isCommander: true }),
      ],
    } as GameState;

    const result = moveBattlefieldPermanentsByIdToOwnersHands(state, ['bear', 'giada'], {
      controllerId: p1,
      sourceId: 'evac',
      currentStepIndex: 0,
      serverBridge: {
        proposeTransitions(transitions: readonly OracleIRPendingTransition[]) {
          const deferred = transitions.filter((transition) =>
            transition.snapshotSubjects.some((subject) => subject.isCommander || subject.objectId === 'giada'),
          );
          const ready = transitions.filter((transition) => !deferred.includes(transition));
          return { halt: true, deferred, ready };
        },
      },
    } as any);

    const ids = (result.state?.battlefield || []).map((perm: any) => perm.id);
    expect(ids).toEqual(['giada']);
    const hand = ((result.state as any).players || []).find((player: any) => player.id === p1)?.hand || [];
    expect(hand.map((card: any) => card.name || card.id)).toContain('bear');
  });
});

describe('Emeria Shepherd landfall text', () => {
  it('offers hand or battlefield when the Plains is bound beside the target', () => {
    const result = executeTriggeredAbilityEffectWithOracleIR(
      {
        players: [
          {
            id: p1,
            name: 'P1',
            seat: 0,
            life: 40,
            library: [],
            hand: [],
            graveyard: [{ id: 'relic', name: 'Testing Relic', type_line: 'Artifact' }],
            exile: [],
          },
        ],
        battlefield: [
          {
            id: 'plains1',
            ownerId: p1,
            controller: p1,
            name: 'Plains',
            type_line: 'Basic Land — Plains',
            tapped: false,
            counters: {},
          },
        ],
        priority: p1,
        turnPlayer: p1,
      } as GameState,
      {
        controllerId: p1,
        sourceId: 'emeria',
        sourceName: 'Emeria Shepherd',
        effect:
          'You may return target nonland permanent card from your graveyard to your hand. If that land is a Plains, you may return that nonland permanent card to the battlefield instead.',
      },
      {
        targetPermanentId: 'relic',
        chosenObjectIds: ['relic', 'plains1'],
      },
      { allowOptional: true },
    );

    const player = (result.state.players || []).find((entry: any) => entry.id === p1) as any;
    const destinations = (result.automationGaps || [])
      .map((gap) => (gap.metadata as { moveZoneDestinationChoice?: string[] } | undefined)?.moveZoneDestinationChoice)
      .find((choice) => Array.isArray(choice));
    expect((player?.graveyard || []).map((card: any) => card.id)).toEqual(['relic']);
    expect((player?.hand || []).map((card: any) => card.id)).toEqual([]);
    expect(destinations).toEqual(['battlefield', 'hand']);

    const handStep = result.pendingOptionalSteps?.[0];
    const chosen = applyOracleIRStepsToGameState(result.state, handStep ? [handStep] : [], {
      controllerId: p1,
      sourceId: 'emeria',
      sourceName: 'Emeria Shepherd',
      targetPermanentId: 'relic',
      selectorContext: {
        chosenObjectIds: ['relic', 'plains1'],
        moveZoneDestination: 'hand',
      },
    }, { allowOptional: true });
    const after = (chosen.state.players || []).find((entry: any) => entry.id === p1) as any;
    expect((after?.hand || []).map((card: any) => card.id)).toEqual(['relic']);
    expect((chosen.state.battlefield || []).some(
      (perm: any) => String(perm?.card?.id || perm?.id || '') === 'relic',
    )).toBe(false);
  });
});
