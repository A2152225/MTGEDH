import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { createEmptyStepLedger } from '../src/oracleIRStepLedger.js';
import { createOracleIRServerExecutionBridge } from '../../server/src/state/modules/oracleIrTransitionPipeline.js';
import type { OracleIRTransitionHaltState } from '../src/oracleIRExecutionTypes.js';
import { inferOracleIrTargetBinding, oracleIrTargetBindingToBaseContext } from '../src/oracleIrTargetBinding.js';
import { evaluateConditionalWrapperCondition } from '../src/oracleIRExecutorConditionalStepSupport.js';
import { isSpellEffectFullyIrWired } from '../../server/src/state/modules/oracleIrSpellLegacyRouting.js';

const CHAOS_WARP_TEXT =
  "The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it's a permanent card, they put it onto the battlefield.";

const JAHEIRA_TEXT =
  "Search your library for up to X basic land cards, where X is the number of creatures attacking you, put those cards onto the battlefield tapped, then shuffle.\nPrevent all combat damage that would be dealt this turn.";

describe('Chaos Warp and Jaheira Respite spell IR', () => {
  it('parses Chaos Warp as fully wired shuffle-reveal-conditional ETB steps', () => {
    expect(isSpellEffectFullyIrWired(CHAOS_WARP_TEXT, 'Chaos Warp')).toBe(true);
    const ir = parseOracleTextToIR(CHAOS_WARP_TEXT, 'Chaos Warp');
    expect(ir.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'move_zone',
        what: { kind: 'raw', text: 'target permanent' },
        to: 'library',
      }),
      expect.objectContaining({
        kind: 'reveal_top',
        who: { kind: 'owner_of_referenced_object' },
      }),
      expect.objectContaining({
        kind: 'conditional',
        condition: { kind: 'if', raw: "it's a permanent card" },
        steps: [
          expect.objectContaining({
            kind: 'move_zone',
            what: { kind: 'raw', text: 'it' },
            to: 'battlefield',
          }),
        ],
      }),
    ]);
  });

  it("parses Jaheira's Respite search with where-X attackers and prevent damage", () => {
    expect(isSpellEffectFullyIrWired(JAHEIRA_TEXT, "Jaheira's Respite")).toBe(true);
    const ir = parseOracleTextToIR(JAHEIRA_TEXT, "Jaheira's Respite");
    const searchStep = ir.abilities[0]?.steps[0] as any;
    expect(searchStep).toMatchObject({
      kind: 'search_library',
      destination: 'battlefield',
      entersTapped: true,
      optional: true,
      whereX: { kind: 'where', raw: 'the number of creatures attacking you' },
    });
    expect(ir.abilities[1]?.steps[0]).toMatchObject({
      kind: 'prevent_damage',
      combatOnly: true,
      amount: 'all',
    });
  });

  it("evaluates it's a permanent card as true for a revealed creature", () => {
    const state: any = {
      players: [
        {
          id: 'p_opp',
          library: [{ id: 'revealed_creature', name: 'Elite Vanguard', type_line: 'Creature — Human Soldier' }],
        },
      ],
      battlefield: [],
    };
    const card = { id: 'revealed_creature', name: 'Elite Vanguard', type_line: 'Creature — Human Soldier' };
    const evaluation = evaluateConditionalWrapperCondition({
      condition: { kind: 'if', raw: "it's a permanent card" },
      nextState: state,
      controllerId: 'p_caster' as PlayerID,
      ctx: {
        controllerId: 'p_caster' as PlayerID,
        lastMovedCards: [card],
        lastRevealedCards: [card],
        lastTopLibraryOwnerId: 'p_opp' as PlayerID,
      },
      lastActionOutcome: { kind: 'applied', stepKind: 'reveal_top' },
      lastMovedCards: [card],
    });
    expect(evaluation).toBe(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function executeChaosWarp(args: {
    readonly opponentLibrary: readonly any[];
    readonly casterLibrary?: readonly any[];
    readonly targetController?: string;
    readonly targetOwner?: string;
    readonly serverBridgeFactory?: (state: any, ledger: any, haltState: OracleIRTransitionHaltState) => any;
  }) {
    const ir = parseOracleTextToIR(CHAOS_WARP_TEXT, 'Chaos Warp');
    const steps = ir.abilities[0]?.steps || [];
    const targetController = args.targetController || 'p_opp';
    const targetOwner = args.targetOwner || 'p_opp';

    const state: any = {
      players: [
        { id: 'p_caster', hand: [], graveyard: [], exile: [], library: [...(args.casterLibrary || [])] },
        {
          id: 'p_opp',
          hand: [],
          graveyard: [],
          exile: [],
          library: [...args.opponentLibrary],
        },
      ],
      battlefield: [
        {
          id: 'target_perm',
          controller: targetController,
          owner: targetOwner,
          card: {
            id: 'target_card',
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
          },
        },
      ],
    };

    const ledger = createEmptyStepLedger();
    const haltState: OracleIRTransitionHaltState = { halted: false, deferred: [] };
    const serverBridge = args.serverBridgeFactory
      ? args.serverBridgeFactory(state, ledger, haltState)
      : createOracleIRServerExecutionBridge({
          state,
          ledger,
          interactivePlayerChoices: true,
          haltState,
        });

    const binding = inferOracleIrTargetBinding(state, ['target_perm'], 'p_caster' as PlayerID);
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p_caster' as PlayerID,
      sourceId: 'chaos_warp_card',
      ...oracleIrTargetBindingToBaseContext(binding),
      serverBridge,
      transitionHaltState: haltState,
      stepLedger: ledger,
      appliedStepKinds: new Map(),
    });

    return {
      haltState,
      result: applyOracleIRStepsToGameState(state, steps, ctx, {
        allowOptional: true,
        haltOnPlayerChoiceRequired: true,
      }),
    };
  }

  it('executes Chaos Warp shuffle-reveal-conditional ETB with server bridge', () => {
    // After tucking Bears, Fisher-Yates with random=0 puts Vanguard on top of
    // [Lightning Bolt, Elite Vanguard, Grizzly Bears].
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const { result, haltState } = executeChaosWarp({
      opponentLibrary: [
        { id: 'library_bolt', name: 'Lightning Bolt', type_line: 'Instant' },
        { id: 'revealed_creature', name: 'Elite Vanguard', type_line: 'Creature — Human Soldier' },
      ],
    });

    expect(result.appliedSteps.map((step) => step.kind)).toEqual([
      'move_zone',
      'reveal_top',
      'move_zone',
    ]);
    expect(result.skippedSteps).toHaveLength(0);
    expect(haltState.halted).toBe(false);
    const battlefield = ((result.state as any).battlefield || []) as any[];
    expect(battlefield.some((perm) => String(perm?.id || '') === 'target_perm')).toBe(false);
    expect(battlefield.some((perm) => String(perm?.card?.name || '') === 'Elite Vanguard')).toBe(true);
  });

  it('does not put a revealed instant onto the battlefield', () => {
    // Two-card library after tuck: [Lightning Bolt, Grizzly Bears]. random≈1 leaves Bolt on top.
    vi.spyOn(Math, 'random').mockReturnValue(0.999);

    const { result } = executeChaosWarp({
      opponentLibrary: [{ id: 'library_bolt', name: 'Lightning Bolt', type_line: 'Instant' }],
    });

    const battlefield = ((result.state as any).battlefield || []) as any[];
    expect(battlefield).toHaveLength(0);
    const oppLibrary = ((result.state as any).players || []).find((player: any) => player.id === 'p_opp')?.library || [];
    expect(oppLibrary.map((card: any) => String(card?.name || ''))).toContain('Lightning Bolt');
    expect(oppLibrary.map((card: any) => String(card?.id || ''))).toContain('target_card');
  });

  it('reveals from the owner library when the target is controlled by someone else', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const { result } = executeChaosWarp({
      targetController: 'p_caster',
      targetOwner: 'p_opp',
      casterLibrary: [{ id: 'caster_bolt', name: 'Lightning Bolt', type_line: 'Instant' }],
      opponentLibrary: [
        { id: 'library_bolt', name: 'Lightning Bolt', type_line: 'Instant' },
        { id: 'revealed_creature', name: 'Elite Vanguard', type_line: 'Creature — Human Soldier' },
      ],
    });

    const battlefield = ((result.state as any).battlefield || []) as any[];
    expect(battlefield.some((perm) => String(perm?.card?.name || '') === 'Elite Vanguard')).toBe(true);
    expect(battlefield.some((perm) => String(perm?.card?.name || '') === 'Lightning Bolt')).toBe(false);
  });

  it('still puts the revealed permanent onto the battlefield when library observation would halt', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const { result, haltState } = executeChaosWarp({
      opponentLibrary: [
        { id: 'library_bolt', name: 'Lightning Bolt', type_line: 'Instant' },
        { id: 'revealed_creature', name: 'Elite Vanguard', type_line: 'Creature — Human Soldier' },
      ],
      serverBridgeFactory: () => ({
        proposeTransitions: (transitions: readonly any[]) => {
          const observationOnly = (Array.isArray(transitions) ? transitions : []).every(
            (transition) =>
              String(transition?.event?.sourceZone || '') === 'library' &&
              String(transition?.event?.destinationZone || '') === 'library',
          );
          if (observationOnly && (transitions?.length || 0) > 0) {
            return { halt: true, deferred: [] };
          }
          return { halt: false, ready: transitions };
        },
      }),
    });

    expect(haltState.halted).toBe(false);
    const battlefield = ((result.state as any).battlefield || []) as any[];
    expect(battlefield.some((perm) => String(perm?.card?.name || '') === 'Elite Vanguard')).toBe(true);
  });
});
