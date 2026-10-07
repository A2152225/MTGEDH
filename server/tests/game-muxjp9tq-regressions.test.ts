import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
import { getLinkedExilesForPermanent } from '../src/state/modules/triggers/linked-exile.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import {
  getContinuousGrantedAbilitiesForPermanent,
  getContinuousPTBonusSourcesForPermanent,
  recomputeContinuousEffects,
} from '../src/state/modules/staticEffectSpec.js';
import { inferTriggeredAbilityTargetMetadata } from '../src/state/modules/inferTriggeredAbilityTargetMetadata.js';
import { permanentHasKeyword } from '../src/socket/game-actions-handlers/gameActionsPermanentKeywordGrants.js';

// Regressions reported from game_muxjp9tq (issues #16-#22).
const gameId = 'test_muxjp9tq_regressions';

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try { truncateEventsForUndo(gameId, 0); } catch {}
  await deleteGame(gameId);
}

function perm(id: string, controller: string, name: string, type_line: string, oracle_text = '', extra: any = {}) {
  return {
    id, controller, owner: controller, tapped: false, counters: {}, ...extra,
    card: { id: `${id}_c`, name, type_line, oracle_text, power: extra.power, toughness: extra.toughness, keywords: extra.keywords || [] },
  };
}

const GRASP_TEXT = "When this enchantment enters, for each opponent, exile up to one target nonland permanent that player controls until this enchantment leaves the battlefield. (Those permanents return under their owners' control.)";
const GRASP_EFFECT = "for each opponent, exile up to one target nonland permanent that player controls until this enchantment leaves the battlefield. (Those permanents return under their owners' control.).";

function setupFourPlayer() {
  createGameIfNotExists(gameId, 'commander', 40, undefined, 'p1');
  const game: any = ensureGame(gameId);
  const ids = ['p1', 'p2', 'p3', 'p4'];
  game.state.players = ids.map((id) => ({ id, name: id, spectator: false, life: 40 }));
  game.state.life = Object.fromEntries(ids.map((id) => [id, 40]));
  game.state.zones = Object.fromEntries(ids.map((id) => [id, { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 }]));
  game.state.turnPlayer = 'p1';
  game.state.priority = 'p1';
  game.state.battlefield = [
    perm('grasp', 'p1', 'Grasp of Fate', 'Enchantment', GRASP_TEXT),
    perm('mine', 'p1', 'Sol Ring', 'Artifact', '{T}: Add {C}{C}.'),
    perm('omnath', 'p2', 'Omnath, Locus of Mana', 'Legendary Creature - Elemental', '', { power: '1', toughness: '1', attachedEquipment: ['boots'] }),
    perm('boots', 'p2', 'Swiftfoot Boots', 'Artifact - Equipment', 'Equipped creature has hexproof and haste.\nEquip {1}', { attachedTo: 'omnath' }),
    perm('gwafa', 'p3', 'Gwafa Hazid, Profiteer', 'Legendary Creature - Human Rogue', '', { power: '2', toughness: '2' }),
    perm('journal', 'p4', "Venser's Journal", 'Artifact', 'You have no maximum hand size.'),
    perm('bell', 'p4', 'Temple Bell', 'Artifact', '{T}: Each player draws a card.'),
  ];
  return game;
}

function graspTrigger(game: any, targets?: string[]) {
  return {
    id: 'grasp_trig', type: 'triggered_ability', controller: 'p1', source: 'grasp', permanentId: 'grasp',
    sourceName: 'Grasp of Fate', triggerType: 'etb', mandatory: true,
    description: GRASP_EFFECT, effect: GRASP_EFFECT,
    ...(targets ? { targets } : {}),
    card: game.state.battlefield[0].card,
  };
}

