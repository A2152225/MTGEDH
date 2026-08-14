import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState';
import { detectKeywords } from '../src/state/modules/keyword-detection.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const RHYTHM_ORACLE =
  "Creature spells you control can't be countered.\nNontoken creatures you control have riot. (They enter with your choice of a +1/+1 counter or haste.)";

function rhythmPermanent(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: {
      id: `${id}_card`,
      name: 'Rhythm of the Wild',
      type_line: 'Enchantment',
      oracle_text: RHYTHM_ORACLE,
    },
  };
}

function bearPermanent(id: string, controller: string, extras: Record<string, unknown> = {}) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    ...extras,
    card: {
      id: `${id}_card`,
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
    },
  };
}

describe('Rhythm of the Wild riot grant', () => {
  afterEach(() => {
    ResolutionQueueManager.removeQueue('t_rhythm_self');
    ResolutionQueueManager.removeQueue('t_rhythm_bear');
    ResolutionQueueManager.removeQueue('t_rhythm_token');
    ResolutionQueueManager.removeQueue('t_rhythm_innate');
  });

  it('does not treat the grantor as having riot', () => {
    const detected = detectKeywords(RHYTHM_ORACLE, 'Rhythm of the Wild');
    expect(detected.keywords.some((keyword) => keyword.keyword === 'riot')).toBe(false);
  });

  it('does not queue a riot choice when Rhythm of the Wild enters', () => {
    const gameId = 't_rhythm_self';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    const rhythm = rhythmPermanent('rhythm_1', p1);
    (g.state.battlefield as any).push(rhythm);
    triggerETBEffectsForPermanent(g as any, rhythm, p1);

    expect(
      ResolutionQueueManager.getStepsForPlayer(gameId, p1).some(
        (step: any) => step?.type === ResolutionStepType.RIOT_CHOICE,
      ),
    ).toBe(false);
  });

  it('queues riot when a nontoken creature you control enters', () => {
    const gameId = 't_rhythm_bear';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    const rhythm = rhythmPermanent('rhythm_1', p1);
    const bear = bearPermanent('bear_1', p1);
    (g.state.battlefield as any).push(rhythm, bear);
    triggerETBEffectsForPermanent(g as any, bear, p1);

    const riotStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1).find(
      (step: any) => step?.type === ResolutionStepType.RIOT_CHOICE,
    );
    expect(riotStep).toBeTruthy();
    expect((riotStep as any)?.permanentId).toBe('bear_1');
  });

  it('does not queue riot for a token creature', () => {
    const gameId = 't_rhythm_token';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    const rhythm = rhythmPermanent('rhythm_1', p1);
    const token = bearPermanent('token_1', p1, { isToken: true });
    (g.state.battlefield as any).push(rhythm, token);
    triggerETBEffectsForPermanent(g as any, token, p1);

    expect(
      ResolutionQueueManager.getStepsForPlayer(gameId, p1).some(
        (step: any) => step?.type === ResolutionStepType.RIOT_CHOICE,
      ),
    ).toBe(false);
  });

  it('still queues riot for a creature with innate Riot', () => {
    const gameId = 't_rhythm_innate';
    const g = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });

    const rioter = {
      id: 'rioter_1',
      controller: p1,
      owner: p1,
      tapped: false,
      counters: {},
      card: {
        id: 'rioter_1_card',
        name: 'Gruul Spellbreaker',
        type_line: 'Creature — Ogre Warrior',
        oracle_text: 'Riot (This creature enters with your choice of a +1/+1 counter or haste.)',
        power: '3',
        toughness: '3',
      },
    };
    (g.state.battlefield as any).push(rioter);
    triggerETBEffectsForPermanent(g as any, rioter, p1);

    const riotStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1).find(
      (step: any) => step?.type === ResolutionStepType.RIOT_CHOICE,
    );
    expect(riotStep).toBeTruthy();
    expect((riotStep as any)?.permanentId).toBe('rioter_1');
  });
});
