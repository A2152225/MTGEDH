import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { createInitialGameState } from '../src/state/index.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function toReplayEvents(gameId: string, startIndex = 0) {
  return getEvents(gameId)
    .slice(startIndex)
    .map((event: any) =>
      event?.payload && typeof event.payload === 'object'
        ? { type: event.type, ...(event.payload as Record<string, unknown>) }
        : { type: event.type },
    );
}

function buildReflectionsCard() {
  return {
    id: 'reflections_of_littjara_card',
    name: 'Reflections of Littjara',
    type_line: 'Enchantment',
    oracle_text: 'As Reflections of Littjara enters the battlefield, choose a creature type. Whenever you cast a spell of the chosen type, copy that spell. (A copy of a permanent spell becomes a token.)',
  };
}

function buildWizardSpell() {
  return {
    id: 'wizard_spell_1',
    name: 'Arcane Apprentice',
    mana_cost: '',
    manaCost: '{0}',
    type_line: 'Creature — Wizard',
    oracle_text: '',
    power: '2',
    toughness: '2',
  };
}

function buildRetargetingReflectionsCard() {
  return {
    id: 'retargeting_reflections_card',
    name: 'Echoes of the Learned',
    type_line: 'Enchantment',
    oracle_text: 'As Echoes of the Learned enters the battlefield, choose a creature type. Whenever you cast a spell of the chosen type, copy that spell. You may choose new targets for the copy.',
  };
}

function buildTargetedWizardSpell() {
  return {
    id: 'wizard_bolt_1',
    name: 'Wizard Bolt',
    mana_cost: '',
    manaCost: '{0}',
    type_line: 'Instant — Wizard',
    oracle_text: 'Wizard Bolt deals 1 damage to target player.',
  };
}

function buildTargetedWizardAura() {
  return {
    id: 'wizard_aura_1',
    name: 'Wizard Binding',
    mana_cost: '',
    manaCost: '{0}',
    type_line: 'Kindred Enchantment — Aura Wizard',
    oracle_text: 'Enchant creature\nEnchanted creature gets +1/+1.',
  };
}

function buildSwarmIntelligenceCard() {
  return {
    id: 'swarm_intelligence_card',
    name: 'Swarm Intelligence',
    type_line: 'Enchantment',
    oracle_text: 'Whenever you cast an instant or sorcery spell, you may copy that spell. You may choose new targets for the copy.',
  };
}

function buildDoubleVisionCard() {
  return {
    id: 'double_vision_card',
    name: 'Double Vision',
    type_line: 'Enchantment',
    oracle_text: 'Whenever you cast your first instant or sorcery spell each turn, copy that spell. You may choose new targets for the copy.',
  };
}

function buildEchoesOfEternityCard() {
  return {
    id: 'echoes_of_eternity_card',
    name: 'Echoes of Eternity',
    type_line: 'Kindred Enchantment — Eldrazi',
    oracle_text: 'Whenever you cast a colorless spell, copy it. You may choose new targets for the copy. (A copy of a permanent spell becomes a token.)',
    colors: [],
    color_identity: [],
  };
}

function buildMelekCard() {
  return {
    id: 'melek_card',
    name: 'Melek, Izzet Paragon',
    type_line: 'Legendary Creature — Weird Wizard',
    oracle_text: 'Play with the top card of your library revealed. You may cast instant and sorcery spells from the top of your library. Whenever you cast an instant or sorcery spell from your library, copy it. You may choose new targets for the copy.',
  };
}

function buildSevinneCard() {
  return {
    id: 'sevinne_card',
    name: 'Sevinne, the Chronoclasm',
    type_line: 'Legendary Creature — Human Wizard',
    oracle_text: 'Prevent all damage that would be dealt to Sevinne. Whenever you cast your first instant or sorcery spell from your graveyard each turn, copy that spell. You may choose new targets for the copy.',
  };
}

function buildFlashbackDrawSpell() {
  return {
    id: 'flashback_draw_1',
    name: 'Think Twice',
    mana_cost: '{1}{U}',
    manaCost: '{1}{U}',
    type_line: 'Instant',
    oracle_text: 'Draw a card. Flashback {U}.',
    zone: 'graveyard',
  };
}

