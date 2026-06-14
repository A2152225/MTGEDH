import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneCountFromYourHand,
  parseMoveZoneTargetCreatureFromGraveyardAndTargetCreatureOnBattlefield,
  parseMoveZoneThisArtifactAndAllCardsFromAllGraveyards,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 313 — Silent Gravestone / Dream Cache / Rise // Fall', () => {
  it('parses Silent Gravestone this artifact and all graveyards', () => {
    expect(
      parseMoveZoneThisArtifactAndAllCardsFromAllGraveyards({
        kind: 'raw',
        text: 'this artifact and all cards from all graveyards',
      })
    ).toBe(true);
  });

  it('parses Dream Cache two cards from hand top-or-bottom both', () => {
    expect(
      parseMoveZoneCountFromYourHand({
        kind: 'raw',
        text: 'two cards from your hand both',
      })
    ).toEqual({ count: 2, topOrBottomBoth: true });
  });

  it('parses Rise // Fall gy creature and bf creature return', () => {
    expect(
      parseMoveZoneTargetCreatureFromGraveyardAndTargetCreatureOnBattlefield({
        kind: 'raw',
        text: 'target creature card from a graveyard and target creature on the battlefield',
      })
    ).toBe(true);
  });

  it('executes Silent Gravestone exile artifact and all graveyard cards', () => {
    const ir = parseOracleTextToIR(
      'Exile this artifact and all cards from all graveyards.',
      'Silent Gravestone'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-silent-p1', name: 'P1 GY', type_line: 'Instant', cmc: 1 }],
          exile: [],
        },
        {
          id: opponentId,
          library: [],
          hand: [],
          graveyard: [{ id: 'gy-silent-p2', name: 'P2 GY', type_line: 'Creature — Zombie', cmc: 2 }],
          exile: [],
        },
      ],
      battlefield: [
        {
          id: 'bf-silent-gravestone',
          name: 'Silent Gravestone',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Artifact',
          cmc: 2,
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'bf-silent-gravestone',
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(0);
    const p1 = result.state?.players.find((entry) => entry.id === controllerId) as any;
    const p2 = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(p1.graveyard.length).toBe(0);
    expect(p2.graveyard.length).toBe(0);
    expect(p1.exile.length + p2.exile.length).toBeGreaterThanOrEqual(3);
  });

  it('executes Dream Cache put two hand cards on library bottom', () => {
    const ir = parseOracleTextToIR(
      'Draw two cards, then put two cards from your hand both on top of your library or both on the bottom of your library.',
      'Dream Cache'
    );
    const step = ir.abilities.find((ability) =>
      ability.steps?.some(
        (entry) =>
          entry.kind === 'move_zone' &&
          String((entry as any).what?.text || '').includes('two cards from your hand both')
      )
    )?.steps?.find(
      (entry) =>
        entry.kind === 'move_zone' &&
        String((entry as any).what?.text || '').includes('two cards from your hand both')
    );
    expect(step).toBeTruthy();
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [
            { id: 'hand-dream-1', name: 'Dream One', type_line: 'Instant', cmc: 1 },
            { id: 'hand-dream-2', name: 'Dream Two', type_line: 'Sorcery', cmc: 2 },
            { id: 'hand-dream-3', name: 'Dream Three', type_line: 'Creature — Elf', cmc: 2 },
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
      sourceId: 'dream-cache',
      libraryPlacement: 'bottom',
      selectorContext: { chosenObjectIds: ['hand-dream-1', 'hand-dream-2'], libraryPlacement: 'bottom' },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    const player = result.state?.players.find((entry) => entry.id === controllerId) as any;
    expect(player.hand.length).toBe(1);
    expect(player.library.length).toBe(2);
  });

  it('executes Rise // Fall return gy creature and bf creature to hands', () => {
    const ir = parseOracleTextToIR(
      "Return target creature card from a graveyard and target creature on the battlefield to their owners' hands.",
      'Rise // Fall'
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
            { id: 'gy-rise', name: 'Rise GY Creature', type_line: 'Creature — Zombie', cmc: 2 },
          ],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [
        {
          id: 'bf-rise-creature',
          name: 'Rise BF Creature',
          controller: opponentId,
          owner: opponentId,
          type_line: 'Creature — Bear',
          cmc: 2,
        },
      ],
    } as GameState;

    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'rise-fall',
      selectorContext: { chosenObjectIds: ['gy-rise', 'bf-rise-creature'] },
    });
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_selector')).toBe(false);
    expect(result.state?.battlefield?.length).toBe(0);
    const p1 = result.state?.players.find((entry) => entry.id === controllerId) as any;
    const p2 = result.state?.players.find((entry) => entry.id === opponentId) as any;
    expect(p1.graveyard.length).toBe(0);
    expect(p1.hand.length).toBe(1);
    expect(p2.hand.length).toBe(1);
  });
});
