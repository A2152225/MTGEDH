import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAlternateCostColorCardFromYourHand,
  parseMoveZoneAllFromYourGraveyard,
  parseMoveZoneCountTargetBattlefieldBounce,
  parseMoveZoneEnchantedCreatureAndAurasToHand,
  parseMoveZoneExileXTargetCreatureCardsFromGraveyards,
  parseMoveZoneMassBattlefieldCreatureBounce,
  parseMoveZoneSingleTargetFromYourGraveyard,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 289 — selector cluster fixes', () => {
  it('parses Sunscour alternate cost for two white cards', () => {
    expect(
      parseMoveZoneAlternateCostColorCardFromYourHand({
        kind: 'raw',
        text: "two white cards from your hand rather than pay this spell's mana cost",
      })
    ).toEqual({ colorsAllOf: ['W'], cardType: 'any', count: 2 });
  });

  it('parses Scapegoat any-number controlled creature bounce selector', () => {
    expect(
      parseMoveZoneCountTargetBattlefieldBounce({
        kind: 'raw',
        text: 'any number of target creatures you control',
      })
    ).toEqual({ count: 99, selectorText: 'target creatures you control' });
  });

  it('parses Counterintelligence one-or-two creature bounce selector', () => {
    expect(
      parseMoveZoneCountTargetBattlefieldBounce({
        kind: 'raw',
        text: 'one or two target creatures',
      })
    ).toEqual({ count: 2, selectorText: 'target creatures' });
  });

  it('parses Triumphant Reckoning compound graveyard return selector', () => {
    expect(
      parseMoveZoneAllFromYourGraveyard({
        kind: 'raw',
        text: 'all artifact, enchantment, and planeswalker cards from your graveyard',
      })
    ).toEqual({
      cardType: 'permanent',
      typeLineTermsAnyOf: ['artifact', 'enchantment', 'planeswalker'],
    });
  });

  it('parses Inundate nonblue mass bounce selector', () => {
    expect(
      parseMoveZoneMassBattlefieldCreatureBounce({
        kind: 'raw',
        text: 'all nonblue creatures',
      })
    ).toEqual({ excludeCardColor: 'blue' });
  });

  it('parses Disappear enchanted creature and this Aura selector', () => {
    expect(
      parseMoveZoneEnchantedCreatureAndAurasToHand({
        kind: 'raw',
        text: 'enchanted creature and this Aura',
      })
    ).toBe('this_aura');
  });

  it('parses Onakke Oathkeeper planeswalker graveyard return selector', () => {
    expect(
      parseMoveZoneSingleTargetFromYourGraveyard({
        kind: 'raw',
        text: 'target planeswalker card from your graveyard',
      })
    ).toEqual({ cardType: 'planeswalker' });
  });

  it('parses Foggy Swamp Visions X creature cards from graveyards exile selector', () => {
    expect(
      parseMoveZoneExileXTargetCreatureCardsFromGraveyards({
        kind: 'raw',
        text: 'X target creature cards from graveyards',
      })
    ).toEqual({ cardType: 'creature', useXValue: true });
    expect(
      parseMoveZoneCountTargetBattlefieldBounce({
        kind: 'raw',
        text: 'X target creature cards from graveyards',
      })
    ).toBeNull();
  });

  it('executes Scapegoat return any number of controlled creatures', () => {
    const ir = parseOracleTextToIR(
      "Return any number of target creatures you control to their owner's hand.",
      'Scapegoat'
    );
    const steps = ir.abilities[0]?.steps || [];
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [] }],
      battlefield: [
        {
          id: 'bf-1',
          name: 'Bear',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Bear',
          colors: ['G'],
        },
        {
          id: 'bf-2',
          name: 'Elf',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Elf',
          colors: ['G'],
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'scapegoat',
      selectorContext: { chosenObjectIds: ['bf-1', 'bf-2'] },
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(0);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(2);
  });

  it('executes Onakke Oathkeeper return target planeswalker from graveyard', () => {
    const ir = parseOracleTextToIR(
      'Return target planeswalker card from your graveyard to the battlefield.',
      'Onakke Oathkeeper'
    );
    const steps = ir.abilities[0]?.steps || [];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            {
              id: 'gy-pw',
              name: 'Jace',
              type_line: 'Legendary Planeswalker — Jace',
              colors: ['U'],
            },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'onakke',
      selectorContext: { chosenObjectIds: ['gy-pw'] },
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(1);
  });

  it('executes Foggy Swamp Visions exile X creature cards from graveyards', () => {
    const steps = [
      {
        kind: 'move_zone' as const,
        what: { kind: 'raw' as const, text: 'X target creature cards from graveyards' },
        to: 'exile' as const,
        toRaw: 'exile',
        raw: 'Exile X target creature cards from graveyards',
      },
    ];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-1', name: 'Zombie', type_line: 'Creature — Zombie' }],
          exile: [],
        },
        {
          id: opponentId,
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-2', name: 'Elf', type_line: 'Creature — Elf' }],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'foggy',
      xValue: 2,
      selectorContext: { chosenObjectIds: ['gy-1', 'gy-2'] },
    });

    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const p1 = result.state?.players.find((entry) => entry.id === controllerId) as any;
    const p2 = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(p1.exile.length + p2.exile.length).toBe(2);
  });
});
