import { describe, expect, it } from 'vitest';

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

  it('executes Chaos Warp shuffle-reveal-conditional ETB with server bridge', () => {
    const ir = parseOracleTextToIR(CHAOS_WARP_TEXT, 'Chaos Warp');
    const steps = ir.abilities[0]?.steps || [];

    const state: any = {
      players: [
        { id: 'p_caster', hand: [], graveyard: [], exile: [], library: [] },
        {
          id: 'p_opp',
          hand: [],
          graveyard: [],
          exile: [],
          library: [
            {
              id: 'revealed_creature',
              name: 'Elite Vanguard',
              type_line: 'Creature — Human Soldier',
            },
          ],
        },
      ],
      battlefield: [
        {
          id: 'target_perm',
          controller: 'p_opp',
          owner: 'p_opp',
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
    const serverBridge = createOracleIRServerExecutionBridge({
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

    const result = applyOracleIRStepsToGameState(state, steps, ctx, {
      allowOptional: true,
      haltOnPlayerChoiceRequired: true,
    });

    expect(result.appliedSteps.map((step) => step.kind)).toEqual([
      'move_zone',
      'reveal_top',
      'move_zone',
      'conditional',
    ]);
    expect(result.skippedSteps).toHaveLength(0);
    expect(haltState.halted).toBe(false);
    expect(
      (result.state as any).battlefield.some(
        (perm: any) => String(perm?.card?.name || '') === 'Elite Vanguard',
      ),
    ).toBe(true);
  });
});
