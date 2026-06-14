import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneBottomCardFromLibrary,
  parseMoveZoneUpToTargetCardsFromGraveyards,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const targetId = 'p2' as PlayerID;

describe('Oracle IR gap batch 321 — Cellar Door / Grenzo / Boneyard Parley', () => {
  it('parses Cellar Door bottom card of target player library selector', () => {
    expect(
      parseMoveZoneBottomCardFromLibrary({
        kind: 'raw',
        text: "the bottom card of target player's library",
      })
    ).toBe('target_player');
  });

  it('parses Grenzo bottom card of your library selector', () => {
    expect(
      parseMoveZoneBottomCardFromLibrary({
        kind: 'raw',
        text: 'the bottom card of your library',
      })
    ).toBe('your');
  });

  it('parses Boneyard Parley up to five target creature cards from graveyards', () => {
    expect(
      parseMoveZoneUpToTargetCardsFromGraveyards({
        kind: 'raw',
        text: 'up to five target creature cards from graveyards',
      })
    ).toEqual({ maxCount: 5, cardType: 'creature' });
  });

  it('executes Cellar Door moving target player bottom library card to graveyard', () => {
    const ir = parseOracleTextToIR(
      '{2}, {T}: Target player puts the bottom card of their library into their graveyard.',
      'Cellar Door'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        {
          id: targetId,
          library: [
            { id: 'lib-cd-top', name: 'CD Top', type_line: 'Instant', cmc: 1 },
            { id: 'lib-cd-bottom', name: 'CD Bottom', type_line: 'Sorcery', cmc: 2 },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      targetPlayerId: targetId,
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[1]?.library || []).map((c: any) => c.id)).toEqual(['lib-cd-top']);
    expect((result.state.players[1]?.graveyard || []).length).toBe(1);
  });

  it('executes Grenzo moving bottom library card to graveyard', () => {
    const ir = parseOracleTextToIR(
      "Put the bottom card of your library into your graveyard. If it's a creature card with mana value less than or equal to Grenzo's power, put it onto the battlefield.",
      'Grenzo, Dungeon Warden'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [
            { id: 'lib-grenzo-top', name: 'Grenzo Top', type_line: 'Instant', cmc: 1 },
            { id: 'lib-grenzo-bottom', name: 'Grenzo Bottom', type_line: 'Creature — Human', cmc: 2 },
          ],
          hand: [],
          graveyard: [],
          exile: [],
        },
      ],
      battlefield: [
        {
          id: 'bf-grenzo',
          name: 'Grenzo, Dungeon Warden',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Legendary Creature — Goblin Rogue',
          cmc: 2,
          power: 2,
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'bf-grenzo',
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.library || []).map((c: any) => c.id)).toEqual(['lib-grenzo-top']);
    expect((result.state.players[0]?.graveyard || []).length).toBe(1);
  });

  it('executes Boneyard Parley exiling up to five creature cards from graveyards', () => {
    const ir = parseOracleTextToIR(
      'Exile up to five target creature cards from graveyards. Then put all cards from the pile of your choice onto the battlefield under your control and the rest into their owners\' graveyards.',
      'Boneyard Parley'
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
            { id: 'gy-bp-1', name: 'BP Creature One', type_line: 'Creature — Zombie', cmc: 3 },
            { id: 'gy-bp-2', name: 'BP Creature Two', type_line: 'Creature — Elf', cmc: 2 },
            { id: 'gy-bp-instant', name: 'BP Instant', type_line: 'Instant', cmc: 1 },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['gy-bp-1', 'gy-bp-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.exile || []).length).toBe(2);
    expect((result.state.players[0]?.graveyard || []).length).toBe(1);
  });
});
