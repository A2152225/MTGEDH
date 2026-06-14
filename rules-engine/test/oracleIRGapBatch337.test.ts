import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { applyAttachStep } from '../src/oracleIRExecutorAttachStepHandlers';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import {
  parseMoveZoneLastChosenCard,
  parseMoveZoneUpToTargetCardsFromGraveyards,
} from '../src/oracleIRExecutorZoneOps';

const controllerId = 'p1' as PlayerID;
const opponentId = 'p2' as PlayerID;

describe('Oracle IR gap batch 337 — Shrouded Lore / Liliana / Codsworth', () => {
  it('parses Shrouded Lore last-chosen-card selector', () => {
    expect(parseMoveZoneLastChosenCard({ kind: 'raw', text: 'the last chosen card' })).toBe(true);
  });

  it('parses Liliana up-to-two creatures from graveyards selector', () => {
    expect(
      parseMoveZoneUpToTargetCardsFromGraveyards({
        kind: 'raw',
        text: 'up to two creature cards from graveyards',
      })
    ).toEqual({ maxCount: 2, cardType: 'creature' });
  });

  it('executes Shrouded Lore putting last chosen discarded card into controller hand', () => {
    const ir = parseOracleTextToIR(
      'Target opponent discards a card. You draw a card, then put the last chosen card into your hand.',
      'Shrouded Lore'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find(
      (entry) => entry.kind === 'move_zone' && /last chosen card/i.test(String((entry as any).raw || ''))
    );
    expect(step).toBeTruthy();
    const discardedCard = {
      id: 'gy-shrouded-discarded',
      name: 'Shrouded Discarded Card',
      type_line: 'Instant',
      cmc: 2,
    };
    const state = {
      players: [
        { id: controllerId, library: [], hand: [], graveyard: [], exile: [] },
        { id: opponentId, library: [], hand: [], graveyard: [discardedCard], exile: [] },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      targetPlayerId: opponentId,
      lastMovedCards: [discardedCard],
      selectorContext: { targetPlayerId: opponentId, chosenObjectIds: ['gy-shrouded-discarded'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    const controller = result.state.players.find((player) => player.id === controllerId) as any;
    expect(controller.hand.length).toBe(1);
    expect(controller.hand[0]?.id).toBe('gy-shrouded-discarded');
  });

  it('executes Liliana putting up to two creatures from graveyards onto battlefield', () => {
    const ir = parseOracleTextToIR(
      'Put up to two creature cards from graveyards onto the battlefield under your control.',
      'Liliana, the Necromancer'
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
            { id: 'gy-liliana-creature-1', name: 'Liliana Zombie', type_line: 'Creature — Zombie', cmc: 2 },
            { id: 'gy-liliana-creature-2', name: 'Liliana Skeleton', type_line: 'Creature — Skeleton', cmc: 1 },
          ],
          exile: [],
        },
        { id: opponentId, library: [], hand: [], graveyard: [], exile: [] },
      ],
      battlefield: [],
    } as GameState;
    const result = applyOracleIRStepsToGameState(state, [step!], {
      controllerId,
      sourceId: 'test',
      selectorContext: { chosenObjectIds: ['gy-liliana-creature-1', 'gy-liliana-creature-2'] },
    });
    expect(result.automationGaps || []).toHaveLength(0);
    expect((result.state.battlefield || []).length).toBe(2);
    expect((result.state.players[0]?.graveyard || []).length).toBe(0);
  });

  it('executes Codsworth attaching target aura or equipment you control to target creature', () => {
    const ir = parseOracleTextToIR(
      '{T}: Attach target Aura or Equipment you control to target creature you control.',
      'Codsworth, Handy Helper'
    );
    const step = ir.abilities.flatMap((ability) => ability.steps || []).find((entry) => entry.kind === 'attach');
    expect(step).toBeTruthy();
    const state = {
      players: [{ id: controllerId, library: [], hand: [], graveyard: [], exile: [] }],
      battlefield: [
        {
          id: 'bf-codsworth-equipment',
          name: 'Codsworth Equipment',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Artifact — Equipment',
        },
        {
          id: 'bf-codsworth-target',
          name: 'Codsworth Target',
          controller: controllerId,
          owner: controllerId,
          type_line: 'Creature — Human',
          cmc: 2,
        },
      ],
    } as GameState;
    const result = applyAttachStep(state, step as any, {
      controllerId,
      sourceId: 'bf-codsworth-source',
      targetCreatureId: 'bf-codsworth-target',
      selectorContext: { chosenObjectIds: ['bf-codsworth-equipment', 'bf-codsworth-target'] },
    });
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    const equipment = (result.state.battlefield || []).find(
      (perm: any) => String(perm?.id || '').trim() === 'bf-codsworth-equipment'
    ) as any;
    expect(String(equipment?.attachedTo || '').trim()).toBe('bf-codsworth-target');
  });
});
