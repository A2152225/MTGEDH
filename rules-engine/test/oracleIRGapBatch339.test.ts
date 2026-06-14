import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneCountTargetBattlefieldBounce,
  parseMoveZoneAnotherFromYourGraveyard,
  parseMoveZoneThisPermanentAndUpToTargetFromSingleGraveyard,
  parseMoveZoneUpToCountCardsYouOwnFromOutsideGame,
} from '../src/oracleIRExecutorZoneOps';
import { parseSimpleBattlefieldSelector } from '../src/oracleIRExecutorBattlefieldParser';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 339 — Serene / Research / Blood for Bones / Command', () => {
  it('parses Serene permanent plus single-graveyard shuffle selector', () => {
    expect(
      parseMoveZoneThisPermanentAndUpToTargetFromSingleGraveyard({
        kind: 'raw',
        text: 'this permanent and up to three target cards from a single graveyard',
      })
    ).toEqual({ count: 3, cardType: 'any', upTo: true });
  });

  it('parses Research outside-the-game shuffle selector', () => {
    expect(
      parseMoveZoneUpToCountCardsYouOwnFromOutsideGame({
        kind: 'raw',
        text: 'up to four cards you own from outside the game',
      })
    ).toEqual({ count: 4, upTo: true });
  });

  it('parses Blood for Bones another-graveyard creature selector', () => {
    expect(
      parseMoveZoneAnotherFromYourGraveyard({
        kind: 'raw',
        text: 'another creature card from your graveyard',
      })
    ).toEqual({ cardType: 'creature' });
  });

  it('parses Command one-or-two attacking creature bounce selector', () => {
    expect(
      parseMoveZoneCountTargetBattlefieldBounce({
        kind: 'raw',
        text: 'one or two target attacking creatures',
      })
    ).toEqual({ count: 2, selectorText: 'target attacking creatures' });
    expect(parseSimpleBattlefieldSelector({ kind: 'raw', text: 'target attacking creatures' })).toMatchObject({
      types: ['creature'],
      attackingOnly: true,
    });
  });

  it('executes Serene shuffling source permanent and graveyard cards into libraries', () => {
    const ir = parseOracleTextToIR(
      "Shuffle this permanent and up to three target cards from a single graveyard into their owners' libraries.",
      'Serene Remembrance'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-serene-1', name: 'Serene GY One', type_line: 'Instant', cmc: 2 },
            { id: 'gy-serene-2', name: 'Serene GY Two', type_line: 'Sorcery', cmc: 3 },
          ],
          exile: [],
        },
      ],
      battlefield: [
        {
          id: 'bf-serene-source',
          name: 'Serene Remembrance',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Enchantment',
          cmc: 2,
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'bf-serene-source',
      selectorContext: { chosenObjectIds: ['gy-serene-1', 'gy-serene-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(0);
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
    expect((result.state.players[0]?.library || []).length).toBe(3);
  });

  it('executes Research shuffling outside-the-game cards into library', () => {
    const ir = parseOracleTextToIR(
      'Shuffle up to four cards you own from outside the game into your library.',
      'Development'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [],
          exile: [],
          sideboard: [
            { id: 'sb-research-1', name: 'Research Outside One', type_line: 'Instant', cmc: 1 },
            { id: 'sb-research-2', name: 'Research Outside Two', type_line: 'Sorcery', cmc: 2 },
          ],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['sb-research-1', 'sb-research-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    const player = result.state.players[0] as any;
    expect(player.sideboard.length).toBe(0);
    expect(player.library.length).toBe(2);
  });

  it('executes Blood for Bones returning another creature to hand after battlefield return', () => {
    const ir = parseOracleTextToIR(
      'Return a creature card from your graveyard to the battlefield, then return another creature card from your graveyard to your hand.',
      'Blood for Bones'
    );
    const steps = ir.abilities.flatMap((ability) => ability.steps || []).filter((entry) => entry.kind === 'move_zone');
    expect(steps.length).toBe(2);
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-blood-bf', name: 'Blood BF Creature', type_line: 'Creature — Zombie', cmc: 3 },
            { id: 'gy-blood-hand', name: 'Blood Hand Creature', type_line: 'Creature — Skeleton', cmc: 2 },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, steps as any[], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['gy-blood-bf', 'gy-blood-hand'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(1);
    const player = result.state.players[0] as any;
    expect(player.hand.length).toBe(1);
    expect(player.hand[0]?.id).toBe('gy-blood-hand');
    expect(player.graveyard.length).toBe(0);
  });

  it('executes Command bouncing one or two attacking creatures', () => {
    const ir = parseOracleTextToIR(
      "Return one or two target attacking creatures to their owner's hand.",
      'Command of Unsummoning'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [
        {
          id: 'bf-command-attack-1',
          name: 'Command Attacker One',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Human',
          cmc: 2,
          attacking: true,
        },
        {
          id: 'bf-command-attack-2',
          name: 'Command Attacker Two',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Elf',
          cmc: 1,
          attacking: true,
        },
      ],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['bf-command-attack-1', 'bf-command-attack-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(0);
    const opponent = result.state.players.find((player) => player.id === opponentId) as any;
    expect(opponent.hand.length).toBe(2);
  });
});
