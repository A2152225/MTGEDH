import { describe, expect, it } from 'vitest';

import {
  findManaRockToReadyBeforeNextTurn,
  findManaRocksToTapBecauseOtherPlayersUntapThem,
  isEndStepBeforePlayersTurn,
} from '../src/socket/ai-handlers/aiManaRockEndStepUntap.js';

const BASALT =
  "This artifact doesn't untap during your untap step.\n{T}: Add {C}{C}{C}.\n{3}: Untap this artifact.";

function mountain(id: string, controller: string) {
  return {
    id,
    controller,
    tapped: false,
    card: {
      id: `${id}-card`,
      name: 'Mountain',
      type_line: 'Basic Land — Mountain',
      oracle_text: '{T}: Add {R}.',
    },
  };
}

function basalt(controller: string, tapped: boolean) {
  return {
    id: 'basalt',
    controller,
    tapped,
    card: {
      id: 'basalt-card',
      name: 'Basalt Monolith',
      type_line: 'Artifact',
      oracle_text: BASALT,
    },
  };
}

function gameFor(args: {
  turnPlayer: string;
  phase?: string;
  step?: string;
  battlefield: any[];
  stack?: any[];
  manaPool?: Record<string, number>;
}) {
  return {
    state: {
      phase: args.phase ?? 'ending',
      step: args.step ?? 'END',
      turnPlayer: args.turnPlayer,
      turnOrder: ['opponent', 'ai'],
      players: [
        { id: 'opponent', hasLost: false },
        { id: 'ai', hasLost: false },
      ],
      battlefield: args.battlefield,
      stack: args.stack ?? [],
      manaPool: { ai: args.manaPool ?? {} },
    },
  };
}

describe('mana rock untap before the next turn', () => {
  it('is only the end step of the turn immediately before that player', () => {
    const state = gameFor({
      turnPlayer: 'opponent',
      battlefield: [],
    }).state;
    expect(isEndStepBeforePlayersTurn(state, 'ai')).toBe(true);
    expect(isEndStepBeforePlayersTurn({ ...state, turnPlayer: 'ai' }, 'ai')).toBe(false);
    expect(isEndStepBeforePlayersTurn({ ...state, phase: 'precombatMain', step: 'MAIN1' }, 'ai')).toBe(false);
    expect(isEndStepBeforePlayersTurn({ ...state, step: 'CLEANUP' }, 'ai')).toBe(false);
    expect(isEndStepBeforePlayersTurn({
      ...state,
      turnOrder: ['opponent', 'other', 'ai'],
      players: [
        { id: 'opponent' },
        { id: 'other' },
        { id: 'ai' },
      ],
    }, 'ai')).toBe(false);
  });

  it('spends spare mana that comes back on untap, or floating mana that would empty', () => {
    const ready = findManaRockToReadyBeforeNextTurn(gameFor({
      turnPlayer: 'opponent',
      battlefield: [
        basalt('ai', true),
        mountain('m1', 'ai'),
        mountain('m2', 'ai'),
        mountain('m3', 'ai'),
      ],
    }), 'ai');
    expect(ready?.cardName).toBe('Basalt Monolith');
    expect(ready?.abilityText).toMatch(/untap this artifact/i);

    const short = findManaRockToReadyBeforeNextTurn(gameFor({
      turnPlayer: 'opponent',
      battlefield: [basalt('ai', true), mountain('m1', 'ai'), mountain('m2', 'ai')],
    }), 'ai');
    expect(short).toBeNull();

    const floating = findManaRockToReadyBeforeNextTurn(gameFor({
      turnPlayer: 'opponent',
      battlefield: [basalt('ai', true)],
      manaPool: { colorless: 3 },
    }), 'ai');
    expect(floating?.permanentId).toBe('basalt');
  });

  it('leaves the rock tapped when it is already untapped, on their own turn, or the only mana is another rock that will not untap', () => {
    expect(findManaRockToReadyBeforeNextTurn(gameFor({
      turnPlayer: 'opponent',
      battlefield: [basalt('ai', false), mountain('m1', 'ai'), mountain('m2', 'ai'), mountain('m3', 'ai')],
    }), 'ai')).toBeNull();

    expect(findManaRockToReadyBeforeNextTurn(gameFor({
      turnPlayer: 'ai',
      battlefield: [basalt('ai', true), mountain('m1', 'ai'), mountain('m2', 'ai'), mountain('m3', 'ai')],
    }), 'ai')).toBeNull();

    expect(findManaRockToReadyBeforeNextTurn(gameFor({
      turnPlayer: 'opponent',
      battlefield: [
        basalt('ai', true),
        {
          id: 'grim',
          controller: 'ai',
          tapped: false,
          card: {
            id: 'grim-card',
            name: 'Grim Monolith',
            type_line: 'Artifact',
            oracle_text: "This artifact doesn't untap during your untap step.\n{T}: Add {C}{C}{C}.\n{4}: Untap this artifact.",
          },
        },
      ],
    }), 'ai')).toBeNull();

    expect(findManaRockToReadyBeforeNextTurn(gameFor({
      turnPlayer: 'opponent',
      battlefield: [basalt('ai', true), mountain('m1', 'ai'), mountain('m2', 'ai'), mountain('m3', 'ai')],
      stack: [{ id: 'spell' }],
    }), 'ai')).toBeNull();
  });

  it('taps a doesn\'t-untap mana rock every main phase when another effect untaps it on other players\' turns', () => {
    const clock = {
      id: 'clock',
      controller: 'ai',
      tapped: false,
      card: {
        id: 'clock-card',
        name: 'Unwinding Clock',
        type_line: 'Artifact',
        oracle_text: "Untap all artifacts you control during each other player's untap step.",
      },
    };
    const withClock = gameFor({
      turnPlayer: 'opponent',
      phase: 'precombatMain',
      step: 'MAIN1',
      battlefield: [basalt('ai', false), clock],
    });
    const taps = findManaRocksToTapBecauseOtherPlayersUntapThem(withClock, 'ai');
    expect(taps.map((choice) => choice.cardName)).toEqual(['Basalt Monolith']);
    expect(taps[0]?.abilityText).toMatch(/add \{C\}\{C\}\{C\}/i);

    expect(findManaRocksToTapBecauseOtherPlayersUntapThem(gameFor({
      turnPlayer: 'opponent',
      phase: 'precombatMain',
      step: 'MAIN1',
      battlefield: [basalt('ai', false)],
    }), 'ai')).toEqual([]);

    expect(findManaRocksToTapBecauseOtherPlayersUntapThem(gameFor({
      turnPlayer: 'ai',
      phase: 'ending',
      step: 'END',
      battlefield: [basalt('ai', false), clock],
    }), 'ai')).toEqual([]);
  });
});