function buildTargetedColorlessSpell() {
  return {
    id: 'colorless_bolt_1',
    name: 'Null Ray',
    type_line: 'Instant',
    mana_cost: '',
    oracle_text: 'Null Ray deals 3 damage to any target.',
    colors: [],
    color_identity: [],
  };
}

function buildTargetedLibrarySpell() {
  return {
    id: 'library_bolt_1',
    name: 'Library Bolt',
    mana_cost: '',
    manaCost: '{0}',
    type_line: 'Instant',
    oracle_text: 'Library Bolt deals 2 damage to target player.',
  };
}

function buildTargetedHandSpell() {
  return {
    id: 'hand_bolt_1',
    name: 'Hand Bolt',
    mana_cost: '',
    manaCost: '{0}',
    type_line: 'Instant',
    oracle_text: 'Hand Bolt deals 2 damage to target player.',
  };
}

function seedSpellCopyTriggerGame(game: any, includeHand = true) {
  (game.state as any).players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { p1: 40, p2: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).priority = 'p1';
  (game.state as any).activePlayer = 'p1';
  (game.state as any).turnPlayer = 'p1';
  (game.state as any).turnNumber = 3;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [
    {
      id: 'reflections_perm_1',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      chosenCreatureType: 'Wizard',
      card: { ...buildReflectionsCard(), zone: 'battlefield' },
    },
  ];
  (game.state as any).manaPool = {
    p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).zones = {
    p1: {
      hand: includeHand ? [buildWizardSpell()] : [],
      handCount: includeHand ? 1 : 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      library: [],
      libraryCount: 0,
    },
    p2: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      library: [],
      libraryCount: 0,
    },
  };
}

