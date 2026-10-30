import { describe, expect, it } from 'vitest';
import { getAsEntersChoiceRequirements } from '../src/state/modules/asEntersChoiceRequirements.js';
import { queuePermanentAsEntersBattlefieldChoiceSteps } from '../src/state/modules/stackResolvePermanentEtbChoiceUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { detectETBPlayerSelection } from '../src/socket/player-selection.js';
import { games } from '../src/socket/socket.js';
import { abilityAllowsAnyPlayerActivation } from '../../shared/src/anyPlayerActivatedAbility.js';

const XANTCHA_ORACLE =
  "Xantcha enters under the control of an opponent of your choice.\n" +
  "Xantcha attacks each combat if able and can't attack its owner or planeswalkers its owner controls.\n" +
  "{3}: Xantcha's controller loses 2 life and you draw a card. Any player may activate this ability.";

const xantchaCard = {
  name: 'Xantcha, Sleeper Agent',
  oracle_text: XANTCHA_ORACLE,
  type_line: 'Legendary Creature — Phyrexian Minion',
};

describe('Xantcha, Sleeper Agent control-change detection', () => {
  it('treats the enter replacement as a one-shot opponent control change', () => {
    const asEnters = getAsEntersChoiceRequirements(xantchaCard);
    expect(asEnters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'opponent',
          appliesControlChange: true,
        }),
      ]),
    );

    const detection = detectETBPlayerSelection(xantchaCard);
    expect(detection.required).toBe(true);
    expect(detection.effectData?.type).toBe('control_change');
    expect(detection.allowOpponentsOnly).toBe(true);
  });

  it('marks each legal opponent so the player modal does not filter them all out', () => {
    const gameId = 'test_xantcha_as_enters_opponent_flags';
    ResolutionQueueManager.removeQueue(gameId);
    games.set(gameId as any, { isReplaying: true } as any);
    const permanent = { id: 'xantcha_1', controller: 'p1', owner: 'p1', card: xantchaCard };
    queuePermanentAsEntersBattlefieldChoiceSteps({
      gameId,
      state: {
        id: gameId,
        players: [
          { id: 'p1', name: 'Caster', seat: 1, life: 40 },
          { id: 'p2', name: 'Opp', seat: 2, life: 37 },
          { id: 'p3', name: 'Eliminated', seat: 3, life: 0, hasLost: true },
        ],
        life: { p1: 40, p2: 37, p3: 0 },
      },
    } as any, {
      controller: 'p1' as any,
      effectiveCard: xantchaCard,
      newPermanent: permanent,
      newPermId: 'xantcha_1',
      isCreature: true,
    });

    const step = ResolutionQueueManager.getQueue(gameId).steps.find(
      (entry: any) => entry?.type === ResolutionStepType.PLAYER_CHOICE,
    ) as any;
    expect(step?.opponentOnly).toBe(true);
    expect(step?.description).toBe('Choose an opponent to control this permanent');
    expect(step?.players).toEqual([
      expect.objectContaining({ id: 'p2', name: 'Opp', life: 37, isOpponent: true, isSelf: false }),
    ]);
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });
});

describe('Xantcha, Sleeper Agent any-player activation text', () => {
  it('allows the {3} ability even when scoped extract dropped the reminder', () => {
    expect(abilityAllowsAnyPlayerActivation({
      scopedAbilityText: "{3}: Xantcha's controller loses 2 life and you draw a card.",
      cardOracleText: XANTCHA_ORACLE,
    })).toBe(true);
  });

  it('does not treat an unrelated cost as any-player when the reminder is on another ability', () => {
    const oracle =
      "{T}: Add {C}.\n" +
      "{3}: Draw a card. Any player may activate this ability.";
    expect(abilityAllowsAnyPlayerActivation({
      scopedAbilityText: '{T}: Add {C}.',
      cardOracleText: oracle,
    })).toBe(false);
    expect(abilityAllowsAnyPlayerActivation({
      scopedAbilityText: '{3}: Draw a card.',
      cardOracleText: oracle,
    })).toBe(true);
  });
});
