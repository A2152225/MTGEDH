import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializeAIResolutionHandler, initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { applyEvent } from '../src/state/modules/applyEvent.js';
import { parseCraftAbilityText } from '../src/state/modules/craftAbility.js';
import '../src/state/modules/priority.js';

// Round 8 item 1: generic Craft (CR 702.167). Live path: activateBattlefieldAbility -> material
// selection (TARGET_SELECTION, craftMaterialSelection, permanents + graveyard cards) -> mana paid,
// materials and source exiled -> craft ability on the stack -> resolves: the card returns transformed
// and remembers the exiled materials. Craft is sorcery-speed; nothing is paid before confirmation.
const gameId = 'test_craft_generic_activation';
type Emitted = Array<{ room?: string; event: string; payload: any }>;

function createMockIo(emitted: Emitted) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, emitted: Emitted) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
  } as any;
  return { socket, handlers };
}

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try { await deleteGame(gameId); } catch { /* fresh db */ }
}

function perm(id: string, controller: string, card: any, extra: any = {}) {
  return { id, controller, owner: controller, tapped: false, summoningSickness: false, counters: {}, damage: 0,
    card: { id: `${id}_card`, zone: 'battlefield', ...card }, ...extra };
}
const creature = (name: string, subtype: string, oracle = '') => ({ name, type_line: `Creature — ${subtype}`, power: '2', toughness: '2', oracle_text: oracle });
const gyCard = (id: string, name: string, typeLine: string) => ({ id, name, type_line: typeLine, zone: 'graveyard', power: '1', toughness: '1' });

const DIRE_FLAIL_TEXT = 'Equipped creature gets +2/+0.\nEquip {1}\nCraft with artifact {3}{R}{R} ({3}{R}{R}, Exile this Equipment, Exile another artifact you control or an artifact card from your graveyard: Return this card transformed under its owner\'s control. Craft only as a sorcery.)';
const DIRE_FLAIL = {
  name: 'Dire Flail', layout: 'transform', type_line: 'Artifact — Equipment', mana_cost: '{R}', oracle_text: DIRE_FLAIL_TEXT,
  card_faces: [
    { name: 'Dire Flail', type_line: 'Artifact — Equipment', mana_cost: '{R}', oracle_text: DIRE_FLAIL_TEXT },
    { name: 'Dire Blunderbuss', type_line: 'Artifact — Equipment', mana_cost: '', oracle_text: 'Equipped creature gets +3/+0.\nEquip {1}' },
  ],
};
const THRONE_TEXT = '{T}: Mill two cards.\nCraft with a Dinosaur, a Merfolk, a Pirate, and a Vampire {4} ({4}, Exile this artifact, Exile the four from among other permanents you control and/or cards in your graveyard: Return this card transformed under its owner\'s control. Craft only as a sorcery.)';
const THRONE = {
  name: 'Throne of the Grim Captain', layout: 'transform', type_line: 'Legendary Artifact', mana_cost: '{4}', oracle_text: THRONE_TEXT,
  card_faces: [
    { name: 'Throne of the Grim Captain', type_line: 'Legendary Artifact', mana_cost: '{4}', oracle_text: THRONE_TEXT },
    { name: 'The Grim Captain', type_line: 'Legendary Creature — Skeleton Spirit Pirate', mana_cost: '', power: '7', toughness: '7', oracle_text: 'Menace, trample, lifelink, hexproof' },
  ],
};
const EYE_TEXT = '{T}: Add one mana of any color.\nCraft with two that share a card type {6} ({6}, Exile this artifact, Exile the two from among other permanents you control and/or cards in your graveyard: Return this card transformed under its owner\'s control. Craft only as a sorcery.)';
const EYE = {
  name: 'Eye of Ojer Taq', layout: 'transform', type_line: 'Artifact', mana_cost: '{3}', oracle_text: EYE_TEXT,
  card_faces: [
    { name: 'Eye of Ojer Taq', type_line: 'Artifact', mana_cost: '{3}', oracle_text: EYE_TEXT },
    { name: 'Apex Observatory', type_line: 'Artifact', mana_cost: '', oracle_text: 'Apex Observatory enters tapped.' },
  ],
};

