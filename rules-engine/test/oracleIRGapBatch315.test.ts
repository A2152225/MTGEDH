import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { parseSimpleBattlefieldSelector } from '../src/oracleIRExecutorBattlefieldParser';
import { permanentMatchesSelector } from '../src/oracleIRExecutorBattlefieldOps';
import {
  parseMoveZoneAnyNumberCardsFromYourHand,
  parseMoveZoneCompoundBattlefieldAndGraveyardMassReturn,
  parseMoveZoneCountTargetBattlefieldBounce,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 315 — Shadows Verdict / Credit Voucher / Selective Snare', () => {
  it('parses Shadows Verdict compound BF+all-GY mv<=3 exile', () => {
    expect(
      parseMoveZoneCompoundBattlefieldAndGraveyardMassReturn({
        kind: 'raw',
        text: 'all creatures and planeswalkers with mana value 3 or less from the battlefield and all creature and planeswalker cards with mana value 3 or less from all graveyards',
      })
    ).toEqual({ cardType: 'creature_or_planeswalker', manaValueLte: 3 });
  });

  it('parses Credit Voucher any number of cards from your hand', () => {
    expect(
      parseMoveZoneAnyNumberCardsFromYourHand({
        kind: 'raw',
        text: 'any number of cards from your hand',
      })
    ).toEqual({ cardType: 'any' });
  });

  it('parses Selective Snare X target creatures of chosen type', () => {
    expect(
      parseMoveZoneCountTargetBattlefieldBounce({
        kind: 'raw',
        text: 'X target creatures of the creature type of your choice',
      })
    ).toEqual({
      count: 0,
      selectorText: 'target creatures of the creature type of your choice',
      useXValue: true,
    });
  });

  it('matches chosen creature type in battlefield selector', () => {
    const selector = parseSimpleBattlefieldSelector({
      kind: 'raw',
      text: 'target creatures of the creature type of your choice',
    });
    expect(selector?.usesChosenCreatureType).toBe(true);
    const elf = {
      id: 'bf-snare-elf',
      controller: opponentId,
      owner: opponentId,
      type_line: 'Creature — Elf',
      cmc: 2,
    };
    const goblin = {
      id: 'bf-snare-goblin',
      controller: opponentId,
      owner: opponentId,
      type_line: 'Creature — Goblin',
      cmc: 1,
    };
    const ctx = {
      controllerId,
      selectorContext: { chosenCreatureType: 'Elf' },
    } as any;
    expect(permanentMatchesSelector(elf as any, selector!, ctx)).toBe(true);
    expect(permanentMatchesSelector(goblin as any, selector!, ctx)).toBe(false);
  });

  it('executes Shadows Verdict mass exile from battlefield and all graveyards', () => {
    const ir = parseOracleTextToIR(
      'Exile all creatures and planeswalkers with mana value 3 or less from the battlefield and all creature and planeswalker cards with mana value 3 or less from all graveyards.',
      "Shadows' Verdict"
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-sv-small', name: 'Small GY', type_line: 'Creature — Zombie', cmc: 2 },
            { id: 'gy-sv-big', name: 'Big GY', type_line: 'Creature — Giant', cmc: 6 },
          ],
          exile: [],
        },
        {
          id: opponentId,
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-p2-pw', name: 'Small PW', type_line: 'Legendary Planeswalker — Jace', cmc: 2 }],
          exile: [],
        },
      ],
      battlefield: [
        {
          id: 'bf-sv-small',
          name: 'Small Creature',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Human',
          cmc: 2,
        },
        {
          id: 'bf-sv-big',
          name: 'Big Creature',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Giant',
          cmc: 6,
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], { controllerId, sourceId: 'shadows-verdict' });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(1);
    const p1 = result.state?.players.find((entry) => entry.id === controllerId) as any;
    const p2 = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(p1.graveyard.map((card: any) => card.id)).toEqual(['gy-sv-big']);
    expect(p2.graveyard.length).toBe(0);
    expect(p1.exile.length + p2.exile.length).toBeGreaterThanOrEqual(3);
  });

  it('executes Credit Voucher shuffle any number from hand into library', () => {
    const ir = parseOracleTextToIR(
      '{T}: Shuffle any number of cards from your hand into your library.',
      'Credit Voucher'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [{ id: 'lib-base', name: 'Library Base', type_line: 'Instant', cmc: 1 }],
          hand: [
            { id: 'hand-cv-1', name: 'Hand One', type_line: 'Instant', cmc: 1 },
            { id: 'hand-cv-2', name: 'Hand Two', type_line: 'Sorcery', cmc: 2 },
            { id: 'hand-cv-3', name: 'Hand Three', type_line: 'Creature — Elf', cmc: 2 },
          ],
          graveyard: [],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'credit-voucher',
      selectorContext: { chosenObjectIds: ['hand-cv-1', 'hand-cv-2'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const controller = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(controller.hand.map((card: any) => card.id)).toEqual(['hand-cv-3']);
    expect(controller.library.length).toBe(3);
  });

  it('executes Selective Snare return X chosen-type creatures to hand', () => {
    const ir = parseOracleTextToIR(
      "Return X target creatures of the creature type of your choice to their owner's hand.",
      'Selective Snare'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [
        {
          id: 'bf-snare-elf',
          name: 'Snare Elf',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Elf',
          cmc: 2,
        },
        {
          id: 'bf-snare-goblin',
          name: 'Snare Goblin',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Goblin',
          cmc: 1,
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'selective-snare',
      xValue: 1,
      selectorContext: {
        chosenCreatureType: 'Elf',
        chosenObjectIds: ['bf-snare-elf'],
      },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(1);
    expect((result.state?.battlefield?.[0] as any)?.id).toBe('bf-snare-goblin');
    const opponent = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(opponent.hand.length).toBe(1);
  });
});