describe('game_muxjp9tq regressions', () => {
  beforeAll(async () => { await initDb(); await resetGame(); });
  afterEach(async () => { await resetGame(); });

  it('#20a Grasp of Fate exiles the chosen permanent per opponent and returns them when it leaves', () => {
    const game = setupFourPlayer();
    game.state.stack = [graspTrigger(game, ['boots', 'gwafa', 'journal'])];
    game.resolveTopOfStack();

    const bfIds = game.state.battlefield.map((p: any) => p.id);
    expect(bfIds).toContain('omnath');
    expect(bfIds).toContain('bell');
    expect(bfIds).not.toContain('boots');
    expect(bfIds).not.toContain('gwafa');
    expect(bfIds).not.toContain('journal');
    expect(game.state.zones.p2.exile.map((c: any) => c.name)).toEqual(['Swiftfoot Boots']);
    expect(game.state.zones.p3.exile.map((c: any) => c.name)).toEqual(['Gwafa Hazid, Profiteer']);
    expect(game.state.zones.p4.exile.map((c: any) => c.name)).toEqual(["Venser's Journal"]);
    expect(getLinkedExilesForPermanent(game as any, 'grasp')).toHaveLength(3);

    movePermanentToGraveyard(game as any, 'grasp', true);
    const names = game.state.battlefield.map((p: any) => p.card?.name);
    expect(names).toEqual(expect.arrayContaining(['Swiftfoot Boots', 'Gwafa Hazid, Profiteer', "Venser's Journal"]));
  });

  it('#20b trigger target prompt excludes equipment-granted hexproof and your own permanents', () => {
    const game = setupFourPlayer();
    const metadata = inferTriggeredAbilityTargetMetadata(GRASP_EFFECT, { gameState: game.state, controllerId: 'p1' } as any);
    expect(metadata.targetConstraint).toBe('opponent');
    game.state.stack = [{ ...graspTrigger(game), ...metadata }];
    game.resolveTopOfStack();
    const steps = ResolutionQueueManager.getQueue(gameId)?.steps || [];
    const step: any = steps.find((s: any) => s.type === ResolutionStepType.TARGET_SELECTION);
    expect(step).toBeTruthy();
    const ids = (step.validTargets || []).map((t: any) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['boots', 'gwafa', 'journal', 'bell']));
    expect(ids).not.toContain('omnath');
    expect(ids).not.toContain('grasp');
    expect(ids).not.toContain('mine');
    expect(step.minTargets).toBe(0);
  });

  it('#21 Exorcise exiles a targeted artifact', () => {
    const game = setupFourPlayer();
    game.state.stack = [{
      id: 'exo', type: 'spell', controller: 'p1', targets: ['journal'],
      card: { id: 'exo_c', name: 'Exorcise', type_line: 'Sorcery', oracle_text: 'Exile target artifact, enchantment, or creature with power 4 or greater.', mana_cost: '{1}{W}' },
    }];
    game.resolveTopOfStack();
    expect(game.state.battlefield.map((p: any) => p.id)).not.toContain('journal');
    expect(game.state.battlefield.map((p: any) => p.id)).toContain('bell');
    expect(game.state.zones.p4.exile.map((c: any) => c.name)).toEqual(["Venser's Journal"]);
  });

  it('#17 Angel of Vitality adds 1 to triggered life gain', () => {
    const game = setupFourPlayer();
    game.state.battlefield = [
      perm('vit', 'p1', 'Angel of Vitality', 'Creature - Angel', 'Flying\nIf you would gain life, you gain that much life plus 1 instead.\nThis creature gets +2/+2 as long as you have 25 or more life.', { power: '2', toughness: '2' }),
      perm('daz', 'p1', 'Dazzling Angel', 'Creature - Angel', 'Flying\nWhenever another creature you control enters, you gain 1 life.', { power: '2', toughness: '3' }),
    ];
    game.state.stack = [{ id: 'trig1', type: 'triggered_ability', controller: 'p1', source: 'daz', sourceName: 'Dazzling Angel', description: 'you gain 1 life', effect: 'you gain 1 life', triggerType: 'creature_etb', triggeringPermanent: 'daz' }];
    game.resolveTopOfStack();
    expect(game.state.life.p1).toBe(42);
  });

  it('#18 Tome of Legends triggers when your commander enters', () => {
    const game = setupFourPlayer();
    game.commandZone = { p1: { commanderIds: ['cmdr_c'], commanderCards: [] } };
    game.state.commandZone = game.commandZone;
    const tome = perm('tome', 'p1', 'Tome of Legends', 'Artifact', 'This artifact enters with a page counter on it.\nWhenever your commander enters or attacks, put a page counter on this artifact.\n{1}, {T}, Remove a page counter from this artifact: Draw a card.', { counters: { page: 1 } });
    const commander = perm('cmdr', 'p1', 'Some Commander', 'Legendary Creature - Human', '', { power: '3', toughness: '3' });
    game.state.battlefield = [tome, commander];
    game.state.stack = [];
    triggerETBEffectsForPermanent(game as any, commander, 'p1');
    const pending = [...(game.state.stack || []), ...((game.state as any).pendingTriggers || [])];
    expect(pending.some((t: any) => t?.source === 'tome')).toBe(true);
  });
});

describe('game_muxjp9tq static effect regressions', () => {
  function staticState() {
    return {
      players: [{ id: 'p1' }],
      battlefield: [
        perm('aw', 'p1', 'Always Watching', 'Enchantment', 'Nontoken creatures you control get +1/+1 and have vigilance.'),
        perm('seph', 'p1', "Sephara, Sky's Blade", 'Legendary Creature - Angel', "Flying, lifelink\nOther creatures you control with flying have indestructible.", { power: '4', toughness: '3', keywords: ['Flying', 'Lifelink'] }),
        perm('ang', 'p1', 'Serra Angel', 'Creature - Angel', 'Flying, vigilance', { power: '4', toughness: '4', keywords: ['Flying', 'Vigilance'] }),
        perm('bear', 'p1', 'Grizzly Bears', 'Creature - Bear', '', { power: '2', toughness: '2' }),
      ],
    } as any;
  }

  it('#19 Always Watching applies its +1/+1 once', () => {
    const state = staticState();
    recomputeContinuousEffects(state);
    const bear = state.battlefield.find((p: any) => p.id === 'bear');
    const bonus = getContinuousPTBonusSourcesForPermanent(bear, state);
    expect(bonus.power).toBe(1);
    expect(bonus.toughness).toBe(1);
  });

  it('#16 Always Watching vigilance counts when declaring attackers', () => {
    const state = staticState();
    recomputeContinuousEffects(state);
    const bear = state.battlefield.find((p: any) => p.id === 'bear');
    expect(permanentHasKeyword(bear, state.battlefield, 'p1', 'vigilance', state)).toBe(true);
  });

  it('#22 Sephara grants indestructible to other flyers only', () => {
    const state = staticState();
    recomputeContinuousEffects(state);
    const byId = (id: string) => state.battlefield.find((p: any) => p.id === id);
    expect(getContinuousGrantedAbilitiesForPermanent(byId('seph'), state)).not.toContain('indestructible');
    expect(getContinuousGrantedAbilitiesForPermanent(byId('ang'), state)).toContain('indestructible');
    expect(getContinuousGrantedAbilitiesForPermanent(byId('bear'), state)).not.toContain('indestructible');
  });
});
