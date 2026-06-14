import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllColoredPermanentsToHand,
  parseMoveZoneCountTargetBattlefieldBounce,
  parseMoveZoneTheRevealedCards,
  parseMoveZoneUnlessPaysManaFromStepText,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 306 — another unless-pays / all colored permanents / revealed to GY', () => {
  it('parses Withdraw another target creature unless pays', () => {
    expect(
      parseMoveZoneCountTargetBattlefieldBounce({
        kind: 'raw',
        text: 'another target creature',
      })
    ).toEqual({ count: 1, selectorText: 'target creature' });
    expect(
      parseMoveZoneUnlessPaysManaFromStepText(
        "Then return another target creature to its owner's hand unless its controller pays {1}",
        "its owner's hand unless its controller pays {1}"
      )
    ).toEqual({ mana: '{1}' });
  });

  it('parses Hibernation all green permanents', () => {
    expect(
      parseMoveZoneAllColoredPermanentsToHand({
        kind: 'raw',
        text: 'all green permanents',
      })
    ).toEqual({ cardType: 'permanent', colorsAnyOf: ['G'] });
  });

  it('parses Dakra Mystic the revealed cards', () => {
    expect(
      parseMoveZoneTheRevealedCards({
        kind: 'raw',
        text: 'the revealed cards',
      })
    ).toBe(true);
  });

  it('executes Withdraw bounce when controller declines to pay', () => {
    const ir = parseOracleTextToIR(
      "Return target creature to its owner's hand. Then return another target creature to its owner's hand unless its controller pays {1}.",
      'Withdraw'
    );
    const steps = ir.abilities[0]?.steps || [];
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [] },
        { id: opponentId, library: [], hand: [], graveyard: [] },
      ],
      battlefield: [
        {
          id: 'bf-withdraw-1',
          name: 'Withdraw Bear',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Bear',
          colors: ['G'],
        },
        {
          id: 'bf-withdraw-2',
          name: 'Withdraw Elf',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Elf',
          colors: ['G'],
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'withdraw',
      selectorContext: {
        chosenObjectIds: ['bf-withdraw-1', 'bf-withdraw-2'],
        unlessPaysManaChoice: 'decline',
      },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(0);
    const opponent = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(opponent.hand.length).toBe(2);
  });

  it('executes Withdraw skip when controller pays unless cost', () => {
    const ir = parseOracleTextToIR(
      "Return target creature to its owner's hand. Then return another target creature to its owner's hand unless its controller pays {1}.",
      'Withdraw'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '').startsWith('another target')
    );
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [] },
        { id: opponentId, library: [], hand: [], graveyard: [] },
      ],
      battlefield: [
        {
          id: 'bf-withdraw-1',
          name: 'Withdraw Bear',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Bear',
          colors: ['G'],
        },
        {
          id: 'bf-withdraw-2',
          name: 'Withdraw Elf',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Elf',
          colors: ['G'],
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, step ? [step] : [], {
      controllerId,
      sourceId: 'withdraw',
      selectorContext: {
        chosenObjectIds: ['bf-withdraw-1', 'bf-withdraw-2'],
        unlessPaysManaChoice: 'pay',
      },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(2);
  });

  it('executes Hibernation return all green permanents', () => {
    const ir = parseOracleTextToIR("Return all green permanents to their owners' hands.", 'Hibernation');
    const step = ir.abilities[0]?.steps?.[0];
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [] },
        { id: opponentId, library: [], hand: [], graveyard: [] },
      ],
      battlefield: [
        {
          id: 'bf-hibernate-green-1',
          name: 'Hibernate Bear',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Bear',
          colors: ['G'],
        },
        {
          id: 'bf-hibernate-green-2',
          name: 'Hibernate Forest',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Basic Land — Forest',
          colors: [],
        },
        {
          id: 'bf-hibernate-blue-1',
          name: 'Hibernate Fish',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Fish',
          colors: ['U'],
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'hibernation',
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(1);
    expect((result.state?.battlefield?.[0] as any)?.id).toBe('bf-hibernate-blue-1');
  });

  it('executes Dakra Mystic optional revealed cards to graveyards', () => {
    const ir = parseOracleTextToIR(
      "{U}, {T}: Each player reveals the top card of their library. You may put the revealed cards into their owners' graveyards.",
      'Dakra Mystic'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '') === 'the revealed cards'
    );
    const revealedCards = [
      { id: 'lib-revealed-p1', name: 'Revealed Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'lib-revealed-p2', name: 'Revealed Elf', type_line: 'Creature — Elf', cmc: 1 },
    ];
    const state = {
      players: [
        {
          id: controllerId,
          library: [revealedCards[0], { id: 'lib-extra-p1', name: 'Extra', type_line: 'Instant', cmc: 1 }],
          hand: [],
          graveyard: [],
        },
        {
          id: opponentId,
          library: [revealedCards[1], { id: 'lib-extra-p2', name: 'Extra Two', type_line: 'Instant', cmc: 1 }],
          hand: [],
          graveyard: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(
      state,
      step ? [step] : [],
      {
        controllerId,
        sourceId: 'dakra',
        lastMovedCards: revealedCards,
        selectorContext: { chosenObjectIds: ['lib-revealed-p1', 'lib-revealed-p2'] },
      },
      { allowOptional: true }
    );
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const p1 = result.state?.players.find((entry) => entry.id === controllerId) as any;
    const p2 = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(p1.graveyard.length).toBe(1);
    expect(p2.graveyard.length).toBe(1);
    expect(p1.library.length).toBe(1);
    expect(p2.library.length).toBe(1);
  });
});
