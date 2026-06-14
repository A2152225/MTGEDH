import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneThisCardAndTargetFromYourGraveyard,
  parseMoveZoneTypedCardFromAmongThem,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 317 — United Battlefront / Sandman / Salvation Colossus', () => {
  it('parses United Battlefront up to two noncreature nonland permanent mv<=3 from among them', () => {
    expect(
      parseMoveZoneTypedCardFromAmongThem(
        {
          kind: 'raw',
          text: 'up to two noncreature, nonland permanent cards with mana value 3 or less from among them',
        },
        {
          to: 'battlefield',
          toRaw: 'the battlefield',
          raw: 'Put up to two noncreature, nonland permanent cards with mana value 3 or less from among them onto the battlefield. Put the rest on the bottom of your library in a random order',
        }
      )
    ).toEqual({
      cardType: 'noncreature_nonland_permanent',
      maxCount: 2,
      manaValueLte: 3,
      bfLibraryBottomSplit: true,
      entersTappedFromWhat: false,
    });
  });

  it('parses Sandman this card and target land from your graveyard', () => {
    expect(
      parseMoveZoneThisCardAndTargetFromYourGraveyard({
        kind: 'raw',
        text: 'this card and target land card from your graveyard',
      })
    ).toEqual({ cardType: 'land' });
  });

  it('executes United Battlefront putting matching permanents on battlefield and rest on library bottom', () => {
    const ir = parseOracleTextToIR(
      'Look at the top five cards of your library. Put up to two noncreature, nonland permanent cards with mana value 3 or less from among them onto the battlefield. Put the rest on the bottom of your library in a random order.',
      'United Battlefront'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const libraryCards = [
      { id: 'lib-ub-artifact', name: 'Small Artifact', type_line: 'Artifact', cmc: 2 },
      { id: 'lib-ub-enchantment', name: 'Small Enchantment', type_line: 'Enchantment', cmc: 1 },
      { id: 'lib-ub-creature', name: 'Small Creature', type_line: 'Creature — Human', cmc: 2 },
      { id: 'lib-ub-instant', name: 'Small Instant', type_line: 'Instant', cmc: 2 },
      { id: 'lib-ub-land', name: 'Small Land', type_line: 'Basic Land — Forest', cmc: 0 },
    ];
    const state = {
      players: [{ id: controllerId, library: libraryCards, hand: [], graveyard: [], exile: [] }],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      lastMovedCards: libraryCards,
      selectorContext: {
        chosenObjectIds: ['lib-ub-artifact', 'lib-ub-enchantment'],
      },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.state.battlefield || []).toHaveLength(2);
    expect((result.state.players[0]?.library || []).length).toBe(3);
  });

  it('executes Sandman returning this card and target land tapped', () => {
    const ir = parseOracleTextToIR(
      'Return this card and target land card from your graveyard to the battlefield tapped.',
      'Sandman, Shifting Scoundrel'
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
            {
              id: 'gy-sandman',
              name: 'Sandman, Shifting Scoundrel',
              type_line: 'Legendary Creature — Human Rogue',
              cmc: 3,
            },
            { id: 'gy-land-1', name: 'Plains', type_line: 'Basic Land — Plains', cmc: 0 },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'gy-sandman',
      sourceName: 'Sandman, Shifting Scoundrel',
      selectorContext: { chosenObjectIds: ['gy-land-1'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.state.battlefield || []).toHaveLength(2);
    for (const perm of result.state.battlefield || []) {
      expect((perm as any)?.tapped).toBe(true);
    }
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
  });

  it('executes Salvation Colossus unearth return from graveyard', () => {
    const ir = parseOracleTextToIR(
      'Return this card from your graveyard to the battlefield.',
      'Salvation Colossus'
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
            {
              id: 'gy-colossus',
              name: 'Salvation Colossus',
              type_line: 'Artifact Creature — Golem',
              cmc: 7,
            },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'gy-colossus',
      sourceName: 'Salvation Colossus',
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.state.battlefield || []).toHaveLength(1);
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
  });

  it('executes Salvation Colossus full-card unearth clause', () => {
    const ir = parseOracleTextToIR(
      'Flying, vigilance, trample\nWhenever you attack, other creatures you control get +2/+2 and gain indestructible until end of turn.\nUnearth-Pay eight {E}. (Pay eight energy counters: Return this card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.)',
      'Salvation Colossus'
    );
    const steps: any[] = [];
    const collect = (s: any) => {
      if (s.kind === 'move_zone' && /return this card from your graveyard to the battlefield/i.test(String(s.raw || ''))) {
        steps.push(s);
      }
      if (Array.isArray(s.steps)) s.steps.forEach(collect);
      if (Array.isArray(s.modes)) s.modes.forEach((m: any) => (m.steps || []).forEach(collect));
    };
    for (const ability of ir.abilities || []) {
      for (const step of ability.steps || []) collect(step);
    }
    expect(steps.length).toBeGreaterThan(0);
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            {
              id: 'gy-colossus',
              name: 'Salvation Colossus',
              type_line: 'Artifact Creature — Golem',
              cmc: 7,
            },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [steps[0]], {
      controllerId,
      sourceId: 'gy-colossus',
      sourceName: 'Salvation Colossus',
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.state.battlefield || []).toHaveLength(1);
  });
});
