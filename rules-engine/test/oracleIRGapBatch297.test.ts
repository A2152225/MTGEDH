import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  cardHasFlashbackAbility,
  parseMoveZoneAllFromTargetPlayersGraveyard,
  parseMoveZoneAllFromYourLibrary,
  parseMoveZoneCountOfThemAtRandom,
  parseMoveZoneSingleTargetCriteria,
  parseMoveZoneTypedCardFromYourHand,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 297 — selector cluster fixes', () => {
  it('parses Thran Temporal Gateway historic permanent from hand', () => {
    expect(
      parseMoveZoneTypedCardFromYourHand({
        kind: 'raw',
        text: 'a historic permanent card from your hand',
      })
    ).toEqual({ cardType: 'permanent', requiresHistoric: true });
    expect(parseMoveZoneSingleTargetCriteria('historic permanent')).toEqual({
      cardType: 'permanent',
      requiresHistoric: true,
    });
  });

  it('parses Sinister Waltz two-of-them-at-random return', () => {
    expect(
      parseMoveZoneCountOfThemAtRandom({
        kind: 'raw',
        text: 'two of them at random',
      })
    ).toEqual({ count: 2 });
  });

  it('parses Tombfire all flashback cards from target player graveyard', () => {
    expect(
      parseMoveZoneAllFromTargetPlayersGraveyard({
        kind: 'raw',
        text: 'all cards with flashback from target player\'s graveyard',
      })
    ).toEqual({ cardType: 'any', requiresFlashback: true });
    expect(
      cardHasFlashbackAbility({
        type_line: 'Sorcery',
        keywords: ['Flashback'],
      })
    ).toBe(true);
  });

  it('parses Mirror of Fate exile all the cards from your library', () => {
    expect(
      parseMoveZoneAllFromYourLibrary({
        kind: 'raw',
        text: 'all the cards from your library',
      })
    ).toBe(true);
  });

  it('executes Thran Temporal Gateway historic hand to battlefield', () => {
    const ir = parseOracleTextToIR(
      '{4}, {T}: You may put a historic permanent card from your hand onto the battlefield.',
      'Thran Temporal Gateway'
    );
    const step = ir.abilities[0]?.steps?.[0];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [
            {
              id: 'hand-historic-1',
              name: 'Historic Artifact',
              type_line: 'Legendary Artifact',
            },
            { id: 'hand-instant-1', name: 'Bolt', type_line: 'Instant' },
          ],
          graveyard: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'thran-gateway',
      selectorContext: { chosenObjectIds: ['hand-historic-1'] },
    }, { allowOptional: true });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(1);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(1);
    expect(player.hand[0].id).toBe('hand-instant-1');
  });

  it('executes Sinister Waltz random return and the other to library bottom', () => {
    const ir = parseOracleTextToIR(
      'Choose three target creature cards in your graveyard. Return two of them at random to the battlefield and put the other on the bottom of your library.',
      'Sinister Waltz'
    );
    const steps = ir.abilities[0]?.steps || [];
    const gyCards = [
      { id: 'gy-waltz-1', name: 'One', type_line: 'Creature — Zombie' },
      { id: 'gy-waltz-2', name: 'Two', type_line: 'Creature — Skeleton' },
      { id: 'gy-waltz-3', name: 'Three', type_line: 'Creature — Vampire' },
    ];
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: gyCards }],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId,
      sourceId: 'sinister-waltz',
      selectorContext: { chosenObjectIds: ['gy-waltz-1', 'gy-waltz-2', 'gy-waltz-3'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect((result.state?.battlefield || []).length).toBe(2);
    expect(player.graveyard.length + player.library.length).toBe(1);
  });

  it('executes Tombfire flashback graveyard exile', () => {
    const ir = parseOracleTextToIR(
      'Target player exiles all cards with flashback from their graveyard.',
      'Tombfire'
    );
    const step = ir.abilities[0]?.steps?.[0];
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [] },
        {
          id: 'p2',
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-flashback-1', name: 'Faithless', type_line: 'Sorcery', keywords: ['Flashback'] },
            { id: 'gy-normal-1', name: 'Zombie', type_line: 'Creature — Zombie' },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'tombfire',
      selectorContext: { targetPlayerId: 'p2' },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const target = result.state?.players.find((entry) => entry.id === 'p2') as any;
    expect(target.graveyard.length).toBe(1);
    expect(target.graveyard[0].id).toBe('gy-normal-1');
    expect(target.exile.length).toBe(1);
    expect(target.exile[0].id).toBe('gy-flashback-1');
  });

  it('executes Mirror of Fate exile all library cards', () => {
    const ir = parseOracleTextToIR(
      '{T}, Sacrifice this artifact: Choose up to seven face-up exiled cards you own. Exile all the cards from your library, then put the chosen cards on top of your library.',
      'Mirror of Fate'
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) => entry.kind === 'move_zone' && (entry as any).to === 'exile'
    );
    const state = {
      players: [
        {
          id: controllerId,
          library: [
            { id: 'lib-mirror-1', name: 'One', type_line: 'Instant' },
            { id: 'lib-mirror-2', name: 'Two', type_line: 'Sorcery' },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'mirror',
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.library.length).toBe(0);
    expect(player.exile.length).toBe(2);
  });
});
