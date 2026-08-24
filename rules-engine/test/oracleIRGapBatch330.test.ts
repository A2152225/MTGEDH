import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyAttachStep } from '../src/oracleIRExecutorAttachStepHandlers';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneAllExiledCardsWithCounter,
  parseMoveZoneSingleCardFromEachPlayersGraveyard,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 330 — Valigarmanda / Flamewar / Balan', () => {
  it('parses instant or sorcery card from each graveyard selector', () => {
    expect(
      parseMoveZoneSingleCardFromEachPlayersGraveyard({
        kind: 'raw',
        text: 'an instant or sorcery card from each graveyard',
      })
    ).toEqual({ cardType: 'instant_or_sorcery' });
  });

  it('parses all exiled cards you own with intel counters selector', () => {
    expect(
      parseMoveZoneAllExiledCardsWithCounter({
        kind: 'raw',
        text: 'all exiled cards you own with intel counters on them',
      })
    ).toEqual({ counterName: 'intel', controllerOwned: true });
  });

  it('parses Balan attach all Equipment you control step', () => {
    const ir = parseOracleTextToIR(
      'First strike\nBalan has double strike as long as two or more Equipment are attached to it.\n{1}{W}: Attach all Equipment you control to Balan.',
      'Balan, Wandering Knight'
    );
    const attachStep = ir.abilities[2]?.steps?.find((entry) => entry.kind === 'attach');
    expect(attachStep).toBeTruthy();
    expect(String((attachStep as any)?.attachment?.text || '').trim()).toBe('all Equipment you control');
  });

  it('executes Valigarmanda exiling one instant or sorcery from each graveyard', () => {
    const ir = parseOracleTextToIR(
      '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after IV.)\nI — Exile an instant or sorcery card from each graveyard.\nII, III, IV — Add {R} for each lore counter on this Saga.',
      'Summon: Esper Valigarmanda'
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
            { id: 'gy-p1-instant', name: 'P1 Instant', type_line: 'Instant', cmc: 2 },
            { id: 'gy-p1-creature', name: 'P1 Creature', type_line: 'Creature — Elf', cmc: 2 },
          ],
          exile: [],
        },
        {
          id: opponentId,
          library: [],
          hand: [],
          graveyard: [
            { id: 'gy-p2-sorcery', name: 'P2 Sorcery', type_line: 'Sorcery', cmc: 3 },
            { id: 'gy-p2-land', name: 'P2 Land', type_line: 'Basic Land — Island', cmc: 0 },
          ],
          exile: [],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['gy-p1-instant', 'gy-p2-sorcery'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.exile || []).length).toBe(1);
    expect((result.state.players[1]?.exile || []).length).toBe(1);
    expect((result.state.players[0]?.graveyard || []).length).toBe(1);
    expect((result.state.players[1]?.graveyard || []).length).toBe(1);
  });

  it('executes Flamewar returning owned exiled cards with intel counters to hand', () => {
    const ir = parseOracleTextToIR(
      'When this permanent dies, put all exiled cards you own with intel counters on them into your hand.',
      'Flamewar, Brash Veteran // Flamewar, Streetwise Operative'
    );
    const step = ir.abilities[0]?.steps?.find((entry) => entry.kind === 'move_zone');
    expect(step).toBeTruthy();
    const ownedExileCard = {
      id: 'exile-intel-1',
      name: 'Intel Vehicle',
      type_line: 'Artifact — Vehicle',
      owner: controllerId,
      counters: { intel: 1 },
    };
    const state = {
      players: [
        {
          id: controllerId,
          library: [],
          hand: [],
          graveyard: [],
          exile: [ownedExileCard],
        },
        {
          id: opponentId,
          library: [],
          hand: [],
          graveyard: [],
          exile: [
            {
              id: 'exile-intel-opponent-owned',
              name: 'Opponent Intel',
              type_line: 'Instant',
              owner: opponentId,
              counters: { intel: 1 },
            },
          ],
        },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.players[0]?.hand || []).length).toBe(1);
    expect((result.state.players[0]?.exile || []).length).toBe(0);
    expect((result.state.players[1]?.exile || []).length).toBe(1);
  });

  it('executes Balan attaching all Equipment you control to this permanent', () => {
    const ir = parseOracleTextToIR(
      'First strike\nBalan has double strike as long as two or more Equipment are attached to it.\n{1}{W}: Attach all Equipment you control to Balan.',
      'Balan, Wandering Knight'
    );
    const attachStep = ir.abilities[2]?.steps?.find((entry) => entry.kind === 'attach');
    expect(attachStep).toBeTruthy();
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [], exile: [] }],
      battlefield: [
        {
          id: 'bf-balan',
          name: 'Balan',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Legendary Creature — Cat Knight',
          cmc: 3,
        },
        {
          id: 'bf-eq-1',
          name: 'Sword',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Artifact — Equipment',
          cmc: 2,
        },
        {
          id: 'bf-eq-2',
          name: 'Axe',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Artifact — Equipment',
          attachedTo: 'bf-other',
          cmc: 1,
        },
        {
          id: 'bf-other',
          name: 'Other Creature',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Human',
          cmc: 2,
        },
      ],
    } as GameState;
    const result = applyAttachStep(state, attachStep as any, {
      controllerId,
      sourceId: 'bf-balan',
      selectorContext: { chosenObjectIds: ['bf-eq-1', 'bf-eq-2', 'bf-balan'] },
    });
    expect(result.applied).toBe(true);
    const eq1 = (result.state.battlefield || []).find((perm: any) => perm.id === 'bf-eq-1');
    const eq2 = (result.state.battlefield || []).find((perm: any) => perm.id === 'bf-eq-2');
    expect(eq1?.attachedTo).toBe('bf-balan');
    expect(eq2?.attachedTo).toBe('bf-balan');
  });
});
