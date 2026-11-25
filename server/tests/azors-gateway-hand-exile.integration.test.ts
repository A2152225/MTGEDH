import { beforeEach, describe, expect, it } from 'vitest';
import { tryApplyOracleIRToActivatedAbility } from '../src/state/modules/oracleIrAbilityExecution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const AZOR =
  "{1}, {T}: Draw a card, then exile a card from your hand. If cards with five or more different mana values are exiled with Azor's Gateway, you gain 5 life, untap Azor's Gateway, and transform it.";

function makeCtx(gameId: string) {
  const state: any = {
    players: [
      {
        id: 'p1',
        name: 'P1',
        life: 40,
        hand: [
          { id: 'h1', name: 'Island', type_line: 'Basic Land — Island', cmc: 0 },
          { id: 'h2', name: 'Opt', type_line: 'Instant', cmc: 1, mana_cost: '{U}' },
        ],
        library: [{ id: 'l1', name: 'Swamp', type_line: 'Basic Land — Swamp', cmc: 0 }],
        graveyard: [],
        exile: [],
      },
      { id: 'p2', name: 'P2', life: 40, hand: [], library: [], graveyard: [], exile: [] },
    ],
    life: { p1: 40, p2: 40 },
    turnNumber: 5,
    turnPlayer: 'p1',
    priority: 'p1',
    phase: 'precombatMain',
    step: 'MAIN1',
    stack: [],
    battlefield: [
      {
        id: 'azor',
        controller: 'p1',
        owner: 'p1',
        tapped: true,
        card: { id: 'azor_c', name: "Azor's Gateway", type_line: 'Legendary Artifact', oracle_text: AZOR },
      },
    ],
    zones: {
      p1: {
        hand: [
          { id: 'h1', name: 'Island', type_line: 'Basic Land — Island', cmc: 0 },
          { id: 'h2', name: 'Opt', type_line: 'Instant', cmc: 1, mana_cost: '{U}' },
        ],
        library: [{ id: 'l1', name: 'Swamp', type_line: 'Basic Land — Swamp', cmc: 0 }],
        graveyard: [],
        exile: [],
        handCount: 2,
        libraryCount: 1,
      },
      p2: { hand: [], library: [], graveyard: [], exile: [] },
    },
  };
  return {
    state,
    gameId,
    bumpSeq: () => {},
    libraries: new Map([['p1', state.zones.p1.library], ['p2', []]]),
  } as any;
}

describe("Azor's Gateway hand→exile choice bridge", () => {
  beforeEach(() => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  });

  it('queues an OPTION_CHOICE to exile a hand card instead of failing all-or-nothing', () => {
    const gameId = `azor_${Date.now()}`;
    const ctx = makeCtx(gameId);

    const result = tryApplyOracleIRToActivatedAbility(ctx, {
      controller: 'p1',
      sourceName: "Azor's Gateway",
      oracleText: AZOR,
      sourcePermanentId: 'azor',
      allowOptional: true,
    });

    expect(result.handled).toBe(true);
    const queue = ResolutionQueueManager.getQueue(gameId)?.steps || [];
    const exilePrompt = queue.find((step: any) => step.moveChosenHandCardToExileChoice === true);
    expect(exilePrompt).toBeTruthy();
    expect(exilePrompt.type).toBe(ResolutionStepType.OPTION_CHOICE);
    expect(Array.isArray(exilePrompt.options) && exilePrompt.options.length >= 2).toBe(true);
  });
});