describe('spell-cast copy replay integration', () => {
  const gameId = 'test_spell_cast_copy_replay_integration';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
  });

  beforeEach(async () => {
    await resetGame(gameId);
    await resetGame(`${gameId}_replay`);
  });

  afterEach(async () => {
    await resetGame(gameId);
    await resetGame(`${gameId}_replay`);
  });

  it('copies chosen-type spells onto the stack and replays copied permanent spells as tokens', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedSpellCopyTriggerGame(game, true);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);
    const eventStart = getEvents(gameId).length;

    await handlers['castSpellFromHand']({
      gameId,
      cardId: 'wizard_spell_1',
      targets: [],
    });

    expect((game.state as any).stack).toHaveLength(2);
    const originalSpell = ((game.state as any).stack || []).find((item: any) => !item?.copiedFromStackItemId);
    const copiedSpell = ((game.state as any).stack || []).find((item: any) => item?.copiedFromStackItemId);
    expect(originalSpell).toBeDefined();
    expect(copiedSpell).toBeDefined();
    expect(copiedSpell?.copiedFromStackItemId).toBe(originalSpell?.id);
    expect(copiedSpell?.isCopy).toBe(true);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toEqual([]);

    game.resolveTopOfStack();
    const copiedPermanent = ((game.state as any).battlefield || []).find((perm: any) => perm?.card?.name === 'Arcane Apprentice' && perm?.isToken === true);
    expect(copiedPermanent).toBeDefined();
    expect(copiedPermanent?.card?.isToken).toBe(true);

    game.resolveTopOfStack();
    const apprenticePermanents = ((game.state as any).battlefield || []).filter((perm: any) => perm?.card?.name === 'Arcane Apprentice');
    expect(apprenticePermanents).toHaveLength(2);
    expect(apprenticePermanents.some((perm: any) => perm?.isToken === true)).toBe(true);
    expect(apprenticePermanents.some((perm: any) => perm?.isToken !== true)).toBe(true);

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining(['castSpell', 'copyTriggeredSpellResolve']),
    );

    const replayGameId = `${gameId}_replay`;
    const replayGame = createInitialGameState(replayGameId);
    seedSpellCopyTriggerGame(replayGame, true);

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }
    if (typeof replayGame.resolveTopOfStack !== 'function') {
      throw new Error('replayGame.resolveTopOfStack is not available');
    }

    replayGame.replay(replayEvents as any);

    expect((replayGame.state as any).stack).toHaveLength(2);
    const replayOriginalSpell = ((replayGame.state as any).stack || []).find((item: any) => !item?.copiedFromStackItemId);
    const replayCopiedSpell = ((replayGame.state as any).stack || []).find((item: any) => item?.copiedFromStackItemId);
    expect(replayCopiedSpell?.copiedFromStackItemId).toBe(replayOriginalSpell?.id);
    expect(ResolutionQueueManager.getQueue(replayGameId).steps).toEqual([]);

    replayGame.resolveTopOfStack();
    replayGame.resolveTopOfStack();

    const replayApprenticePermanents = ((replayGame.state as any).battlefield || []).filter((perm: any) => perm?.card?.name === 'Arcane Apprentice');
    expect(replayApprenticePermanents).toHaveLength(2);
    expect(replayApprenticePermanents.some((perm: any) => perm?.isToken === true)).toBe(true);
    expect(replayApprenticePermanents.some((perm: any) => perm?.isToken !== true)).toBe(true);
  });

  it('queues and replays retarget prompts for copied chosen-type targeted spells', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedSpellCopyTriggerGame(game, false);
    (game.state as any).battlefield[0] = {
      ...(game.state as any).battlefield[0],
      card: { ...buildRetargetingReflectionsCard(), zone: 'battlefield' },
    };
    (game.state as any).zones.p1.hand = [buildTargetedWizardSpell()];
    (game.state as any).zones.p1.handCount = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);
    const eventStart = getEvents(gameId).length;

    await handlers['castSpellFromHand']({
      gameId,
      cardId: 'wizard_bolt_1',
      targets: [{ id: 'p2', kind: 'player' }],
    });

    expect((game.state as any).stack).toHaveLength(2);
    const copiedSpell = ((game.state as any).stack || []).find((item: any) => item?.copiedFromStackItemId);
    expect(copiedSpell).toBeDefined();
    expect(copiedSpell?.targets).toEqual([{ id: 'p2', kind: 'player' }]);

    const retargetChoiceStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((step: any) => (step as any).retargetSpellCopy === true);
    expect(retargetChoiceStep).toBeDefined();
    expect((retargetChoiceStep as any)?.retargetSpellCopyStackItemId).toBe(copiedSpell?.id);
    expect((retargetChoiceStep as any)?.retargetSpellCopyValidTargets.map((target: any) => String(target?.id || ''))).toEqual(
      expect.arrayContaining(['p1', 'p2']),
    );

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining(['castSpell', 'copyTriggeredSpellResolve', 'castSpellContinuation']),
    );

    const promptEvent = replayEvents.find((event: any) => {
      if (event.type !== 'castSpellContinuation') return false;
      return (event as any)?.queuedResolutionStep?.retargetSpellCopy === true;
    });
    expect(promptEvent).toBeDefined();
    expect((promptEvent as any)?.queuedResolutionStep?.retargetSpellCopyStackItemId).toBe(copiedSpell?.id);

    const replayGameId = `${gameId}_replay`;
    const replayGame = createInitialGameState(replayGameId);
    seedSpellCopyTriggerGame(replayGame, false);
    (replayGame.state as any).battlefield[0] = {
      ...(replayGame.state as any).battlefield[0],
      card: { ...buildRetargetingReflectionsCard(), zone: 'battlefield' },
    };
    (replayGame.state as any).zones.p1.hand = [buildTargetedWizardSpell()];
    (replayGame.state as any).zones.p1.handCount = 1;

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    expect((replayGame.state as any).stack).toHaveLength(2);
    const replayCopiedSpell = ((replayGame.state as any).stack || []).find((item: any) => item?.copiedFromStackItemId);
    expect(replayCopiedSpell).toBeDefined();

    const replayRetargetChoiceStep = ResolutionQueueManager
      .getQueue(replayGameId)
      .steps.find((step: any) => (step as any).retargetSpellCopy === true);
    expect(replayRetargetChoiceStep).toBeDefined();
    expect((replayRetargetChoiceStep as any)?.retargetSpellCopyStackItemId).toBe(replayCopiedSpell?.id);
    expect((replayRetargetChoiceStep as any)?.retargetSpellCopyValidTargets.map((target: any) => String(target?.id || ''))).toEqual(
      expect.arrayContaining(['p1', 'p2']),
    );
  });

  it('retargets copied chosen-type targeted spells through resolution and replays the resolved targets', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedSpellCopyTriggerGame(game, false);
    (game.state as any).battlefield[0] = {
      ...(game.state as any).battlefield[0],
      card: { ...buildRetargetingReflectionsCard(), zone: 'battlefield' },
    };
    (game.state as any).zones.p1.hand = [buildTargetedWizardSpell()];
    (game.state as any).zones.p1.handCount = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);
    const eventStart = getEvents(gameId).length;

    await handlers['castSpellFromHand']({
      gameId,
      cardId: 'wizard_bolt_1',
      targets: [{ id: 'p2', kind: 'player' }],
    });

    const copiedSpell = ((game.state as any).stack || []).find((item: any) => item?.copiedFromStackItemId);
    expect(copiedSpell).toBeDefined();

    const retargetChoiceStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((step: any) => (step as any).retargetSpellCopy === true);
    expect(retargetChoiceStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((retargetChoiceStep as any).id),
      selections: ['retarget'],
      cancelled: false,
    });

    const retargetTargetStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((step: any) => (step as any).retargetSpellCopyTargetSelection === true);
    expect(retargetTargetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((retargetTargetStep as any).id),
      selections: ['p1'],
      cancelled: false,
    });

    const updatedCopiedSpell = ((game.state as any).stack || []).find((item: any) => item?.id === copiedSpell?.id);
    expect(updatedCopiedSpell?.targets).toEqual(['p1']);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toEqual([]);

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining(['copyTriggeredSpellResolve', 'copyRetargetChoiceResolve', 'resolveTopOfStackPrompt', 'retargetSpellCopyResolve']),
    );

    const replayGameId = `${gameId}_replay`;
    const replayGame = createInitialGameState(replayGameId);
    seedSpellCopyTriggerGame(replayGame, false);
    (replayGame.state as any).battlefield[0] = {
      ...(replayGame.state as any).battlefield[0],
      card: { ...buildRetargetingReflectionsCard(), zone: 'battlefield' },
    };
    (replayGame.state as any).zones.p1.hand = [buildTargetedWizardSpell()];
    (replayGame.state as any).zones.p1.handCount = 1;

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    const replayCopiedSpell = ((replayGame.state as any).stack || []).find((item: any) => item?.copiedFromStackItemId);
    expect(replayCopiedSpell?.targets).toEqual(['p1']);
    expect(ResolutionQueueManager.getQueue(replayGameId).steps).toEqual([]);
  });

  it('queues and replays retarget prompts for copied chosen-type Aura spells', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedSpellCopyTriggerGame(game, false);
    (game.state as any).battlefield = [
      {
        id: 'reflections_perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        chosenCreatureType: 'Wizard',
        card: { ...buildRetargetingReflectionsCard(), zone: 'battlefield' },
      },
      {
        id: 'friendly_creature_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'friendly_creature_card_1',
          name: 'Friendly Adept',
          type_line: 'Creature — Wizard',
          power: '2',
          toughness: '2',
          zone: 'battlefield',
        },
      },
      {
        id: 'enemy_creature_1',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'enemy_creature_card_1',
          name: 'Enemy Adept',
          type_line: 'Creature — Wizard',
          power: '2',
          toughness: '2',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).zones.p1.hand = [buildTargetedWizardAura()];
    (game.state as any).zones.p1.handCount = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerGameActions(io as any, socket as any);
    const eventStart = getEvents(gameId).length;

    await handlers['castSpellFromHand']({
      gameId,
      cardId: 'wizard_aura_1',
      targets: [{ id: 'enemy_creature_1', kind: 'permanent' }],
    });

    expect((game.state as any).stack).toHaveLength(2);
    const copiedSpell = ((game.state as any).stack || []).find((item: any) => item?.copiedFromStackItemId);
    expect(copiedSpell).toBeDefined();

    const retargetChoiceStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((step: any) => (step as any).retargetSpellCopy === true);
    expect(retargetChoiceStep).toBeDefined();
    expect((retargetChoiceStep as any)?.retargetSpellCopyStackItemId).toBe(copiedSpell?.id);
    expect((retargetChoiceStep as any)?.retargetSpellCopyValidTargets.map((target: any) => String(target?.id || ''))).toEqual(
      expect.arrayContaining(['friendly_creature_1', 'enemy_creature_1']),
    );

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining(['castSpell', 'copyTriggeredSpellResolve', 'castSpellContinuation']),
    );

    const replayGameId = `${gameId}_replay`;
    const replayGame = createInitialGameState(replayGameId);
    seedSpellCopyTriggerGame(replayGame, false);
    (replayGame.state as any).battlefield = [
      {
        id: 'reflections_perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        chosenCreatureType: 'Wizard',
        card: { ...buildRetargetingReflectionsCard(), zone: 'battlefield' },
      },
      {
        id: 'friendly_creature_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: {
          id: 'friendly_creature_card_1',
          name: 'Friendly Adept',
          type_line: 'Creature — Wizard',
          power: '2',
          toughness: '2',
          zone: 'battlefield',
        },
      },
      {
        id: 'enemy_creature_1',
        controller: 'p2',
        owner: 'p2',
        tapped: false,
        card: {
          id: 'enemy_creature_card_1',
          name: 'Enemy Adept',
          type_line: 'Creature — Wizard',
          power: '2',
          toughness: '2',
          zone: 'battlefield',
        },
      },
    ];
    (replayGame.state as any).zones.p1.hand = [buildTargetedWizardAura()];
    (replayGame.state as any).zones.p1.handCount = 1;

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    expect((replayGame.state as any).stack).toHaveLength(2);
    const replayRetargetChoiceStep = ResolutionQueueManager
      .getQueue(replayGameId)
      .steps.find((step: any) => (step as any).retargetSpellCopy === true);
    expect(replayRetargetChoiceStep).toBeDefined();
    expect((replayRetargetChoiceStep as any)?.retargetSpellCopyValidTargets.map((target: any) => String(target?.id || ''))).toEqual(
      expect.arrayContaining(['friendly_creature_1', 'enemy_creature_1']),
    );
  });

  it('queues and replays retarget prompts for generic instant-sorcery spell copy triggers', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedSpellCopyTriggerGame(game, false);
    (game.state as any).battlefield = [
      {
        id: 'swarm_perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: { ...buildSwarmIntelligenceCard(), zone: 'battlefield' },
      },
    ];
    (game.state as any).zones.p1.hand = [buildTargetedWizardSpell()];
    (game.state as any).zones.p1.handCount = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);
    const eventStart = getEvents(gameId).length;

    await handlers['castSpellFromHand']({
      gameId,
      cardId: 'wizard_bolt_1',
      targets: [{ id: 'p2', kind: 'player' }],
    });

    expect((game.state as any).stack).toHaveLength(2);
    const copiedSpell = ((game.state as any).stack || []).find((item: any) => item?.copiedFromStackItemId);
    expect(copiedSpell).toBeDefined();

    const retargetChoiceStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((step: any) => (step as any).retargetSpellCopy === true);
    expect(retargetChoiceStep).toBeDefined();
    expect((retargetChoiceStep as any)?.retargetSpellCopyStackItemId).toBe(copiedSpell?.id);
    expect((retargetChoiceStep as any)?.retargetSpellCopyValidTargets.map((target: any) => String(target?.id || ''))).toEqual(
      expect.arrayContaining(['p1', 'p2']),
    );

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining(['castSpell', 'copyTriggeredSpellResolve', 'castSpellContinuation']),
    );

    const replayGameId = `${gameId}_replay`;
    const replayGame = createInitialGameState(replayGameId);
    seedSpellCopyTriggerGame(replayGame, false);
    (replayGame.state as any).battlefield = [
      {
        id: 'swarm_perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: { ...buildSwarmIntelligenceCard(), zone: 'battlefield' },
      },
    ];
    (replayGame.state as any).zones.p1.hand = [buildTargetedWizardSpell()];
    (replayGame.state as any).zones.p1.handCount = 1;

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    expect((replayGame.state as any).stack).toHaveLength(2);
    const replayRetargetChoiceStep = ResolutionQueueManager
      .getQueue(replayGameId)
      .steps.find((step: any) => (step as any).retargetSpellCopy === true);
    expect(replayRetargetChoiceStep).toBeDefined();
    expect((replayRetargetChoiceStep as any)?.retargetSpellCopyValidTargets.map((target: any) => String(target?.id || ''))).toEqual(
      expect.arrayContaining(['p1', 'p2']),
    );
  });

  it('queues and replays retarget prompts for first instant-sorcery spell copy triggers each turn', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedSpellCopyTriggerGame(game, false);
    (game.state as any).battlefield = [
      {
        id: 'double_vision_perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: { ...buildDoubleVisionCard(), zone: 'battlefield' },
      },
    ];
    (game.state as any).spellsCastThisTurn = [
      {
        id: 'prior_creature_spell',
        name: 'Bear Cub',
        casterId: 'p1',
        ts: 1,
        card: {
          id: 'prior_creature_spell',
          name: 'Bear Cub',
          type_line: 'Creature — Bear',
        },
      },
    ];
    (game.state as any).zones.p1.hand = [buildTargetedWizardSpell()];
    (game.state as any).zones.p1.handCount = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);
    const eventStart = getEvents(gameId).length;

    await handlers['castSpellFromHand']({
      gameId,
      cardId: 'wizard_bolt_1',
      targets: [{ id: 'p2', kind: 'player' }],
    });

    expect((game.state as any).stack).toHaveLength(2);
    const copiedSpell = ((game.state as any).stack || []).find((item: any) => item?.copiedFromStackItemId);
    expect(copiedSpell).toBeDefined();

    const retargetChoiceStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((step: any) => (step as any).retargetSpellCopy === true);
    expect(retargetChoiceStep).toBeDefined();
    expect((retargetChoiceStep as any)?.retargetSpellCopyStackItemId).toBe(copiedSpell?.id);
    expect((retargetChoiceStep as any)?.retargetSpellCopyValidTargets.map((target: any) => String(target?.id || ''))).toEqual(
      expect.arrayContaining(['p1', 'p2']),
    );

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining(['castSpell', 'copyTriggeredSpellResolve', 'castSpellContinuation']),
    );

    const replayGameId = `${gameId}_replay`;
    const replayGame = createInitialGameState(replayGameId);
    seedSpellCopyTriggerGame(replayGame, false);
    (replayGame.state as any).battlefield = [
      {
        id: 'double_vision_perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: { ...buildDoubleVisionCard(), zone: 'battlefield' },
      },
    ];
    (replayGame.state as any).spellsCastThisTurn = [
      {
        id: 'prior_creature_spell',
        name: 'Bear Cub',
        casterId: 'p1',
        ts: 1,
        card: {
          id: 'prior_creature_spell',
          name: 'Bear Cub',
          type_line: 'Creature — Bear',
        },
      },
    ];
    (replayGame.state as any).zones.p1.hand = [buildTargetedWizardSpell()];
    (replayGame.state as any).zones.p1.handCount = 1;

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    expect((replayGame.state as any).stack).toHaveLength(2);
    const replayRetargetChoiceStep = ResolutionQueueManager
      .getQueue(replayGameId)
      .steps.find((step: any) => (step as any).retargetSpellCopy === true);
    expect(replayRetargetChoiceStep).toBeDefined();
    expect((replayRetargetChoiceStep as any)?.retargetSpellCopyValidTargets.map((target: any) => String(target?.id || ''))).toEqual(
      expect.arrayContaining(['p1', 'p2']),
    );
  });

  it('queues and replays retarget prompts for colorless spell copy triggers', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedSpellCopyTriggerGame(game, false);
    (game.state as any).battlefield = [
      {
        id: 'echoes_perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: { ...buildEchoesOfEternityCard(), zone: 'battlefield' },
      },
    ];
    (game.state as any).zones.p1.hand = [buildTargetedColorlessSpell()];
    (game.state as any).zones.p1.handCount = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);
    const eventStart = getEvents(gameId).length;

    await handlers['castSpellFromHand']({
      gameId,
      cardId: 'colorless_bolt_1',
      targets: [{ id: 'p2', kind: 'player' }],
    });

    expect((game.state as any).stack).toHaveLength(2);
    const copiedSpell = ((game.state as any).stack || []).find((item: any) => item?.copiedFromStackItemId);
    expect(copiedSpell).toBeDefined();

    const retargetChoiceStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((step: any) => (step as any).retargetSpellCopy === true);
    expect(retargetChoiceStep).toBeDefined();
    expect((retargetChoiceStep as any)?.retargetSpellCopyStackItemId).toBe(copiedSpell?.id);
    expect((retargetChoiceStep as any)?.retargetSpellCopyValidTargets.map((target: any) => String(target?.id || ''))).toEqual(
      expect.arrayContaining(['p1', 'p2']),
    );

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining(['castSpell', 'copyTriggeredSpellResolve', 'castSpellContinuation']),
    );

    const replayGameId = `${gameId}_replay`;
    const replayGame = createInitialGameState(replayGameId);
    seedSpellCopyTriggerGame(replayGame, false);
    (replayGame.state as any).battlefield = [
      {
        id: 'echoes_perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: { ...buildEchoesOfEternityCard(), zone: 'battlefield' },
      },
    ];
    (replayGame.state as any).zones.p1.hand = [buildTargetedColorlessSpell()];
    (replayGame.state as any).zones.p1.handCount = 1;

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    expect((replayGame.state as any).stack).toHaveLength(2);
    const replayRetargetChoiceStep = ResolutionQueueManager
      .getQueue(replayGameId)
      .steps.find((step: any) => (step as any).retargetSpellCopy === true);
    expect(replayRetargetChoiceStep).toBeDefined();
    expect((replayRetargetChoiceStep as any)?.retargetSpellCopyValidTargets.map((target: any) => String(target?.id || ''))).toEqual(
      expect.arrayContaining(['p1', 'p2']),
    );
  });

  it('does not copy hand-cast spells for library-qualified copy triggers', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedSpellCopyTriggerGame(game, false);
    (game.state as any).battlefield = [
      {
        id: 'melek_perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: { ...buildMelekCard(), zone: 'battlefield' },
      },
    ];
    (game.state as any).zones.p1.hand = [buildTargetedHandSpell()];
    (game.state as any).zones.p1.handCount = 1;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['castSpellFromHand']({
      gameId,
      cardId: 'hand_bolt_1',
      targets: [{ id: 'p2', kind: 'player' }],
    });

    expect((game.state as any).stack).toHaveLength(1);
    expect((((game.state as any).stack || []) as any[]).some((item: any) => item?.copiedFromStackItemId)).toBe(false);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((step: any) => (step as any).retargetSpellCopy === true)).toBe(false);
  });

  it('queues and replays retarget prompts for library-qualified spell copy triggers', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedSpellCopyTriggerGame(game, false);
    (game.state as any).battlefield = [
      {
        id: 'melek_perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: { ...buildMelekCard(), zone: 'battlefield' },
      },
    ];
    (game.state as any).zones.p1.libraryCount = 1;
    (game as any).libraries = new Map<string, any[]>([
      ['p1', [buildTargetedLibrarySpell()]],
      ['p2', []],
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);
    const eventStart = getEvents(gameId).length;

    await handlers['castSpellFromHand']({
      gameId,
      cardId: 'library_bolt_1',
      fromZone: 'library',
      targets: [{ id: 'p2', kind: 'player' }],
    });

    expect((game.state as any).stack).toHaveLength(2);
    const copiedSpell = ((game.state as any).stack || []).find((item: any) => item?.copiedFromStackItemId);
    expect(copiedSpell).toBeDefined();

    const retargetChoiceStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps.find((step: any) => (step as any).retargetSpellCopy === true);
    expect(retargetChoiceStep).toBeDefined();
    expect((retargetChoiceStep as any)?.retargetSpellCopyStackItemId).toBe(copiedSpell?.id);
    expect((retargetChoiceStep as any)?.retargetSpellCopyValidTargets.map((target: any) => String(target?.id || ''))).toEqual(
      expect.arrayContaining(['p1', 'p2']),
    );

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining(['castSpell', 'copyTriggeredSpellResolve', 'castSpellContinuation']),
    );

    const replayGameId = `${gameId}_replay`;
    const replayGame = createInitialGameState(replayGameId);
    seedSpellCopyTriggerGame(replayGame, false);
    (replayGame.state as any).battlefield = [
      {
        id: 'melek_perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: { ...buildMelekCard(), zone: 'battlefield' },
      },
    ];
    (replayGame.state as any).zones.p1.libraryCount = 1;
    (replayGame as any).libraries = new Map<string, any[]>([
      ['p1', [buildTargetedLibrarySpell()]],
      ['p2', []],
    ]);

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    expect((replayGame.state as any).stack).toHaveLength(2);
    const replayRetargetChoiceStep = ResolutionQueueManager
      .getQueue(replayGameId)
      .steps.find((step: any) => (step as any).retargetSpellCopy === true);
    expect(replayRetargetChoiceStep).toBeDefined();
    expect((replayRetargetChoiceStep as any)?.retargetSpellCopyValidTargets.map((target: any) => String(target?.id || ''))).toEqual(
      expect.arrayContaining(['p1', 'p2']),
    );
  });

  it('copies and replays the first instant-sorcery spell cast from your graveyard each turn', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedSpellCopyTriggerGame(game, false);
    (game.state as any).battlefield = [
      {
        id: 'sevinne_perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: { ...buildSevinneCard(), zone: 'battlefield' },
      },
    ];
    (game.state as any).spellsCastThisTurn = [
      {
        id: 'prior_hand_instant',
        name: 'Prior Hand Instant',
        casterId: 'p1',
        ts: 1,
        castSourceZone: 'hand',
        card: {
          id: 'prior_hand_instant',
          name: 'Prior Hand Instant',
          type_line: 'Instant',
          castSourceZone: 'hand',
        },
      },
    ];
    (game.state as any).zones.p1.graveyard = [buildFlashbackDrawSpell()];
    (game.state as any).zones.p1.graveyardCount = 1;
    (game.state as any).manaPool = {
      p1: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);
    const eventStart = getEvents(gameId).length;

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId: 'flashback_draw_1',
      abilityId: 'flashback',
    });

    expect((game.state as any).stack).toHaveLength(2);
    const copiedSpell = ((game.state as any).stack || []).find((item: any) => item?.copiedFromStackItemId);
    expect(copiedSpell).toBeDefined();

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining(['activateGraveyardAbility', 'copyTriggeredSpellResolve']),
    );

    const replayGameId = `${gameId}_replay`;
    const replayGame = createInitialGameState(replayGameId);
    seedSpellCopyTriggerGame(replayGame, false);
    (replayGame.state as any).battlefield = [
      {
        id: 'sevinne_perm_1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        card: { ...buildSevinneCard(), zone: 'battlefield' },
      },
    ];
    (replayGame.state as any).spellsCastThisTurn = [
      {
        id: 'prior_hand_instant',
        name: 'Prior Hand Instant',
        casterId: 'p1',
        ts: 1,
        castSourceZone: 'hand',
        card: {
          id: 'prior_hand_instant',
          name: 'Prior Hand Instant',
          type_line: 'Instant',
          castSourceZone: 'hand',
        },
      },
    ];
    (replayGame.state as any).zones.p1.graveyard = [buildFlashbackDrawSpell()];
    (replayGame.state as any).zones.p1.graveyardCount = 1;

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    expect((replayGame.state as any).stack).toHaveLength(2);
    expect(((replayGame.state as any).stack || []).some((item: any) => item?.copiedFromStackItemId)).toBe(true);
    expect(
      ((replayGame.state as any).spellsCastThisTurn || []).some(
        (entry: any) => String(entry?.id || '') === 'flashback_draw_1' && String(entry?.castSourceZone || '') === 'graveyard'
      )
    ).toBe(true);
  });
});