function setup(battlefield: any[], graveyardP1: any[] = [], pool: Record<string, number> = {}) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  const players = ['p1', 'p2'];
  (game as any).gameId = gameId;
  (game.state as any).players = players.map((id) => ({ id, name: id.toUpperCase(), spectator: false, life: 40 }));
  (game.state as any).life = { p1: 40, p2: 40 };
  (game.state as any).turnPlayer = 'p1';
  (game.state as any).priority = 'p1';
  (game.state as any).phase = 'main1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).stack = [];
  (game.state as any).manaPool = {
    p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0, ...pool },
    p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).zones = Object.fromEntries(players.map((id) => [id, {
    hand: [], handCount: 0,
    graveyard: id === 'p1' ? graveyardP1 : [], graveyardCount: id === 'p1' ? graveyardP1.length : 0,
    library: [], libraryCount: 0, exile: [], exileCount: 0,
  }]));
  (game as any).libraries = new Map(players.map((id) => [id, []]));
  (game.state as any).battlefield = battlefield;
  const emitted: Emitted = [];
  const io = createMockIo(emitted);
  const sockets: Record<string, Record<string, Function>> = {};
  for (const id of players) {
    const { socket, handlers } = createMockSocket(id, emitted);
    io.sockets.sockets.set(id, socket);
    registerGameActions(io, socket);
    registerInteractionHandlers(io, socket);
    registerResolutionHandlers(io, socket);
    sockets[id] = handlers;
  }
  return { game, emitted, sockets };
}

const pendingSteps = (type?: string) => ResolutionQueueManager.getQueue(gameId).steps
  .filter((s: any) => s.status === 'pending' && (!type || s.type === type)) as any[];
const errors = (emitted: Emitted) => emitted.filter((e) => e.event === 'error').map((e) => e.payload);
const bf = (game: any) => (game.state as any).battlefield as any[];
const exileIds = (game: any) => ((game.state as any).zones.p1.exile as any[]).map((c) => c.id);
const pool = (game: any) => (game.state as any).manaPool.p1;

