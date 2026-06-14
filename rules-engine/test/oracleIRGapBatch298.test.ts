import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllFromTargetPlayersGraveyard,
  parseMoveZoneOneTwoOrThreeTargetCreatureCardsFromGraveyards,
  parseMoveZoneTypedCardFromAmongThem,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 298 — selector cluster fixes', () => {
  it('parses Aberrant Return one/two/three creature cards from graveyards', () => {
    expect(
      parseMoveZoneOneTwoOrThreeTargetCreatureCardsFromGraveyards({
        kind: 'raw',
        text: 'one, two, or three target creature cards from graveyards',
      })
    ).toEqual({ cardType: 'creature', maxCount: 3 });
  });

  it('parses Ghastly Conscription face-down pile graveyard exile', () => {
    expect(
      parseMoveZoneAllFromTargetPlayersGraveyard({
        kind: 'raw',
        text: "all creature cards from target player's graveyard in a face-down pile, shuffle that pile",
      })
    ).toEqual({ cardType: 'creature', faceDown: true, shuffleExiledPile: true });
  });

  it('parses Kayla\'s Reconstruction up-to-X artifact/creature among them', () => {
    expect(
      parseMoveZoneTypedCardFromAmongThem(
        {
          kind: 'raw',
          text: 'up to X artifact and/or creature cards with mana value 3 or less from among them',
        },
        { to: 'battlefield', toRaw: 'onto the battlefield. Put the rest on the bottom of your library in a random order.' }
      )
    ).toEqual({ cardType: 'artifact_or_creature', maxCount: -1, manaValueLte: 3 });
  });

  it('executes Aberrant Return multi-graveyard creature return', () => {
    const ir = parseOracleTextToIR(
      'Put one, two, or three target creature cards from graveyards onto the battlefield under your control. Each of them enters with an additional -1/-1 counter on it.',
      'Aberrant Return'
    );
    const step = ir.abilities[0]?.steps?.[0];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-aberrant-1', name: 'Zombie', type_line: 'Creature — Zombie', cmc: 2 },
            { id: 'gy-aberrant-2', name: 'Skeleton', type_line: 'Creature — Skeleton', cmc: 3 },
          ],
        },
        {
          id: 'p2',
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-p2-1', name: 'Human', type_line: 'Creature — Human', cmc: 2 }],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'aberrant',
      selectorContext: { chosenObjectIds: ['gy-aberrant-1', 'gy-p2-1'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(2);
  });

  it('executes Ghastly Conscription face-down graveyard exile pile', () => {
    const ir = parseOracleTextToIR(
      "Exile all creature cards from target player's graveyard in a face-down pile, shuffle that pile, then manifest those cards.",
      'Ghastly Conscription'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone' && (entry as any).to === 'exile');
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [] },
        {
          id: 'p2',
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-ghastly-1', name: 'Zombie', type_line: 'Creature — Zombie' },
            { id: 'gy-ghastly-2', name: 'Bear', type_line: 'Creature — Bear' },
            { id: 'gy-ghastly-land', name: 'Plains', type_line: 'Basic Land — Plains' },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'ghastly',
      selectorContext: { targetPlayerId: 'p2' },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const target = result.state?.players.find((entry) => entry.id === 'p2') as any;
    expect(target.graveyard.length).toBe(1);
    expect(target.exile.length).toBe(2);
    expect(target.exile.every((card: any) => card.faceDown === true)).toBe(true);
  });

  it('executes Kayla\'s Reconstruction up-to-X among-them battlefield + rest bottom', () => {
    const ir = parseOracleTextToIR(
      'Look at the top seven cards of your library. Put up to X artifact and/or creature cards with mana value 3 or less from among them onto the battlefield. Put the rest on the bottom of your library in a random order.',
      "Kayla's Reconstruction"
    );
    const step = ir.abilities[0]?.steps?.find(
      (entry) => entry.kind === 'move_zone' && (entry as any).to === 'battlefield'
    );
    const lookedAt = [
      { id: 'lib-kayla-1', name: 'Sol Ring', type_line: 'Artifact', cmc: 1 },
      { id: 'lib-kayla-2', name: 'Human', type_line: 'Creature — Human', cmc: 2 },
      { id: 'lib-kayla-3', name: 'Bolt', type_line: 'Instant', cmc: 1 },
    ];
    const state = {
      players: [
        {
          id: controllerId,
          library: [...lookedAt, { id: 'lib-deep', name: 'Deep', type_line: 'Sorcery', cmc: 4 }],
          hand: [],
          graveyard: [],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'kayla',
      xValue: 2,
      lastMovedCards: lookedAt,
      selectorContext: { chosenObjectIds: ['lib-kayla-1', 'lib-kayla-2'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(2);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.library.length).toBe(2);
    expect(player.library.some((card: any) => card.id === 'lib-kayla-3')).toBe(true);
  });
});
