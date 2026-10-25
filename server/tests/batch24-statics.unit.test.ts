import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { applyAmplifyReveal, queueAmplifyRevealChoice } from '../src/state/modules/amplifyEntry.js';
import {
  applyOptionalDrawStepSkipChoice,
  applyOptionalDrawStepSkipLifeGain,
  queueOptionalDrawStepSkipPrompt,
} from '../src/state/modules/optionalDrawStepSkip.js';
import { findStaticSkipDrawStepSource } from '../../rules-engine/src/phaseTransitionTriggers.js';
import { clearResolvingSpellSource, setResolvingSpellSource } from '../src/state/modules/replacementResolvingSpellSource.js';
import { damageSourceIsInstantOrSorcerySpell } from '../src/state/modules/replacementBatch23DamageCap.js';
import {
  canAttackDespiteDefender,
  defenderAttackTargetRestrictionReason,
} from '../src/socket/combat-handlers/combatDefenderAttackPermission.js';

const gameId = 'test_batch24_statics';
const DOUBLING = 'If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.';
const FASTING = 'At the beginning of your upkeep, put a hunger counter on Fasting. Then destroy Fasting if it has five or more hunger counters on it.\nIf you would begin your draw step, you may skip that step instead. If you do, you gain 2 life.\nWhen you draw a card, destroy Fasting.';

function perm(id: string, name: string, type: string, oracle: string, controller = 'p1'): any {
  return { id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', name, type_line: type, oracle_text: oracle, zone: 'battlefield' } };
}

async function setup(battlefield: any[], hand: any[] = []): Promise<any> {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try { truncateEventsForUndo(gameId, 0); } catch { /* ignore */ }
  await deleteGame(gameId);
  createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
  const game: any = ensureGame(gameId);
  game.state.players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  game.state.life = { p1: 40, p2: 40 };
  game.state.zones = {
    p1: { hand, handCount: hand.length, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    p2: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
  };
  game.state.turnPlayer = 'p1';
  game.state.turnNumber = 5;
  game.state.stack = [];
  game.state.battlefield = battlefield;
  return game;
}

beforeAll(async () => { await initDb(); });
beforeEach(() => { ResolutionQueueManager.removeQueue(gameId); });

describe('batch24 amplify reveal choice', () => {
  it('queues a multi-select OPTION_CHOICE and applies counters through replacements', async () => {
    const brute = perm('brute', 'Zombie Brute', 'Creature - Zombie', 'Amplify 1 (As this creature enters, put a +1/+1 counter on it for each Zombie card you reveal in your hand.)');
    const game = await setup([brute, perm('ds', 'Doubling Season', 'Enchantment', DOUBLING)], [
      { id: 'h1', name: 'Gravedigger', type_line: 'Creature - Zombie' },
      { id: 'h2', name: 'Bear', type_line: 'Creature - Bear' },
      { id: 'h3', name: 'Ghoul', type_line: 'Creature - Zombie' },
    ]);
    expect(queueAmplifyRevealChoice(game, { controller: 'p1', newPermanent: brute, newPermId: 'brute', isReplaying: false })).toBe('queued');
    const step: any = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s.amplifyRevealChoice === true);
    expect(step?.options.map((o: any) => o.id)).toEqual(['h1', 'h3']);
    expect(step?.minSelections).toBe(0);
    expect(step?.maxSelections).toBe(2);
    expect(queueAmplifyRevealChoice(game, { controller: 'p1', newPermanent: brute, newPermId: 'brute', isReplaying: true })).toBe('none');
    expect(applyAmplifyReveal(game, 'brute', 'p1', ['h1', 'h2'])).toBe(1);
    expect(brute.counters['+1/+1']).toBe(2);
    expect(brute.amplifyRevealed).toEqual(['Gravedigger']);
  });
});

describe('batch24 Fasting may-skip', () => {
  it('prompts, skips only when chosen, and gains life once', async () => {
    const fasting = perm('f', 'Fasting', 'Enchantment', FASTING);
    const game = await setup([fasting]);
    expect(findStaticSkipDrawStepSource(game.state, 'p1')).toBeUndefined();
    expect(queueOptionalDrawStepSkipPrompt(game, 'p1')).toBe(true);
    expect(queueOptionalDrawStepSkipPrompt(game, 'p2')).toBe(false);
    applyOptionalDrawStepSkipChoice(game, 'f', false);
    expect(findStaticSkipDrawStepSource(game.state, 'p1')).toBeUndefined();
    applyOptionalDrawStepSkipChoice(game, 'f', true);
    expect(findStaticSkipDrawStepSource(game.state, 'p1')).toBe('Fasting');
    expect(applyOptionalDrawStepSkipLifeGain(game, 'p1')).toBe(2);
    expect(applyOptionalDrawStepSkipLifeGain(game, 'p1')).toBe(0);
    expect(game.state.life.p1).toBe(42);
    game.state.turnNumber = 6;
    expect(findStaticSkipDrawStepSource(game.state, 'p1')).toBeUndefined();
  });
});

describe('batch24 Forethought Amulet after resolution', () => {
  it('remembers instant/sorcery sources after the spell finished resolving', () => {
    const state: any = { stack: [] };
    setResolvingSpellSource(state, { id: 'spell1', cardId: 'card1', card: { name: 'Lightning Bolt', type_line: 'Instant' }, targets: [] });
    clearResolvingSpellSource(state);
    expect(damageSourceIsInstantOrSorcerySpell(state, 'spell1')).toBe(true);
    expect(damageSourceIsInstantOrSorcerySpell(state, 'card1')).toBe(true);
    expect(damageSourceIsInstantOrSorcerySpell(state, 'other')).toBe(false);
  });
});

describe('batch24 Weathered Sentinels', () => {
  it('attacks only players who attacked you during their last turn', () => {
    const ws = perm('ws', 'Weathered Sentinels', 'Artifact Creature - Wall', "Defender, vigilance, reach, trample\nWeathered Sentinels can attack players who attacked you during their last turn as though it didn't have defender.");
    const state: any = { battlefield: [ws], attackedPlayersLastTurnByPlayer: { p2: [], p3: [] } };
    expect(canAttackDespiteDefender(ws, [ws], 'p1', state)).toBe(false);
    state.attackedPlayersLastTurnByPlayer.p2 = ['p1'];
    expect(canAttackDespiteDefender(ws, [ws], 'p1', state)).toBe(true);
    expect(defenderAttackTargetRestrictionReason(ws, 'p2', [ws], state)).toBeNull();
    expect(defenderAttackTargetRestrictionReason(ws, 'p3', [ws], state)).toMatch(/attacked you during their last turn/);
  });
});
