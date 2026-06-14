import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { parseSimpleBattlefieldSelector } from '../src/oracleIRExecutorBattlefieldParser';
import {
  findFaceUpExiledCardLocation,
  parseMoveZoneCountTargetBattlefieldBounce,
  parseMoveZoneTargetFaceUpExiledCard,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;

describe('Oracle IR gap batch 295 — selector cluster fixes', () => {
  it('parses Paradoxical Outcome any-number nonland nontoken bounce', () => {
    expect(
      parseMoveZoneCountTargetBattlefieldBounce({
        kind: 'raw',
        text: 'any number of target nonland, nontoken permanents you control',
      })
    ).toEqual({
      count: 99,
      selectorText: 'target nonland, nontoken permanents you control',
    });
    expect(
      parseSimpleBattlefieldSelector({
        kind: 'raw',
        text: 'target nonland, nontoken permanents you control',
      })
    ).toMatchObject({
      types: ['nonland_permanent'],
      controllerFilter: 'you',
      nontokenOnly: true,
    });
  });

  it('parses Pull from Eternity face-up exiled card selector', () => {
    expect(
      parseMoveZoneTargetFaceUpExiledCard({
        kind: 'raw',
        text: 'target face-up exiled card',
      })
    ).toEqual({ cardType: 'any', faceUpOnly: true });
  });

  it('executes Coiling Rebirth graveyard return with audit-style lastMovedCards', () => {
    const ir = parseOracleTextToIR(
      'Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card before its other effects.)\nReturn target creature card from your graveyard to the battlefield. Then if the gift was promised and that creature isn\'t legendary, create a token that\'s a copy of that creature, except it\'s 1/1.',
      'Coiling Rebirth'
    );
    const moveStep = ir.abilities[1]?.steps?.[0];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            {
              id: 'gy-creature-1',
              name: 'Gravecrawler',
              type_line: 'Creature — Zombie',
            },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [moveStep], {
      controllerId,
      sourceId: 'coiling',
      sourceName: 'Coiling Rebirth',
      lastMovedCards: [
        {
          id: 'gy-creature-1',
          name: 'Gravecrawler',
          type_line: 'Creature — Zombie',
        },
      ],
      selectorContext: { chosenObjectIds: ['gy-creature-1'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(1);
  });

  it('executes Pull from Eternity face-up exile to graveyard', () => {
    const ir = parseOracleTextToIR(
      "Put target face-up exiled card into its owner's graveyard.",
      'Pull from Eternity'
    );
    const step = ir.abilities[0]?.steps?.[0];
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            {
              id: 'exile-face-up-1',
              name: 'Face Up Exile',
              type_line: 'Creature — Human',
              faceDown: false,
            },
            {
              id: 'exile-face-down-1',
              name: 'Face Down Exile',
              type_line: 'Creature — Elf',
              faceDown: true,
            },
          ],
        },
      ],
      battlefield: [],
    } as GameState;

    const location = findFaceUpExiledCardLocation(state, ['exile-face-up-1']);
    expect(location).toEqual({ playerId: controllerId, cardId: 'exile-face-up-1' });

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'pull',
      selectorContext: { chosenObjectIds: ['exile-face-up-1'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.graveyard.length).toBe(1);
    expect(player.exile.length).toBe(1);
    expect(player.exile[0].id).toBe('exile-face-down-1');
  });

  it('executes Paradoxical Outcome nonland nontoken bounce', () => {
    const ir = parseOracleTextToIR(
      "Return any number of target nonland, nontoken permanents you control to their owners' hands. Draw a card for each card returned to your hand this way.",
      'Paradoxical Outcome'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [] }],
      battlefield: [
        {
          id: 'bf-artifact-1',
          name: 'Sol Ring',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Artifact',
        },
        {
          id: 'bf-token-1',
          name: 'Spirit Token',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Token Creature — Spirit',
          isToken: true,
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step], {
      controllerId,
      sourceId: 'paradox',
      selectorContext: { chosenObjectIds: ['bf-artifact-1', 'bf-token-1'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(1);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(1);
  });

  it('executes Hallowed Respite flicker return via contextual it', () => {
    const ir = parseOracleTextToIR(
      "Exile target nonlegendary creature, then return it to the battlefield under its owner's control. If it entered under your control, put a +1/+1 counter on it. Otherwise, tap it.",
      'Hallowed Respite'
    );
    const steps = ir.abilities[0]?.steps || [];
    const flickerCard = {
      id: 'exile-flicker-return-1',
      name: 'Audit Human',
      type_line: 'Creature — Human',
    };
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [],
          exile: [flickerCard],
        },
      ],
      battlefield: [],
    } as GameState;

    const moveStep = steps.find((step) => step.kind === 'move_zone');
    const result = applyOracleIRStepsToGameState(state, [moveStep], {
      controllerId,
      sourceId: 'hallowed',
      lastMovedCards: [flickerCard],
      selectorContext: { chosenObjectIds: [flickerCard.id] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect((result.state?.battlefield || []).length).toBe(1);
  });
});