describe('Craft: generic activation (round 8 item 1)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createMockIo([]) as any);
    initializeAIResolutionHandler(createMockIo([]) as any);
  });
  afterEach(async () => { await resetGame(); });

  it('parses only the craft line (cost is not doubled by the reminder text) and every material shape', () => {
    expect(parseCraftAbilityText(DIRE_FLAIL_TEXT)).toMatchObject({ materialsText: 'artifact', manaCost: '{3}{R}{R}', spec: { kind: 'count', min: 1, max: 1 } });
    expect(parseCraftAbilityText(THRONE_TEXT)?.spec).toEqual({ kind: 'slots', slots: ['dinosaur', 'merfolk', 'pirate', 'vampire'] });
    expect(parseCraftAbilityText('craft with a dinosaur a merfolk a pirate and a vampire {4}')?.spec).toEqual({ kind: 'slots', slots: ['dinosaur', 'merfolk', 'pirate', 'vampire'] });
    expect(parseCraftAbilityText(EYE_TEXT)).toMatchObject({ manaCost: '{6}', spec: { kind: 'shareType', count: 2 } });
    expect(parseCraftAbilityText('Craft with one or more {5}')?.spec).toMatchObject({ kind: 'count', min: 1, noun: '' });
    expect(parseCraftAbilityText('Craft with one or more Dinosaurs {4}{R}')?.spec).toMatchObject({ kind: 'count', min: 1, noun: 'dinosaurs' });
    expect(parseCraftAbilityText('Craft with two creatures {5}{B}')?.spec).toEqual({ kind: 'count', min: 2, max: 2, noun: 'creatures' });
    expect(parseCraftAbilityText('Craft with Cave {5}{G}')?.spec).toEqual({ kind: 'count', min: 1, max: 1, noun: 'cave' });
  });

  it('Dire Flail: materials offered from battlefield and graveyard, nothing paid until confirmed, then exile + return transformed', async () => {
    await resetGame();
    const { game, emitted, sockets } = setup([
      perm('flail', 'p1', DIRE_FLAIL),
      perm('mox', 'p1', { name: 'Ornithopter', type_line: 'Artifact Creature — Thopter', power: '0', toughness: '2' }),
      perm('bear', 'p1', creature('Grizzly Bears', 'Bear')),
      perm('their_art', 'p2', { name: 'Sol Ring', type_line: 'Artifact' }),
    ], [gyCard('gy_art', 'Ichor Wellspring', 'Artifact'), gyCard('gy_bolt', 'Lightning Bolt', 'Instant')], { red: 2, colorless: 3 });

    await sockets.p1.activateBattlefieldAbility({ gameId, permanentId: 'flail', abilityId: 'flail_card-ability-0' });
    expect(errors(emitted)).toEqual([]);
    const step = pendingSteps(ResolutionStepType.TARGET_SELECTION)[0];
    expect(step?.craftMaterialSelection).toBe(true);
    expect(step.validTargets.map((t: any) => t.id).sort()).toEqual(['gy_art', 'mox']);
    expect(step.minTargets).toBe(1);
    expect(step.maxTargets).toBe(1);
    expect(step.description).toContain('{3}{R}{R}');
    expect(pool(game)).toMatchObject({ red: 2, colorless: 3 });
    expect(bf(game).some((p) => p.id === 'flail')).toBe(true);

    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(step.id), selections: ['gy_art'] });
    expect(errors(emitted)).toEqual([]);
    expect(pool(game)).toMatchObject({ red: 0, colorless: 0 });
    expect(bf(game).some((p) => p.id === 'flail')).toBe(false);
    expect(exileIds(game)).toEqual(expect.arrayContaining(['gy_art', 'flail_card']));
    expect((game.state as any).zones.p1.graveyard.map((c: any) => c.id)).toEqual(['gy_bolt']);
    const item = (game.state as any).stack.find((s: any) => s.abilityType === 'craft');
    expect(item?.controller).toBe('p1');

    (game as any).resolveTopOfStack();
    const crafted = bf(game).find((p) => p.card?.id === 'flail_card');
    expect(crafted?.transformed).toBe(true);
    expect(String(crafted.card.name)).toContain('Dire Blunderbuss');
    expect(crafted.craftedFromCards.map((c: any) => c.id)).toEqual(['gy_art']);
    expect((game.state as any).zones.p1.exile.find((c: any) => c.id === 'gy_art')?.usedToCraftId).toBe(crafted.id);
    expect(exileIds(game)).not.toContain('flail_card');
  });

  it('craft is sorcery-speed and needs its mana before any prompt', async () => {
    await resetGame();
    const { game, emitted, sockets } = setup([perm('flail', 'p1', DIRE_FLAIL), perm('mox', 'p1', { name: 'Ornithopter', type_line: 'Artifact Creature — Thopter' })], [], { red: 2, colorless: 3 });
    (game.state as any).stack = [{ id: 'other', type: 'spell', controller: 'p2', card: { name: 'Shock' } }];
    await sockets.p1.activateBattlefieldAbility({ gameId, permanentId: 'flail', abilityId: 'flail_card-ability-0' });
    expect(errors(emitted).map((e) => e.code)).toContain('SORCERY_SPEED_ONLY');
    expect(pendingSteps()).toEqual([]);

    (game.state as any).stack = [];
    (game.state as any).manaPool.p1 = { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 3 };
    await sockets.p1.activateBattlefieldAbility({ gameId, permanentId: 'flail', abilityId: 'flail_card-ability-0' });
    expect(errors(emitted).map((e) => e.code)).toContain('INSUFFICIENT_MANA');
    expect(pendingSteps()).toEqual([]);
    expect(bf(game).some((p) => p.id === 'mox')).toBe(true);
  });

  it('Throne of the Grim Captain: one material per listed type (changeling fills a slot); a wrong set is refused and re-asked', async () => {
    await resetGame();
    const { game, emitted, sockets } = setup([
      perm('throne', 'p1', THRONE),
      perm('dino', 'p1', creature('Raptor', 'Dinosaur')),
      perm('dino2', 'p1', creature('Other Raptor', 'Dinosaur')),
      perm('pirate', 'p1', creature('Buccaneer', 'Human Pirate')),
      perm('shape', 'p1', creature('Shapeshifter', 'Shapeshifter', 'Changeling (This card is every creature type.)')),
      perm('wall', 'p1', creature('Wall of Wood', 'Wall')),
    ], [gyCard('gy_merfolk', 'Merrow', 'Creature — Merfolk'), gyCard('gy_rock', 'Rock', 'Artifact')], { colorless: 4 });

    await sockets.p1.activateBattlefieldAbility({ gameId, permanentId: 'throne', abilityId: 'throne_card-ability-1' });
    expect(errors(emitted)).toEqual([]);
    const step = pendingSteps(ResolutionStepType.TARGET_SELECTION)[0];
    expect(step?.craftMaterialSelection).toBe(true);
    expect(step.validTargets.map((t: any) => t.id).sort()).toEqual(['dino', 'dino2', 'gy_merfolk', 'pirate', 'shape']);
    expect(step.minTargets).toBe(4);
    expect(step.maxTargets).toBe(4);

    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(step.id), selections: ['dino', 'dino2', 'pirate', 'gy_merfolk'] });
    expect(errors(emitted).map((e) => e.code)).toContain('INVALID_SELECTION');
    expect(pool(game).colorless).toBe(4);
    expect(bf(game).some((p) => p.id === 'dino2')).toBe(true);
    const retry = pendingSteps(ResolutionStepType.TARGET_SELECTION)[0];
    expect(retry?.craftMaterialSelection).toBe(true);

    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(retry.id), selections: ['dino', 'pirate', 'gy_merfolk', 'shape'] });
    expect(pool(game).colorless).toBe(0);
    expect(bf(game).map((p) => p.id).sort()).toEqual(['dino2', 'wall']);
    (game as any).resolveTopOfStack();
    const captain = bf(game).find((p) => p.card?.id === 'throne_card');
    expect(captain?.transformed).toBe(true);
    expect(captain.craftedFromCards.map((c: any) => c.id).sort()).toEqual(['dino_card', 'gy_merfolk', 'pirate_card', 'shape_card']);
  });

  it('Throne without all four material types is refused before any prompt (nothing paid)', async () => {
    await resetGame();
    const { game, emitted, sockets } = setup([
      perm('throne', 'p1', THRONE),
      perm('dino', 'p1', creature('Raptor', 'Dinosaur')),
      perm('pirate', 'p1', creature('Buccaneer', 'Human Pirate')),
    ], [gyCard('gy_merfolk', 'Merrow', 'Creature — Merfolk')], { colorless: 4 });
    await sockets.p1.activateBattlefieldAbility({ gameId, permanentId: 'throne', abilityId: 'throne_card-ability-1' });
    expect(errors(emitted).map((e) => e.code)).toContain('INSUFFICIENT_TARGETS');
    expect(pendingSteps()).toEqual([]);
    expect(pool(game).colorless).toBe(4);
  });

  it('Eye of Ojer Taq: two that share a card type; tokens can be materials but are not remembered as cards; replay rebuilds the cost', async () => {
    await resetGame();
    const { game, emitted, sockets } = setup([
      perm('eye', 'p1', EYE),
      perm('token', 'p1', { name: 'Soldier', type_line: 'Token Creature — Soldier' }, { isToken: true }),
      perm('rock', 'p1', { name: 'Mind Stone', type_line: 'Artifact' }),
    ], [gyCard('gy_bear', 'Grizzly Bears', 'Creature — Bear')], { colorless: 6 });

    await sockets.p1.activateBattlefieldAbility({ gameId, permanentId: 'eye', abilityId: 'eye_card-ability-1' });
    const step = pendingSteps(ResolutionStepType.TARGET_SELECTION)[0];
    expect(step?.craftMaterialSelection).toBe(true);
    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(step.id), selections: ['rock', 'gy_bear'] });
    expect(errors(emitted).map((e) => e.code)).toContain('INVALID_SELECTION');
    const retry = pendingSteps(ResolutionStepType.TARGET_SELECTION)[0];
    await sockets.p1.submitResolutionResponse({ gameId, stepId: String(retry.id), selections: ['token', 'gy_bear'] });
    expect(pool(game).colorless).toBe(0);
    const item = (game.state as any).stack.find((s: any) => s.abilityType === 'craft');
    expect(item.craftParams.exiledMaterialCardIds).toEqual(['gy_bear']);
    expect(bf(game).some((p) => p.id === 'token')).toBe(false);
    (game as any).resolveTopOfStack();
    const observatory = bf(game).find((p) => p.card?.id === 'eye_card');
    expect(observatory?.transformed).toBe(true);
    expect(observatory.craftedFromCards.map((c: any) => c.id)).toEqual(['gy_bear']);

    // Replay of the persisted activation on a fresh board.
    await resetGame();
    const fresh = setup([
      perm('eye', 'p1', EYE),
      perm('token', 'p1', { name: 'Soldier', type_line: 'Token Creature — Soldier' }, { isToken: true }),
    ], [gyCard('gy_bear', 'Grizzly Bears', 'Creature — Bear')], { colorless: 6 });
    applyEvent(fresh.game as any, { type: 'activateCraft', playerId: 'p1', permanentId: 'eye', materialIds: ['token', 'gy_bear'], stackItemId: 'craft_replay', paymentManaDelta: { colorless: -6 } } as any);
    expect(pool(fresh.game).colorless).toBe(0);
    expect(exileIds(fresh.game)).toEqual(expect.arrayContaining(['gy_bear', 'eye_card']));
    expect((fresh.game.state as any).stack.map((s: any) => s.id)).toEqual(['craft_replay']);
  });
});
