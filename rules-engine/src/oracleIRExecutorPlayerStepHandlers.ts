import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import { createCustomEmblem } from './emblemSupport';
import type { OracleIRExecutionContext, OracleIRExecutionOptions } from './oracleIRExecutionTypes';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers';
import {
  addBattlefieldPermanentsToState,
  createBattlefieldPermanentsFromCards,
  cardMatchesMoveZoneSingleTargetCriteria,
  parseSimpleCardTypeFromText,
  type MoveZoneSingleTargetCriteria,
} from './oracleIRExecutorZoneOps';
import { payManaCost } from './spellCasting';
import { createEmptyManaPool, type ManaCost } from './types/mana';
import { parseManaSymbols } from './types/numbers';
import {
  addManaToPoolForPlayer,
  applyExilePermissionMarkers,
  applyGraveyardPermissionMarkers,
  adjustLife,
  adjustPlayerCounter,
  discardCardsForPlayer,
  deriveWinningVoteChoice,
  drawCardsForPlayer,
  getCardManaValue,
  getCardTypeLineLower,
  millCardsForPlayer,
  lookSelectTopCardsForPlayer,
  quantityToNumber,
  resolvePlayers,
  getPlayableUntilTurnForImpulseDuration,
  resolveUnknownMillUntilAmountForPlayer,
  isCardExiledWithSource,
  normalizeOracleText,
  stampCardsPutIntoGraveyardThisTurn,
} from './oracleIRExecutorPlayerUtils';
import { resolveSingleCreatureTargetId } from './oracleIRExecutorCreatureStepUtils';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
  readonly lastClashWon?: boolean;
  readonly lastCollectedEvidence?: boolean;
  readonly lastVisitedAttractions?: readonly any[];
  readonly lastScryLookedAtCount?: number;
  readonly lastDiscardedCardCount?: number;
  readonly lastDiscardedCards?: readonly any[];
  readonly lastMovedCards?: readonly any[];
  readonly lastRevealedCardCount?: number;
  readonly lastGrantedGraveyardCards?: readonly any[];
  readonly lastDungeonRoomEffectText?: string;
  readonly lastDungeonRoomName?: string;
  readonly lastDungeonName?: string;
  readonly lastSetInMotionScheme?: any;
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason: 'unknown_amount' | 'unsupported_player_selector' | 'player_choice_required' | 'failed_to_apply';
  readonly options?: {
    readonly classification?: 'ambiguous' | 'player_choice' | 'invalid_input';
    readonly metadata?: Record<string, string | number | boolean | readonly string[]>;
    readonly persist?: boolean;
  };
};

type UnlessPaysLifeResult =
  | { readonly applied: true; readonly shouldApplyNestedSteps: boolean; readonly state?: GameState; readonly log: readonly string[] }
  | StepSkipResult;

export type PlayerStepHandlerResult = StepApplyResult | StepSkipResult;

function shuffleArray<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let idx = shuffled.length - 1; idx > 0; idx -= 1) {
    const swapIdx = Math.floor(Math.random() * (idx + 1));
    [shuffled[idx], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[idx]];
  }
  return shuffled;
}

function chooseCollectEvidenceCardIds(
  graveyard: readonly any[],
  requiredManaValue: number,
  chosenObjectIds?: readonly string[]
): string[] {
  const normalizedRequiredManaValue = Math.max(0, Number(requiredManaValue) || 0);
  if (normalizedRequiredManaValue <= 0) return [];

  const cards = (Array.isArray(graveyard) ? graveyard : [])
    .map((card: any, index: number) => ({
      id: String(card?.id || '').trim(),
      manaValue: Math.max(0, Number(getCardManaValue(card) ?? 0)),
      index,
    }))
    .filter(card => Boolean(card.id));

  const chosenIdSet = new Set(
    (Array.isArray(chosenObjectIds) ? chosenObjectIds : [])
      .map(id => String(id || '').trim())
      .filter(Boolean)
  );
  if (chosenIdSet.size > 0) {
    return cards.filter(card => chosenIdSet.has(card.id)).map(card => card.id);
  }

  let best: { ids: string[]; total: number; count: number; indices: number[] } | null = null;
  if (cards.length <= 12) {
    const visit = (index: number, ids: string[], total: number, indices: number[]): void => {
      if (total >= normalizedRequiredManaValue) {
        const candidate = { ids: [...ids], total, count: ids.length, indices: [...indices] };
        if (
          !best ||
          candidate.count < best.count ||
          (candidate.count === best.count && candidate.total < best.total) ||
          (
            candidate.count === best.count &&
            candidate.total === best.total &&
            candidate.indices.join(',') < best.indices.join(',')
          )
        ) {
          best = candidate;
        }
        return;
      }
      if (index >= cards.length) return;
      if (best && ids.length >= best.count) return;

      visit(index + 1, [...ids, cards[index].id], total + cards[index].manaValue, [...indices, cards[index].index]);
      visit(index + 1, ids, total, indices);
    };
    visit(0, [], 0, []);
  }

  if (best) {
    return best.ids;
  }

  let total = 0;
  const greedy = [...cards]
    .sort((a, b) => (b.manaValue - a.manaValue) || (a.index - b.index))
    .filter(card => {
      if (total >= normalizedRequiredManaValue) return false;
      total += card.manaValue;
      return true;
    })
    .map(card => card.id);

  return total >= normalizedRequiredManaValue ? greedy : [];
}

function getNormalizedChosenIds(ctx: OracleIRExecutionContext): readonly string[] {
  return (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [])
    .map(id => String(id || '').trim())
    .filter(Boolean);
}

function getNormalizedChosenDungeonId(ctx: OracleIRExecutionContext): string | undefined {
  const chosenDungeonId = String(ctx.selectorContext?.chosenDungeonId || '').trim().toLowerCase();
  return chosenDungeonId || undefined;
}

function getNormalizedChosenDungeonRoomId(ctx: OracleIRExecutionContext): string | undefined {
  const chosenDungeonRoomId = String(ctx.selectorContext?.chosenDungeonRoomId || '').trim().toLowerCase();
  return chosenDungeonRoomId || undefined;
}

function isLessonCard(card: any): boolean {
  return /\blesson\b/i.test(String(card?.type_line || ''));
}

type DungeonRoomDefinition = {
  readonly id: string;
  readonly name: string;
  readonly effectText: string;
  readonly nextRoomIds: readonly string[];
};

type DungeonDefinition = {
  readonly id: string;
  readonly name: string;
  readonly rooms: readonly DungeonRoomDefinition[];
};

const DUNGEON_DEFINITIONS: readonly DungeonDefinition[] = [
  {
    id: 'lost_mine',
    name: 'Lost Mine of Phandelver',
    rooms: [
      { id: 'cave_entrance', name: 'Cave Entrance', effectText: 'Scry 1.', nextRoomIds: ['goblin_lair', 'mine_tunnels'] },
      {
        id: 'goblin_lair',
        name: 'Goblin Lair',
        effectText: 'Create a 1/1 red Goblin creature token.',
        nextRoomIds: ['storeroom', 'dark_pool'],
      },
      {
        id: 'mine_tunnels',
        name: 'Mine Tunnels',
        effectText: 'Create a Treasure token.',
        nextRoomIds: ['dark_pool', 'fungi_cavern'],
      },
      {
        id: 'storeroom',
        name: 'Storeroom',
        effectText: 'Put a +1/+1 counter on target creature you control.',
        nextRoomIds: ['temple_of_dumathoin'],
      },
      {
        id: 'dark_pool',
        name: 'Dark Pool',
        effectText: 'Each opponent loses 1 life and you gain 1 life.',
        nextRoomIds: ['temple_of_dumathoin'],
      },
      {
        id: 'fungi_cavern',
        name: 'Fungi Cavern',
        effectText: "Target creature gets -4/-0 until your next turn.",
        nextRoomIds: ['temple_of_dumathoin'],
      },
      {
        id: 'temple_of_dumathoin',
        name: 'Temple of Dumathoin',
        effectText: 'Draw a card.',
        nextRoomIds: [],
      },
    ],
  },
  {
    id: 'tomb',
    name: 'Tomb of Annihilation',
    rooms: [
      {
        id: 'trapped_entry',
        name: 'Trapped Entry',
        effectText: 'Each player loses 1 life.',
        nextRoomIds: ['veils_of_fear', 'oubliette'],
      },
      {
        id: 'veils_of_fear',
        name: 'Veils of Fear',
        effectText: 'Each player loses 2 life unless they discard a card.',
        nextRoomIds: ['sandfall_cell'],
      },
      {
        id: 'oubliette',
        name: 'Oubliette',
        effectText: 'Discard a card and sacrifice a creature, an artifact, and a land.',
        nextRoomIds: ['cradle_of_the_death_god'],
      },
      {
        id: 'sandfall_cell',
        name: 'Sandfall Cell',
        effectText: 'Each player loses 2 life unless they sacrifice a creature, artifact, or land of their choice.',
        nextRoomIds: ['cradle_of_the_death_god'],
      },
      {
        id: 'cradle_of_the_death_god',
        name: 'Cradle of the Death God',
        effectText: 'Create The Atropal, a legendary 4/4 black God Horror creature token with deathtouch.',
        nextRoomIds: [],
      },
    ],
  },
  {
    id: 'mad_mage',
    name: 'Dungeon of the Mad Mage',
    rooms: [
      { id: 'yawning_portal', name: 'Yawning Portal', effectText: 'You gain 1 life.', nextRoomIds: ['dungeon_level'] },
      {
        id: 'dungeon_level',
        name: 'Dungeon Level',
        effectText: 'Scry 1.',
        nextRoomIds: ['goblin_bazaar', 'twisted_caverns'],
      },
      {
        id: 'goblin_bazaar',
        name: 'Goblin Bazaar',
        effectText: 'Create a Treasure token.',
        nextRoomIds: ['lost_level'],
      },
      {
        id: 'twisted_caverns',
        name: 'Twisted Caverns',
        effectText: "Target creature can't attack until your next turn.",
        nextRoomIds: ['lost_level'],
      },
      { id: 'lost_level', name: 'Lost Level', effectText: 'Scry 2.', nextRoomIds: ['runestone_caverns', 'muirals_graveyard'] },
      {
        id: 'runestone_caverns',
        name: 'Runestone Caverns',
        effectText: 'Exile the top two cards of your library. You may play them.',
        nextRoomIds: ['deep_mines'],
      },
      {
        id: 'muirals_graveyard',
        name: "Muiral's Graveyard",
        effectText: 'Create two 1/1 black Skeleton creature tokens.',
        nextRoomIds: ['deep_mines'],
      },
      { id: 'deep_mines', name: 'Deep Mines', effectText: 'Scry 3.', nextRoomIds: ['mad_wizards_lair'] },
      {
        id: 'mad_wizards_lair',
        name: "Mad Wizard's Lair",
        effectText: 'Draw three cards and reveal them. You may cast one of them without paying its mana cost.',
        nextRoomIds: [],
      },
    ],
  },
];

function getDungeonDefinition(dungeonId: string): DungeonDefinition | undefined {
  const normalizedDungeonId = String(dungeonId || '').trim().toLowerCase();
  return DUNGEON_DEFINITIONS.find(dungeon => dungeon.id === normalizedDungeonId);
}

function getDungeonRoomDefinition(
  dungeonId: string,
  roomId: string | undefined
): DungeonRoomDefinition | undefined {
  const dungeon = getDungeonDefinition(dungeonId);
  const normalizedRoomId = String(roomId || '').trim().toLowerCase();
  if (!dungeon || !normalizedRoomId) return undefined;
  return dungeon.rooms.find(room => room.id === normalizedRoomId);
}

function getDefaultDungeonPath(dungeon: DungeonDefinition): readonly string[] {
  const path: string[] = [];
  let currentRoom = dungeon.rooms[0];
  const visited = new Set<string>();
  while (currentRoom && !visited.has(currentRoom.id)) {
    path.push(currentRoom.id);
    visited.add(currentRoom.id);
    currentRoom = currentRoom.nextRoomIds.length > 0
      ? dungeon.rooms.find(room => room.id === currentRoom.nextRoomIds[0])
      : undefined;
  }
  return path;
}

function getDungeonRoomDefinitionByProgress(dungeonId: string, progress: any): DungeonRoomDefinition | undefined {
  const dungeon = getDungeonDefinition(dungeonId);
  if (!dungeon) return undefined;

  const explicitRoom = getDungeonRoomDefinition(dungeonId, String(progress?.roomId || '').trim());
  if (explicitRoom) return explicitRoom;

  const roomIndex = Math.max(0, Number(progress?.roomIndex) || 0);
  const defaultPath = getDefaultDungeonPath(dungeon);
  const fallbackRoomId = defaultPath[Math.min(roomIndex, Math.max(0, defaultPath.length - 1))];
  return dungeon.rooms.find(room => room.id === fallbackRoomId) || dungeon.rooms[0];
}

function applySelectedLearnDiscard(
  state: GameState,
  playerId: string,
  cardId: string
): PlayerStepHandlerResult {
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped learn (player not found): ${playerId}`,
      reason: 'failed_to_apply',
    };
  }

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const discardIndex = hand.findIndex((card: any) => String(card?.id || '').trim() === cardId);
  if (discardIndex < 0) {
    return {
      applied: false,
      message: `Skipped learn (selected discard card not in hand): ${cardId}`,
      reason: 'failed_to_apply',
    };
  }

  const [discardedCard] = hand.splice(discardIndex, 1);
  const stampedDiscardedCards = stampCardsPutIntoGraveyardThisTurn(state, [discardedCard]);
  const graveyard = [...(Array.isArray(player.graveyard) ? player.graveyard : []), ...stampedDiscardedCards];
  const updatedPlayers = (state.players || []).map((entry: any) => (
    String(entry?.id || '').trim() === playerId
      ? { ...entry, hand, graveyard }
      : entry
  ));

  const discardState = {
    ...(state as any),
    players: updatedPlayers as any,
  } as GameState;
  const drawResult = drawCardsForPlayer(discardState, playerId as PlayerID, 1);

  return {
    applied: true,
    state: drawResult.state,
    log: [`${playerId} learns by discarding 1 card`, ...drawResult.log],
    lastDiscardedCardCount: 1,
    lastDiscardedCards: stampedDiscardedCards,
    lastMovedCards: stampedDiscardedCards,
  };
}

function applySelectedLearnLesson(
  state: GameState,
  playerId: string,
  lessonCardId: string
): PlayerStepHandlerResult {
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped learn (player not found): ${playerId}`,
      reason: 'failed_to_apply',
    };
  }

  const sideboard = Array.isArray(player.sideboard) ? [...player.sideboard] : [];
  const lessonIndex = sideboard.findIndex((card: any) => String(card?.id || '').trim() === lessonCardId);
  if (lessonIndex < 0) {
    return {
      applied: false,
      message: `Skipped learn (selected Lesson not outside the game): ${lessonCardId}`,
      reason: 'failed_to_apply',
    };
  }

  const [lessonCard] = sideboard.splice(lessonIndex, 1);
  const hand = [...(Array.isArray(player.hand) ? player.hand : []), lessonCard];
  const updatedPlayers = (state.players || []).map((entry: any) => (
    String(entry?.id || '').trim() === playerId
      ? { ...entry, hand, sideboard }
      : entry
  ));

  return {
    applied: true,
    state: {
      ...(state as any),
      players: updatedPlayers as any,
    } as GameState,
    log: [`${playerId} learns by revealing a Lesson from outside the game`],
    lastMovedCards: [lessonCard],
  };
}

export function applyLearnStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'learn' }>,
  ctx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions = {}
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped learn (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped learn (player not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const hand = Array.isArray(player.hand) ? player.hand : [];
  const lessons = (Array.isArray(player.sideboard) ? player.sideboard : []).filter(isLessonCard);
  const chosenIds = new Set(getNormalizedChosenIds(ctx));
  const chosenHand = hand.filter((card: any) => chosenIds.has(String(card?.id || '').trim()));
  const chosenLessons = lessons.filter((card: any) => chosenIds.has(String(card?.id || '').trim()));

  if (chosenHand.length > 1 || chosenLessons.length > 1 || (chosenHand.length > 0 && chosenLessons.length > 0)) {
    return {
      applied: false,
      message: `Skipped learn (requires a single discard card or Lesson choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (chosenHand.length === 1) {
    return applySelectedLearnDiscard(state, playerId, String(chosenHand[0]?.id || '').trim());
  }

  if (chosenLessons.length === 1) {
    return applySelectedLearnLesson(state, playerId, String(chosenLessons[0]?.id || '').trim());
  }

  if (!options.allowOptional) {
    return {
      applied: true,
      state,
      log: ['Learn had no auto-selected optional branch'],
      lastMovedCards: [],
    };
  }

  if (hand.length === 1) {
    return applySelectedLearnDiscard(state, playerId, String(hand[0]?.id || '').trim());
  }

  if (lessons.length === 1) {
    return applySelectedLearnLesson(state, playerId, String(lessons[0]?.id || '').trim());
  }

  if (hand.length === 0 && lessons.length === 0) {
    return {
      applied: true,
      state,
      log: ['Learn had no discard or Lesson option available'],
      lastMovedCards: [],
    };
  }

  return {
    applied: false,
    message: `Skipped learn (requires player choice): ${step.raw}`,
    reason: 'player_choice_required',
    options: {
      classification: 'player_choice',
      metadata: {
        handCount: hand.length,
        lessonCount: lessons.length,
      },
    },
  };
}

export function applyOpenAttractionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'open_attraction' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped open Attraction (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped open Attraction (player not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const attractionDeck = Array.isArray(player.attractionDeck) ? [...player.attractionDeck] : [];
  if (attractionDeck.length === 0) {
    return {
      applied: true,
      state,
      log: ['Open an Attraction had no Attraction available'],
      lastMovedCards: [],
    };
  }

  const [openedAttraction, ...remainingAttractionDeck] = attractionDeck;
  const updatedPlayers = (state.players || []).map((entry: any) => (
    String(entry?.id || '').trim() === playerId
      ? { ...entry, attractionDeck: remainingAttractionDeck }
      : entry
  ));
  const attractionCard = {
    ...(openedAttraction || {}),
    type_line: String((openedAttraction as any)?.type_line || 'Artifact - Attraction'),
    zone: 'battlefield',
  };
  const newPermanent = createBattlefieldPermanentsFromCards(
    [attractionCard],
    playerId as PlayerID,
    playerId as PlayerID,
    false,
    false,
    undefined,
    'attraction'
  );

  return {
    applied: true,
    state: addBattlefieldPermanentsToState(
      { ...(state as any), players: updatedPlayers as any } as GameState,
      newPermanent
    ),
    log: [`${playerId} opens an Attraction`],
    lastMovedCards: [attractionCard],
  };
}

export function applyRollVisitAttractionsStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'roll_visit_attractions' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped roll to visit Attractions (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const dieRoll = Math.min(6, Math.max(1, Number(ctx.dieRollResult) || 1));
  const visitedAttractions = ((state.battlefield || []) as any[]).filter((perm: any) => {
    if (String(perm?.controller || '').trim() !== playerId) return false;
    const typeLine = String(perm?.card?.type_line || perm?.cardType || '').toLowerCase();
    if (!typeLine.includes('attraction')) return false;
    const litUpNumbers = Array.isArray(perm?.card?.litUpNumbers) ? perm.card.litUpNumbers : [];
    return litUpNumbers.includes(dieRoll);
  });

  return {
    applied: true,
    state,
    log: [
      `${playerId} rolls ${dieRoll} to visit Attractions`,
      ...(visitedAttractions.length > 0
        ? [`Visited ${visitedAttractions.length} Attraction(s)`]
        : ['No Attractions were visited'])
    ],
    lastVisitedAttractions: visitedAttractions,
    lastMovedCards: visitedAttractions.map((perm: any) => perm?.card).filter(Boolean),
  };
}

export function applyTakeInitiativeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'take_initiative' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped take initiative (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  return {
    applied: true,
    state: {
      ...(state as any),
      initiative: playerId,
    } as GameState,
    log: [`${playerId} takes the initiative`],
  };
}

export function applyBecomeMonarchStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'become_monarch' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped become monarch (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  return {
    applied: true,
    state: {
      ...(state as any),
      monarch: playerId,
    } as GameState,
      log: [`${playerId} becomes the monarch`],
    };
  }

export function applyPlaneswalkStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'planeswalk' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped planeswalk (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if ((state as any)?.houseRules?.enablePlanechase !== true) {
    return {
      applied: false,
      message: `Skipped planeswalk (Planechase is not enabled): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const playerId = players[0];
  const stateAny = state as any;
  const faceDownDeck = Array.isArray(stateAny.planarDeckFaceDown) ? [...stateAny.planarDeckFaceDown] : [];
  const previousPlane = stateAny.currentPlane ?? null;
  if (previousPlane) {
    faceDownDeck.push(previousPlane);
  }

  if (faceDownDeck.length <= 0) {
    return {
      applied: false,
      message: `Skipped planeswalk (no planar deck card available): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const [nextPlane, ...remainingDeck] = faceDownDeck;
  const nextPlaneName = String((nextPlane as any)?.name || nextPlane || '').trim();
  const normalizedNextPlaneName = normalizeOracleText(nextPlaneName);
  const previousPlaneName = String((previousPlane as any)?.name || previousPlane || '').trim();
  const planeswalkedToThisTurn = {
    ...((stateAny.planeswalkedToThisTurn || {}) as Record<string, string[]>),
  };
  const existingEntries = Array.isArray(planeswalkedToThisTurn[playerId]) ? [...planeswalkedToThisTurn[playerId]] : [];
  if (normalizedNextPlaneName) {
    existingEntries.push(normalizedNextPlaneName);
  }
  planeswalkedToThisTurn[playerId] = existingEntries;

  return {
    applied: true,
    state: {
      ...stateAny,
      currentPlane: nextPlane,
      planarDeckFaceDown: remainingDeck,
      planeswalkedThisTurn: true,
      planeswalksAttempted: Math.max(0, Number(stateAny.planeswalksAttempted) || 0) + 1,
      planeswalkedToThisTurn,
      planeswalkedToPlanesThisTurn: planeswalkedToThisTurn,
    } as GameState,
    log: [
      previousPlaneName
        ? `${playerId} planeswalked away from ${previousPlaneName} to ${nextPlaneName || 'a plane'}`
        : `${playerId} planeswalked to ${nextPlaneName || 'a plane'}`,
    ],
  };
}

export function applyAssembleStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'assemble' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped assemble (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped assemble (player not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const contraptionDeck = Array.isArray(player.contraptionDeck) ? [...player.contraptionDeck] : [];
  if (contraptionDeck.length === 0) {
    return {
      applied: true,
      state,
      log: ['Assemble had no Contraption available'],
      lastMovedCards: [],
    };
  }

  const [assembledContraption, ...remainingContraptionDeck] = contraptionDeck;
  const updatedPlayers = (state.players || []).map((entry: any) => (
    String(entry?.id || '').trim() === playerId
      ? { ...entry, contraptionDeck: remainingContraptionDeck }
      : entry
  ));
  const contraptionCard = {
    ...(assembledContraption || {}),
    type_line: String((assembledContraption as any)?.type_line || 'Artifact - Contraption'),
    zone: 'battlefield',
  };
  const newPermanent = createBattlefieldPermanentsFromCards(
    [contraptionCard],
    playerId as PlayerID,
    playerId as PlayerID,
    false,
    false,
    undefined,
    'contraption'
  );

  return {
    applied: true,
    state: addBattlefieldPermanentsToState(
      { ...(state as any), players: updatedPlayers as any } as GameState,
      newPermanent
    ),
    log: [`${playerId} assembles a Contraption`],
    lastMovedCards: [contraptionCard],
  };
}

export function applyVentureIntoDungeonStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'venture_into_dungeon' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped venture into the dungeon (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const stateAny = state as any;
  const currentProgress = { ...((stateAny.dungeonProgress || {}) as Record<string, any>) };
  const completedThisTurn = { ...((stateAny.dungeonCompletedThisTurn || {}) as Record<string, boolean>) };
  const completedAny = { ...((stateAny.dungeonCompleted || {}) as Record<string, boolean>) };
  const completedCounts = { ...((stateAny.completedDungeons || {}) as Record<string, number>) };
  completedThisTurn[playerId] = false;

  const existing = currentProgress[playerId];
  if (!existing) {
    const chosenDungeonId = getNormalizedChosenDungeonId(ctx);
    const dungeon = getDungeonDefinition(chosenDungeonId || 'lost_mine') || getDungeonDefinition('lost_mine');
    if (!dungeon || dungeon.rooms.length === 0) {
      return {
        applied: false,
        message: `Skipped venture into the dungeon (no dungeon definition found): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }

    const roomIndex = 0;
    const room = dungeon.rooms[0];
    currentProgress[playerId] = {
      dungeonId: dungeon.id,
      dungeonName: dungeon.name,
      roomIndex,
      roomId: room.id,
    };
    return {
      applied: true,
      state: {
        ...stateAny,
        dungeonProgress: currentProgress,
        dungeonCompletedThisTurn: completedThisTurn,
      } as GameState,
      log: [`${playerId} enters ${dungeon.name} (${room.name})`],
      lastDungeonName: dungeon.name,
      lastDungeonRoomName: room.name,
      lastDungeonRoomEffectText: room.effectText,
    };
  }

  const existingDungeon = getDungeonDefinition(String(existing.dungeonId || ''));
  const currentRoom = getDungeonRoomDefinitionByProgress(String(existing.dungeonId || ''), existing);
  if (!existingDungeon || !currentRoom) {
    return {
      applied: false,
      message: `Skipped venture into the dungeon (existing dungeon progress is invalid): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const chosenDungeonRoomId = getNormalizedChosenDungeonRoomId(ctx);
  const nextRoomId = (
    chosenDungeonRoomId && currentRoom.nextRoomIds.includes(chosenDungeonRoomId)
      ? chosenDungeonRoomId
      : currentRoom.nextRoomIds[0]
  );
  const nextRoom = getDungeonRoomDefinition(existingDungeon.id, nextRoomId);
  if (!nextRoom) {
    return {
      applied: false,
      message: `Skipped venture into the dungeon (next room could not be resolved): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const nextRoomIndex = Math.max(0, Number(existing.roomIndex) || 0) + 1;

  if (nextRoom.nextRoomIds.length === 0) {
    delete currentProgress[playerId];
    completedThisTurn[playerId] = true;
    completedAny[playerId] = true;
    completedCounts[playerId] = Math.max(0, Number(completedCounts[playerId]) || 0) + 1;

    return {
      applied: true,
      state: {
        ...stateAny,
        dungeonProgress: currentProgress,
        dungeonCompletedThisTurn: completedThisTurn,
        dungeonCompleted: completedAny,
        completedDungeons: completedCounts,
      } as GameState,
      log: [`${playerId} completed ${String(existing.dungeonName || 'a dungeon')} (${nextRoom.name})`],
      lastDungeonName: String(existing.dungeonName || 'a dungeon'),
      lastDungeonRoomName: nextRoom.name,
      lastDungeonRoomEffectText: nextRoom.effectText,
    };
  }

  currentProgress[playerId] = {
    ...existing,
    roomIndex: nextRoomIndex,
    roomId: nextRoom.id,
  };
  return {
    applied: true,
    state: {
      ...stateAny,
      dungeonProgress: currentProgress,
      dungeonCompletedThisTurn: completedThisTurn,
    } as GameState,
    log: [`${playerId} ventures further into ${String(existing.dungeonName || 'a dungeon')} (${nextRoom.name})`],
    lastDungeonName: String(existing.dungeonName || 'a dungeon'),
    lastDungeonRoomName: nextRoom.name,
    lastDungeonRoomEffectText: nextRoom.effectText,
  };
}

function getSchemeIdentityCandidates(value: any): string[] {
  const candidates = [
    String(value?.id || '').trim(),
    String(value?.name || '').trim(),
    String(value?.card?.id || '').trim(),
    String(value?.card?.name || '').trim(),
  ].filter(Boolean);
  return Array.from(new Set(candidates));
}

function schemeMatchesSource(scheme: any, sourceId: string, sourceName: string, chosenIds: readonly string[]): boolean {
  const candidates = getSchemeIdentityCandidates(scheme);
  if (candidates.length === 0) return false;
  if (sourceId && candidates.includes(sourceId)) return true;
  if (sourceName && candidates.includes(sourceName)) return true;
  return chosenIds.some(id => candidates.includes(id));
}

export function applyAbandonSchemeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'abandon_scheme' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const targetText = normalizeOracleText(String((step.target as any)?.text || ''));
  if (targetText !== 'this scheme' && targetText !== 'that scheme') {
    return {
      applied: false,
      message: `Skipped abandon scheme (unsupported target): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const stateAny = state as any;
  const ongoingSchemes = Array.isArray(stateAny.ongoingSchemes) ? [...stateAny.ongoingSchemes] : [];
  if (ongoingSchemes.length === 0) {
    return {
      applied: false,
      message: `Skipped abandon scheme (no ongoing schemes): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const sourceId = String(ctx.sourceId || '').trim();
  const sourceName = String(ctx.sourceName || '').trim();
  const chosenIds = getNormalizedChosenIds(ctx);
  const schemeIndex = ongoingSchemes.findIndex((scheme: any) => schemeMatchesSource(scheme, sourceId, sourceName, chosenIds));
  if (schemeIndex < 0) {
    return {
      applied: false,
      message: `Skipped abandon scheme (source scheme not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const [scheme] = ongoingSchemes.splice(schemeIndex, 1);
  const nextSchemeDeck = [...(Array.isArray(stateAny.schemeDeck) ? stateAny.schemeDeck : []), scheme];

  return {
    applied: true,
    state: {
      ...stateAny,
      ongoingSchemes,
      schemeDeck: nextSchemeDeck,
    } as GameState,
    log: [`${String(sourceName || getSchemeIdentityCandidates(scheme)[1] || getSchemeIdentityCandidates(scheme)[0] || 'Scheme')} was abandoned`],
  };
}

export function applySetInMotionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'set_in_motion' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const targetText = normalizeOracleText(String((step.target as any)?.text || ''));
  const sourceId = String(ctx.sourceId || '').trim();
  const sourceName = String(ctx.sourceName || '').trim();
  const chosenIds = getNormalizedChosenIds(ctx);

  let scheme: any = null;
  if (targetText === 'that scheme') {
    scheme = (ctx as any).lastSetInMotionScheme || null;
  } else if (targetText === 'this scheme') {
    const ongoingSchemes = Array.isArray((state as any).ongoingSchemes) ? (state as any).ongoingSchemes : [];
    scheme = ongoingSchemes.find((entry: any) => schemeMatchesSource(entry, sourceId, sourceName, chosenIds)) || null;
  }

  if (!scheme) {
    return {
      applied: false,
      message: `Skipped set in motion (scheme reference not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  return {
    applied: true,
    state,
    log: [`${String(getSchemeIdentityCandidates(scheme)[1] || getSchemeIdentityCandidates(scheme)[0] || 'Scheme')} was set in motion again`],
    lastSetInMotionScheme: scheme,
  };
}

export function applyCollectEvidenceStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'collect_evidence' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amountValue = step.amount.kind === 'number' ? step.amount.value : null;
  if (amountValue === null || amountValue <= 0) {
    return {
      applied: false,
      message: `Skipped collect evidence (unsupported amount): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped collect evidence (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playerId = players[0];
  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped collect evidence (player not found): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const selectedIds = chooseCollectEvidenceCardIds(graveyard, amountValue, ctx.selectorContext?.chosenObjectIds);
  const selectedIdSet = new Set(selectedIds);
  const selectedCards = graveyard.filter((card: any) => selectedIdSet.has(String(card?.id || '').trim()));
  const totalManaValue = selectedCards.reduce(
    (sum: number, card: any) => sum + Math.max(0, Number(getCardManaValue(card) ?? 0)),
    0
  );

  if (selectedCards.length === 0 || totalManaValue < amountValue) {
    return {
      applied: true,
      state,
      log: [`Collect evidence ${amountValue} could not be completed`],
      lastCollectedEvidence: false,
      lastMovedCards: [],
    };
  }

  const nextPlayers = (state.players || []).map((entry: any) => {
    if (String(entry?.id || '').trim() !== playerId) return entry;

    const remainingGraveyard = graveyard.filter((card: any) => !selectedIdSet.has(String(card?.id || '').trim()));
    const nextExile = [...(Array.isArray(entry?.exile) ? entry.exile : []), ...selectedCards];
    return {
      ...entry,
      graveyard: remainingGraveyard,
      exile: nextExile,
    };
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      players: nextPlayers as any,
    } as GameState,
    log: [`Collected evidence ${amountValue} by exiling ${selectedCards.length} card(s)`],
    lastCollectedEvidence: true,
    lastMovedCards: selectedCards,
  };
}

function findCardByIdAcrossState(state: GameState, sourceId: string): any | null {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return null;

  for (const permanent of Array.isArray(state.battlefield) ? state.battlefield : []) {
    if (String((permanent as any)?.id || '').trim() === normalizedSourceId) {
      return (permanent as any)?.card || permanent;
    }
    if (String((permanent as any)?.card?.id || '').trim() === normalizedSourceId) {
      return (permanent as any)?.card || permanent;
    }
  }

  for (const player of state.players as any[]) {
    for (const zoneName of ['hand', 'graveyard', 'library', 'exile']) {
      const zone = Array.isArray(player?.[zoneName]) ? player[zoneName] : [];
      const found = zone.find((card: any) => String(card?.id || card?.cardId || '').trim() === normalizedSourceId);
      if (found) return found;
    }
  }

  return null;
}

function getSearchLibraryMatches(
  library: readonly any[],
  step: Extract<OracleEffectStep, { kind: 'search_library' }>,
  state: GameState,
  ctx: OracleIRExecutionContext
): any[] | null {
  const cards = Array.isArray(library) ? [...library] : [];

  if (step.criteria.kind === 'same_mana_value_as_source') {
    const criteria = step.criteria;
    const sourceCard = findCardByIdAcrossState(state, String(ctx.sourceId || '').trim());
    const sourceManaValue = getCardManaValue(sourceCard);
    if (sourceManaValue === null) return null;
    return cards.filter(card => {
      if (getCardManaValue(card) !== sourceManaValue) return false;
      if (criteria.requiredCardType === 'creature') {
        return /\bcreature\b/i.test(String(card?.type_line || ''));
      }
      return true;
    });
  }

  const criteria = step.criteria;
  if (criteria.kind === 'mana_value') {
    return cards.filter(card => getCardManaValue(card) === criteria.value);
  }

  const normalizedText = normalizeOracleText(criteria.text);
  if (!normalizedText) return null;
  return cards.filter(card => {
    const typeLine = normalizeOracleText(String(card?.type_line || ''));
    const name = normalizeOracleText(String(card?.name || ''));
    return typeLine.includes(normalizedText) || name === normalizedText;
  });
}

function getChosenObjectIds(ctx: OracleIRExecutionContext): readonly string[] {
  const chosen = Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : [];
  const direct = [ctx.targetCreatureId, ctx.targetPermanentId];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [...chosen, ...direct]) {
    const normalized = String(candidate || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
  }
  return ids;
}

function normalizePermissionSelectorText(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.]+$/g, '')
    .trim();
}

function buildGraveyardPermissionCriteria(text: string): MoveZoneSingleTargetCriteria | null {
  const normalized = normalizePermissionSelectorText(text)
    .replace(/^(?:up to one|one|a|an)\s+/i, '')
    .replace(/\s+from\s+(?:your|their|his or her|its owner's|its controller's)\s+graveyard$/i, '')
    .replace(/\s+(?:spells?|cards?)$/i, '')
    .replace(/\binstant and sorcery\b/g, 'instant or sorcery')
    .trim();
  if (!normalized) return null;

  const manaValueMatch = normalized.match(/^(.+?)\s+with mana value (\d+) or less$/i);
  if (manaValueMatch) {
    const rawBase = String(manaValueMatch[1] || '').trim().replace(/\s+spell$/i, '');
    const creatureTypeWithMvMatch = rawBase.match(/^([a-z][a-z' -]+)\s+creature$/i);
    const manaValueLte = parseInt(String(manaValueMatch[2] || '0'), 10) || 0;
    if (creatureTypeWithMvMatch && manaValueLte > 0) {
      return {
        cardType: 'creature',
        manaValueLte,
        creatureTypesAnyOf: [
          String(creatureTypeWithMvMatch[1] || '')
            .trim()
            .replace(/\b\w/g, c => c.toUpperCase()),
        ],
      };
    }

    const cardType = parseSimpleCardTypeFromText(rawBase);
    if (!cardType || manaValueLte <= 0) return null;
    return { cardType, manaValueLte };
  }

  const creatureTypeMatch = normalized.match(/^([a-z][a-z' -]+)\s+creature$/i);
  if (creatureTypeMatch) {
    return {
      cardType: 'creature',
      creatureTypesAnyOf: [
        String(creatureTypeMatch[1] || '')
          .trim()
          .replace(/\b\w/g, c => c.toUpperCase()),
      ],
    };
  }

  const baseType = parseSimpleCardTypeFromText(normalized);
  if (baseType) return { cardType: baseType };

  if (normalized === 'land' || normalized === 'lands') return { cardType: 'land' };
  if (normalized === 'card' || normalized === 'cards') return { cardType: 'any' };
  if (normalized === 'permanent spell' || normalized === 'permanent') return { cardType: 'permanent' };

  return null;
}

function buildExilePermissionCriteria(text: string): {
  readonly criteria: MoveZoneSingleTargetCriteria | null;
  readonly ownOnly: boolean;
} {
  const normalized = normalizePermissionSelectorText(text)
    .replace(/\s+from\s+among\s+(?:the\s+)?cards?\s+/i, ' ')
    .replace(/\s+exiled with this (?:creature|artifact|enchantment|planeswalker|permanent|card|class|saga)$/i, '')
    .trim();

  const ownOnly = /\byou own\b/i.test(normalized);
  const selectorText = normalized
    .replace(/\byou own\b/i, '')
    .replace(/^(?:up to one|one|a|an)\s+/i, '')
    .replace(/\s+(?:spells?|cards?)$/i, '')
    .trim();

  if (!selectorText) return { criteria: { cardType: 'any' }, ownOnly };

  const direct = buildGraveyardPermissionCriteria(selectorText);
  if (direct) return { criteria: direct, ownOnly };

  const creatureTypeOnly = selectorText.match(/^([a-z][a-z' -]+)$/i);
  if (creatureTypeOnly) {
    return {
      criteria: {
        cardType: 'creature',
        creatureTypesAnyOf: [
          String(creatureTypeOnly[1] || '')
            .trim()
            .replace(/\b\w/g, c => c.toUpperCase()),
        ],
      },
      ownOnly,
    };
  }

  return { criteria: null, ownOnly };
}

function resolveGraveyardPermissionTargets(
  state: GameState,
  playerId: PlayerID,
  step: Extract<OracleEffectStep, { kind: 'grant_graveyard_permission' }>,
  ctx: OracleIRExecutionContext
): { cards: readonly any[]; reason?: 'unsupported_selector' | 'failed_to_apply' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { cards: [], reason: 'failed_to_apply' };

  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const chosenIds = new Set(getChosenObjectIds(ctx));
  const sourceId = String(ctx.sourceId || '').trim();
  const selectorText =
    step.what.kind === 'raw'
      ? normalizePermissionSelectorText(step.what.text)
      : normalizePermissionSelectorText((step.what as any).raw || '');
  if (!selectorText) return { cards: [], reason: 'unsupported_selector' };

  const contextualReference =
    /^(?:it|that card|that spell|the discarded card|target .+?)$/.test(selectorText);
  if (contextualReference) {
    const cards = graveyard.filter((card: any) => {
      const cardId = String(card?.id || card?.cardId || '').trim();
      if (!cardId) return false;
      if (chosenIds.has(cardId)) return true;
      return selectorText === 'it' && sourceId && cardId === sourceId;
    });
    return cards.length > 0 ? { cards } : { cards: [], reason: 'failed_to_apply' };
  }

  const selfReference = /^(?:this card|this spell|this permanent|this creature)$/.test(selectorText);
  if (selfReference) {
    if (!sourceId) return { cards: [], reason: 'failed_to_apply' };
    const cards = graveyard.filter((card: any) => String(card?.id || card?.cardId || '').trim() === sourceId);
    return cards.length > 0 ? { cards } : { cards: [], reason: 'failed_to_apply' };
  }

  const criteria = buildGraveyardPermissionCriteria(selectorText);
  if (!criteria) return { cards: [], reason: 'unsupported_selector' };
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  return { cards: graveyard.filter((card: any) => cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn)) };
}

function resolveExilePermissionTargets(
  state: GameState,
  playerId: PlayerID,
  step: Extract<OracleEffectStep, { kind: 'grant_exile_permission' }>,
  ctx: OracleIRExecutionContext
): { cards: readonly any[]; reason?: 'unsupported_selector' | 'failed_to_apply' } {
  const sourceId = String(ctx.sourceId || '').trim();
  const selectorText =
    step.what.kind === 'raw'
      ? normalizePermissionSelectorText(step.what.text)
      : normalizePermissionSelectorText((step.what as any).raw || '');
  if (!selectorText) return { cards: [], reason: 'unsupported_selector' };

  const chosenIds = new Set(getChosenObjectIds(ctx));
  const contextualReference =
    /^(?:it|that card|that spell|the exiled card|the exiled spell|target .+?)$/.test(selectorText);
  if (contextualReference || /^(?:this card|this spell|this permanent|this creature)$/.test(selectorText)) {
    const targetId = contextualReference
      ? Array.from(chosenIds)[0] || sourceId
      : sourceId;
    if (!targetId) return { cards: [], reason: 'failed_to_apply' };

    const matches: any[] = [];
    for (const owner of state.players as any[]) {
      const exile = Array.isArray(owner?.exile) ? owner.exile : [];
      for (const card of exile) {
        const cardId = String(card?.id || card?.cardId || '').trim();
        if (!cardId || cardId !== targetId) continue;
        matches.push(card);
      }
    }

    return matches.length > 0 ? { cards: matches } : { cards: [], reason: 'failed_to_apply' };
  }

  if (!sourceId && step.linkedToSource) return { cards: [], reason: 'failed_to_apply' };

  const { criteria, ownOnly } = buildExilePermissionCriteria(selectorText);
  if (!criteria) return { cards: [], reason: 'unsupported_selector' };

  const matches: any[] = [];
  const currentTurn = Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
  for (const owner of state.players as any[]) {
    const exile = Array.isArray(owner?.exile) ? owner.exile : [];
    for (const card of exile) {
      if (step.linkedToSource && !isCardExiledWithSource(card, sourceId)) continue;
      if (ownOnly && String(owner?.id || '').trim() !== playerId) continue;
      if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn)) continue;
      matches.push(card);
    }
  }

  return { cards: matches };
}

function parseSupportedManaCostString(rawMana: string): ManaCost | null {
  const symbols = parseManaSymbols(rawMana);
  if (symbols.length === 0) return null;

  let generic = 0;
  let white = 0;
  let blue = 0;
  let black = 0;
  let red = 0;
  let green = 0;
  let colorless = 0;

  for (const symbol of symbols) {
    const upper = String(symbol || '').trim().toUpperCase();
    if (!upper) return null;
    if (/^\{\d+\}$/.test(upper)) {
      generic += parseInt(upper.slice(1, -1), 10);
      continue;
    }

    switch (upper) {
      case '{W}':
        white += 1;
        break;
      case '{U}':
        blue += 1;
        break;
      case '{B}':
        black += 1;
        break;
      case '{R}':
        red += 1;
        break;
      case '{G}':
        green += 1;
        break;
      case '{C}':
        colorless += 1;
        break;
      default:
        return null;
    }
  }

  return { generic, white, blue, black, red, green, colorless };
}

export function applyCreateEmblemStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'create_emblem' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const player = (state.players || []).find(p => p?.id === controllerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped create emblem (controller unavailable): ${step.raw}`,
      reason: 'failed_to_apply',
    };
  }

  const emblemName = String(step.name || ctx.sourceName || 'Emblem').trim() || 'Emblem';
  const result = createCustomEmblem(
    controllerId,
    emblemName,
    [...step.abilities],
    ctx.sourceName,
    ctx.sourceId
  );
  const currentEmblems = Array.isArray(player.emblems) ? [...player.emblems] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === controllerId ? ({ ...(p as any), emblems: [...currentEmblems, result.emblem] } as any) : p
  );

  return {
    applied: true,
    state: { ...state, players: updatedPlayers as any } as any,
    log: result.log,
  };
}

export function applyGrantGraveyardPermissionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_graveyard_permission' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped graveyard permission (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playableUntilTurn = getPlayableUntilTurnForImpulseDuration(state, step.duration);
  let nextState = state;
  let granted = 0;
  const grantedCards: any[] = [];
  const log: string[] = [];

  for (const playerId of players) {
    const resolved = resolveGraveyardPermissionTargets(nextState, playerId, step, ctx);
    if (resolved.reason === 'unsupported_selector') {
      return {
        applied: false,
        message: `Skipped graveyard permission (unsupported selector): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'ambiguous' },
      };
    }
    if (resolved.reason === 'failed_to_apply') {
      return {
        applied: false,
        message: `Skipped graveyard permission (referenced card unavailable): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const markerResult = applyGraveyardPermissionMarkers(nextState, playerId, resolved.cards, {
      permission: step.permission,
      playableUntilTurn,
    });
    nextState = markerResult.state;
    granted += markerResult.granted;
    grantedCards.push(...resolved.cards);
    if (markerResult.granted > 0) {
      log.push(`${playerId} may ${step.permission === 'play' ? 'play' : 'cast'} ${markerResult.granted} graveyard card(s)`);
    }
  }

  return {
    applied: true,
    state: nextState,
    log: log.length > 0 ? log : [`Granted no graveyard permissions: ${step.raw}`],
    lastGrantedGraveyardCards: grantedCards,
  };
}

export function applyGrantExilePermissionStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_exile_permission' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped exile permission (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const playableUntilTurn = getPlayableUntilTurnForImpulseDuration(state, step.duration);
  let nextState = state;
  const log: string[] = [];

  for (const playerId of players) {
    const resolved = resolveExilePermissionTargets(nextState, playerId, step, ctx);
    if (resolved.reason === 'unsupported_selector') {
      return {
        applied: false,
        message: `Skipped exile permission (unsupported selector): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'ambiguous' },
      };
    }
    if (resolved.reason === 'failed_to_apply') {
      return {
        applied: false,
        message: `Skipped exile permission (linked exiled cards unavailable): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const markerResult = applyExilePermissionMarkers(nextState, playerId, resolved.cards, {
      permission: step.permission,
      playableUntilTurn,
      castedPermanentEntersWithCounters: step.castedPermanentEntersWithCounters,
    });
    nextState = markerResult.state;
    if (markerResult.granted > 0) {
      log.push(`${playerId} may ${step.permission === 'play' ? 'play' : 'cast'} ${markerResult.granted} exiled card(s)`);
    }
  }

  return {
    applied: true,
    state: nextState,
    log: log.length > 0 ? log : [`Granted no exile permissions: ${step.raw}`],
  };
}

export function applyModifyGraveyardPermissionsStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'modify_graveyard_permissions' }>,
  runtime: {
    readonly lastGrantedGraveyardCards?: readonly any[];
  }
): PlayerStepHandlerResult {
  const lastGrantedGraveyardCards = Array.isArray(runtime.lastGrantedGraveyardCards)
    ? runtime.lastGrantedGraveyardCards
    : [];
  const grantedIds = new Set(
    lastGrantedGraveyardCards
      .map(card => String((card as any)?.id ?? (card as any)?.cardId ?? '').trim())
      .filter(Boolean)
  );

  if (step.scope !== 'last_granted_graveyard_cards' || grantedIds.size === 0) {
    return {
      applied: false,
      message: `Skipped graveyard permission modifier (no granted cards in context): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  let changed = 0;
  const updatedPlayers = (state.players || []).map((player: any) => {
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    if (graveyard.length === 0) return player;

    let playerChanged = false;
    const updatedGraveyard = graveyard.map((card: any) => {
      const id = String(card?.id ?? card?.cardId ?? '').trim();
      if (!id || !grantedIds.has(id)) return card;
      playerChanged = true;
      changed += 1;
      return {
        ...card,
        ...(step.castCost ? { graveyardCastCost: step.castCost } : {}),
        ...(step.castCostRaw ? { graveyardCastCostRaw: step.castCostRaw } : {}),
        ...(step.withoutPayingManaCost ? { withoutPayingManaCost: true } : {}),
        ...(step.additionalCost ? { graveyardAdditionalCost: { ...step.additionalCost } } : {}),
        ...((step as any).exileInsteadOfGraveyard ? { exileInsteadOfGraveyard: true } : {}),
        ...((step as any).entersBattlefieldTransformed ? { entersBattlefieldTransformed: true } : {}),
        ...(step.castedPermanentEntersWithCounters
          ? { entersBattlefieldWithCounters: { ...step.castedPermanentEntersWithCounters } }
          : {}),
      };
    });

    return playerChanged ? ({ ...player, graveyard: updatedGraveyard } as any) : player;
  });

  return {
    applied: true,
    state: { ...(state as any), players: updatedPlayers as any } as any,
    log:
      changed > 0
        ? [`Updated graveyard permissions for ${changed} graveyard card(s)`]
        : [`Updated no graveyard permissions: ${step.raw}`],
  };
}

export function applyPayManaStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'pay_mana' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped pay mana (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const manaCost = parseSupportedManaCostString(step.mana);
  if (!manaCost) {
    return {
      applied: false,
      message: `Skipped pay mana (unsupported mana cost): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'ambiguous' },
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const manaPoolRecord: Record<PlayerID, any> = { ...((((nextState as any).manaPool || {}) as any) || {}) };
    const currentPool = manaPoolRecord[playerId] || createEmptyManaPool();
    const payment = payManaCost(currentPool, manaCost);
    if (!payment.success || !payment.remainingPool) {
      return {
        applied: false,
        message: `Skipped pay mana (cannot pay ${step.mana}): ${step.raw}`,
        reason: 'failed_to_apply',
        options: {
          classification: 'invalid_input',
          persist: false,
        },
      };
    }

    manaPoolRecord[playerId] = payment.remainingPool;
    nextState = { ...(nextState as any), manaPool: manaPoolRecord } as any;
    log.push(`${playerId} pays ${step.mana}`);
  }

  return {
    applied: true,
    state: nextState,
    log,
  };
}

function resolveVariableAmount(
  state: GameState,
  controllerId: PlayerID,
  amount: Extract<OracleEffectStep, { kind: 'gain_life' | 'lose_life' }>['amount'],
  ctx: OracleIRExecutionContext,
  runtime: ModifyPtRuntime | undefined,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): number | null {
  const numericAmount = quantityToNumber(amount, ctx);
  if (numericAmount !== null) return numericAmount;
  if (amount.kind !== 'unknown' || !evaluateWhereX) return null;

  const raw = String(amount.raw || '').trim().replace(/^equal to\s+/i, '').trim();
  if (!raw) return null;

  const evaluated = evaluateWhereX(state, controllerId, `X is ${raw}`, undefined, ctx, runtime);
  if (evaluated !== null) return evaluated;

  const sacrificed = Array.isArray(runtime?.lastSacrificedPermanents) ? runtime.lastSacrificedPermanents : [];
  if (sacrificed.length === 1) {
    const snapshot = sacrificed[0] as any;
    const lowerRaw = raw.toLowerCase();
    const readFinite = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    if (/^(?:the sacrificed|that) creature's power$/.test(lowerRaw)) return readFinite(snapshot?.power);
    if (/^(?:the sacrificed|that) creature's toughness$/.test(lowerRaw)) return readFinite(snapshot?.toughness);
    if (/^(?:the sacrificed|that) creature's mana value$/.test(lowerRaw)) return readFinite(snapshot?.manaValue);
  }

  const moved = Array.isArray(runtime?.lastMovedCards) ? runtime.lastMovedCards : [];
  if (moved.length === 1) {
    const lowerRaw = raw.toLowerCase();
    const readFinite = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const manaValue = getCardManaValue(moved[0]);
    if (manaValue !== null && /^(?:its|that card's|that creature's) mana value$/.test(lowerRaw)) {
      return manaValue;
    }
    if (/^(?:its|that card's|that creature's) power$/.test(lowerRaw)) {
      return readFinite((moved[0] as any)?.power ?? (moved[0] as any)?.card?.power);
    }
    if (/^(?:its|that card's|that creature's) toughness$/.test(lowerRaw)) {
      return readFinite((moved[0] as any)?.toughness ?? (moved[0] as any)?.card?.toughness);
    }
  }

  return null;
}

export function applyScryStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'scry' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount, ctx);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped scry (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped scry (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (amount <= 0) {
    return {
      applied: true,
      state,
      log: [`Scry ${amount} (no-op): ${step.raw}`],
      lastScryLookedAtCount: 0,
    };
  }

  const wouldNeedChoice = players.some(playerId => {
    const player = state.players.find(p => p.id === playerId) as any;
    const libraryLength = Array.isArray(player?.library) ? player.library.length : 0;
    return libraryLength > 0;
  });

  if (wouldNeedChoice) {
    return {
      applied: false,
      message: `Skipped scry (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  return {
    applied: true,
    state,
    log: [`Scry ${amount} (no cards in library): ${step.raw}`],
    lastScryLookedAtCount: 0,
  };
}

export function applyFatesealStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'fateseal' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped fateseal (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped fateseal (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped fateseal (requires deterministic controller): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const actingPlayerId = players[0];
  const targets = resolvePlayers(state, step.target, ctx).filter(playerId => playerId !== actingPlayerId);
  if (targets.length === 0) {
    return {
      applied: false,
      message: `Skipped fateseal (unsupported target selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (targets.length !== 1) {
    return {
      applied: false,
      message: `Skipped fateseal (requires deterministic opponent): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const targetPlayerId = targets[0];
  const targetPlayer = state.players.find((player: any) => String(player?.id || '').trim() === String(targetPlayerId || '').trim()) as any;
  if (!targetPlayer) {
    return {
      applied: false,
      message: `Skipped fateseal (target player not found): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const library = Array.isArray(targetPlayer.library) ? targetPlayer.library : [];
  const lookedAtCount = Math.min(Math.max(0, amount), library.length);
  return {
    applied: true,
    state,
    log: [
      lookedAtCount > 0
        ? `${actingPlayerId} fatesealed ${targetPlayerId} for ${lookedAtCount} card(s) and left them in the same order`
        : `${actingPlayerId} fatesealed ${targetPlayerId} for 0 card(s)`,
    ],
  };
}

export function applyVoteStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'vote' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const voters = resolvePlayers(state, step.voters, ctx);
  if (voters.length === 0) {
    return {
      applied: false,
      message: `Skipped vote (unsupported voter selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const winningVoteChoice = deriveWinningVoteChoice(ctx);
  if (typeof winningVoteChoice === 'undefined') {
    return {
      applied: false,
      message: `Skipped vote (requires vote choices): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  if (winningVoteChoice === '') {
    return {
      applied: false,
      message: `Skipped vote (winning choice unavailable): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  if (winningVoteChoice === null) {
    return {
      applied: true,
      state,
      log: [`${voters.length} player(s) voted and the vote tied`],
    };
  }

  const normalizedWinner = String(winningVoteChoice).toLowerCase();
  const normalizedChoices = (step.choices || []).map(choice => String(choice || '').trim().toLowerCase()).filter(Boolean);
  if (!normalizedChoices.includes(normalizedWinner)) {
    return {
      applied: false,
      message: `Skipped vote (winning choice not in parsed choices): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  return {
    applied: true,
    state,
    log: [
      `${voters.length} player(s) voted and ${String(winningVoteChoice)} won`,
    ],
  };
}

export function applyClashStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'clash' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped clash (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped clash (requires deterministic player): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const playerId = players[0];
  const player = state.players.find((p: any) => String(p?.id || '').trim() === String(playerId || '').trim()) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped clash (player not found): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  let opponentId: PlayerID | null = null;
  if (step.opponent) {
    const opponents = resolvePlayers(state, step.opponent, ctx);
    if (opponents.length === 0) {
      const controllerOpponents = (state.players || []).filter((p: any) => String(p?.id || '').trim() !== String(playerId || '').trim());
      return {
        applied: false,
        message: `Skipped clash (requires opponent selection): ${step.raw}`,
        reason: controllerOpponents.length > 1 ? 'player_choice_required' : 'unsupported_player_selector',
        options: { classification: controllerOpponents.length > 1 ? 'player_choice' : 'ambiguous' },
      };
    }
    if (opponents.length !== 1) {
      return {
        applied: false,
        message: `Skipped clash (requires deterministic opponent): ${step.raw}`,
        reason: 'player_choice_required',
        options: { classification: 'player_choice' },
      };
    }
    opponentId = opponents[0];
  }

  const playerTopCard = Array.isArray(player.library) && player.library.length > 0 ? player.library[0] : null;
  const playerManaValue = Math.max(0, Number(getCardManaValue(playerTopCard) ?? 0));
  const log: string[] = [];

  if (playerTopCard) {
    log.push(`${playerId} clashed and revealed ${String(playerTopCard?.name || 'a card')} (MV ${playerManaValue})`);
  } else {
    log.push(`${playerId} clashed but had no card to reveal`);
  }

  let lastClashWon = Boolean(playerTopCard);
  if (opponentId) {
    const opponent = state.players.find((p: any) => String(p?.id || '').trim() === String(opponentId || '').trim()) as any;
    if (!opponent) {
      return {
        applied: false,
        message: `Skipped clash (opponent not found): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const opponentTopCard = Array.isArray(opponent.library) && opponent.library.length > 0 ? opponent.library[0] : null;
    const opponentManaValue = Math.max(0, Number(getCardManaValue(opponentTopCard) ?? 0));
    if (opponentTopCard) {
      log.push(`${opponentId} revealed ${String(opponentTopCard?.name || 'a card')} (MV ${opponentManaValue})`);
    } else {
      log.push(`${opponentId} had no card to reveal`);
    }

    lastClashWon = playerTopCard !== null && playerManaValue > opponentManaValue;
  }

  log.push(lastClashWon ? `${playerId} won the clash` : `${playerId} did not win the clash`);
  return {
    applied: true,
    state,
    log,
    lastClashWon,
  };
}

export function applySearchLibraryStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'search_library' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped library search (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];

  for (const playerId of players) {
    const player = nextState.players.find(p => p.id === playerId) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped library search (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }

    const library = Array.isArray(player.library) ? [...player.library] : [];
    const matches = getSearchLibraryMatches(library, step, nextState, ctx);
    if (matches === null) {
      return {
        applied: false,
        message: `Skipped library search (criteria unresolved): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }

    const maxResults = Math.max(1, Number(step.maxResults || 1) || 1);
    const selected = matches.slice(0, maxResults);
    const selectedIds = new Set(selected.map(card => String(card?.id || card?.cardId || '').trim()).filter(Boolean));
    const remainingLibrary = library.filter(card => !selectedIds.has(String(card?.id || card?.cardId || '').trim()));
    const shuffledLibrary = step.shuffle === false ? remainingLibrary : shuffleArray(remainingLibrary);
    const movedCards = selected.map((card: any) => ({
      ...card,
      zone: step.destination,
    }));
    const enteredBattlefield =
      step.destination === 'battlefield'
        ? createBattlefieldPermanentsFromCards(movedCards, playerId, playerId, false, false, undefined, 'library')
        : [];

    nextState = {
      ...(nextState as any),
      players: nextState.players.map((entry: any) => {
        if (entry.id !== playerId) return entry;
        const hand = Array.isArray(entry.hand) ? [...entry.hand] : [];
        const graveyard = Array.isArray(entry.graveyard) ? [...entry.graveyard] : [];
        const exile = Array.isArray(entry.exile) ? [...entry.exile] : [];

        if (step.destination === 'hand') {
          return { ...entry, library: shuffledLibrary, hand: [...hand, ...movedCards] };
        }
        if (step.destination === 'graveyard') {
          return { ...entry, library: shuffledLibrary, graveyard: [...graveyard, ...movedCards] };
        }
        if (step.destination === 'exile') {
          return { ...entry, library: shuffledLibrary, exile: [...exile, ...movedCards] };
        }
        if (step.destination === 'battlefield') {
          return { ...entry, library: shuffledLibrary };
        }
        if (step.destination === 'top') {
          return { ...entry, library: [...movedCards, ...shuffledLibrary] };
        }
        if (step.destination === 'bottom') {
          return { ...entry, library: [...shuffledLibrary, ...movedCards] };
        }

        return { ...entry, library: shuffledLibrary, hand: [...hand, ...movedCards] };
      }),
      ...(enteredBattlefield.length > 0
        ? { battlefield: [...(nextState.battlefield || []), ...enteredBattlefield] }
        : {}),
    } as GameState;

    if (step.revealFound && selected.length > 0) {
      log.push(`${playerId} revealed ${selected.map(card => String(card?.name || 'card')).join(', ')}`);
    }
    if (selected.length > 0) {
      log.push(`${playerId} searched their library and put ${selected.length} card(s) into ${step.destination}`);
    } else {
      log.push(`${playerId} searched their library and found no card`);
    }
    if (step.shuffle !== false) {
      log.push(`${playerId} shuffled their library`);
    }
  }

  return { applied: true, state: nextState, log };
}

export function applySurveilStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'surveil' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped surveil (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped surveil (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  if (amount <= 0) {
    return {
      applied: true,
      state,
      log: [`Surveil ${amount} (no-op): ${step.raw}`],
    };
  }

  const wouldNeedChoice = players.some(playerId => {
    const player = state.players.find(p => p.id === playerId) as any;
    const libraryLength = Array.isArray(player?.library) ? player.library.length : 0;
    return libraryLength > 0;
  });

  if (wouldNeedChoice) {
    return {
      applied: false,
      message: `Skipped surveil (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  return {
    applied: true,
    state,
    log: [`Surveil ${amount} (no cards in library): ${step.raw}`],
  };
}

export function applyLookSelectTopStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'look_select_top' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  const choose = quantityToNumber(step.choose);
  if (amount === null || choose === null) {
    return {
      applied: false,
      message: `Skipped look-select-top (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped look-select-top (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const result = lookSelectTopCardsForPlayer(
      nextState,
      playerId,
      amount,
      choose,
      step.destination,
      step.restDestination,
      Boolean(step.restToTop)
    );
    nextState = result.state;
    log.push(...result.log);
  }

  return {
    applied: true,
    state: nextState,
    log,
  };
}

export function applyMillStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'mill' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped mill (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const millCountByPlayer = new Map<PlayerID, number>();
  for (const playerId of players) {
    const resolvedCount =
      quantityToNumber(step.amount) ??
      resolveUnknownMillUntilAmountForPlayer(state, playerId, step.amount);
    if (resolvedCount === null) {
      return {
        applied: false,
        message: `Skipped mill (unknown amount): ${step.raw}`,
        reason: 'unknown_amount',
        options: { classification: 'ambiguous' },
      };
    }
    millCountByPlayer.set(playerId, resolvedCount);
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const amount = millCountByPlayer.get(playerId) ?? 0;
    const result = millCardsForPlayer(nextState, playerId, amount);
    nextState = result.state;
    log.push(...result.log);
  }

  const unknownRaw = String((step.amount as any)?.raw || '').toLowerCase();
  const isRevealThisWay = step.amount.kind === 'unknown' && unknownRaw.includes('reveal a land card');
  const lastRevealedCardCount = isRevealThisWay
    ? Array.from(millCountByPlayer.values()).reduce((sum, count) => sum + (Number(count) || 0), 0)
    : undefined;

  return {
    applied: true,
    state: nextState,
    log,
    lastRevealedCardCount,
  };
}

export function applyDiscardStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'discard' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped discard (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped discard (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const wouldNeedChoice = players.some(playerId => {
    const player = state.players.find(p => p.id === playerId) as any;
    const handLength = Array.isArray(player?.hand) ? player.hand.length : 0;
    return handLength > Math.max(0, amount | 0);
  });

  if (wouldNeedChoice) {
    return {
      applied: false,
      message: `Skipped discard (requires player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  let nextState = state;
  const log: string[] = [];
  let totalDiscarded = 0;
  const discardedCards: any[] = [];
  for (const playerId of players) {
    const result = discardCardsForPlayer(nextState, playerId, amount);
    nextState = result.state;
    totalDiscarded += Math.max(0, Number(result.discardedCount) || 0);
    if (Array.isArray(result.discardedCards)) discardedCards.push(...result.discardedCards);
    log.push(...result.log);
  }

  return {
    applied: true,
    state: nextState,
    log,
    lastDiscardedCardCount: totalDiscarded,
    lastDiscardedCards: discardedCards,
    lastMovedCards: discardedCards,
  };
}

export function applyExploreStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'explore' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const targetId = resolveSingleCreatureTargetId(state, step.target, ctx);
  if (!targetId) {
    return {
      applied: false,
      message: `Skipped explore (requires deterministic target): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'ambiguous' },
    };
  }

  const battlefield = [...((state.battlefield || []) as any[])];
  const targetIndex = battlefield.findIndex((perm: any) => String(perm?.id || '').trim() === targetId);
  if (targetIndex < 0) {
    return {
      applied: false,
      message: `Skipped explore (target not on battlefield): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const target = battlefield[targetIndex] as any;
  const controllerId = String(target?.controller || ctx.controllerId || '').trim();
  const player = state.players.find((p: any) => String(p?.id || '').trim() === controllerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped explore (controller not found): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const library = Array.isArray(player.library) ? [...player.library] : [];
  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  if (library.length <= 0) {
    return {
      applied: true,
      state,
      log: [`${targetId} explored, but ${controllerId} had no cards to reveal`],
    };
  }

  const topCard = library[0];
  const typeLine = getCardTypeLineLower(topCard);
  const nextPlayers = state.players.map((p: any) => ({ ...p }));
  const playerIndex = nextPlayers.findIndex((p: any) => String(p?.id || '').trim() === controllerId);
  if (playerIndex < 0) {
    return {
      applied: false,
      message: `Skipped explore (controller not found): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const log: string[] = [`${targetId} explored and revealed ${String(topCard?.name || 'a card')}`];
  if (typeLine.includes('land')) {
    library.shift();
    hand.push(topCard);
    nextPlayers[playerIndex] = {
      ...nextPlayers[playerIndex],
      library,
      hand,
    };
    return {
      applied: true,
      state: { ...(state as any), players: nextPlayers as any } as GameState,
      log: [...log, `${controllerId} put the revealed land into their hand`],
    };
  }

  const counters = { ...((target?.counters || {}) as Record<string, number>) };
  const currentCount = Number(counters['+1/+1'] ?? 0);
  counters['+1/+1'] = (Number.isFinite(currentCount) ? currentCount : 0) + 1;
  battlefield[targetIndex] = {
    ...target,
    counters,
  };

  return {
    applied: true,
    state: { ...(state as any), battlefield } as GameState,
    log: [...log, `Added 1 +1/+1 counter to ${targetId}`],
  };
}

export function applyManifestDreadStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'manifest_dread' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped manifest dread (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  const movedCards: any[] = [];
  const movedPermanentIds: string[] = [];

  for (const playerId of players) {
    const player = nextState.players.find((p: any) => String(p?.id || '').trim() === String(playerId || '').trim()) as any;
    if (!player) {
      return {
        applied: false,
        message: `Skipped manifest dread (player not found): ${step.raw}`,
        reason: 'failed_to_apply',
        options: { classification: 'invalid_input', persist: false },
      };
    }

    const library = Array.isArray(player.library) ? [...player.library] : [];
    if (library.length <= 0) {
      log.push(`${playerId} manifested dread, but had no cards in library`);
      continue;
    }

    const looked = library.slice(0, 2);
    const manifestedCard = looked[0];
    const rest = looked.slice(1);
    const keptLibrary = library.slice(looked.length);
    const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    const newPermanent = createBattlefieldPermanentsFromCards(
      [manifestedCard],
      playerId,
      playerId,
      false,
      true,
      undefined,
      'library'
    );
    const updatedPlayers = nextState.players.map((p: any) =>
      String(p?.id || '').trim() === String(playerId || '').trim()
        ? ({
            ...p,
            library: keptLibrary,
            graveyard: [...graveyard, ...stampCardsPutIntoGraveyardThisTurn(nextState, rest)],
          } as any)
        : p
    );
    nextState = addBattlefieldPermanentsToState(
      { ...(nextState as any), players: updatedPlayers as any } as GameState,
      newPermanent as any
    );
    movedCards.push(manifestedCard, ...rest);
    movedPermanentIds.push(...newPermanent.map((perm: any) => String(perm?.id || '').trim()).filter(Boolean));
    log.push(
      `${playerId} manifested ${String(manifestedCard?.name || 'a card')} from among the top ${looked.length} card(s) of their library`
    );
    if (rest.length > 0) {
      log.push(`${playerId} put ${rest.length} remaining looked card(s) into their graveyard`);
    }
  }

  return {
    applied: true,
    state: nextState,
    log,
    lastMovedCards: movedCards,
  };
}

export function applyConniveStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'connive' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  if (amount === null || amount <= 0) {
    return {
      applied: false,
      message: `Skipped connive (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const targetId = resolveSingleCreatureTargetId(state, step.target, ctx);
  if (!targetId) {
    return {
      applied: false,
      message: `Skipped connive (requires deterministic target): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'ambiguous' },
    };
  }

  const battlefield = [...((state.battlefield || []) as any[])];
  const targetIndex = battlefield.findIndex((perm: any) => String(perm?.id || '').trim() === targetId);
  if (targetIndex < 0) {
    return {
      applied: false,
      message: `Skipped connive (target not on battlefield): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const target = battlefield[targetIndex] as any;
  const controllerId = String(target?.controller || ctx.controllerId || '').trim();
  const player = state.players.find((p: any) => String(p?.id || '').trim() === controllerId) as any;
  if (!player) {
    return {
      applied: false,
      message: `Skipped connive (controller not found): ${step.raw}`,
      reason: 'failed_to_apply',
      options: { classification: 'invalid_input', persist: false },
    };
  }

  const handLength = Array.isArray(player.hand) ? player.hand.length : 0;
  const libraryLength = Array.isArray(player.library) ? player.library.length : 0;
  const drawnCount = Math.min(amount, Math.max(0, libraryLength));
  if (handLength + drawnCount > amount) {
    return {
      applied: false,
      message: `Skipped connive (requires discard choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const drawResult = drawCardsForPlayer(state, controllerId as PlayerID, amount);
  const discardResult = discardCardsForPlayer(drawResult.state, controllerId as PlayerID, amount);
  const discardedNonlands = discardResult.discardedCards.filter((card: any) => !getCardTypeLineLower(card).includes('land')).length;
  const log = [...drawResult.log, ...discardResult.log];

  if (discardedNonlands > 0) {
    const counters = { ...((target?.counters || {}) as Record<string, number>) };
    const currentCount = Number(counters['+1/+1'] ?? 0);
    counters['+1/+1'] = (Number.isFinite(currentCount) ? currentCount : 0) + discardedNonlands;
    battlefield[targetIndex] = {
      ...target,
      counters,
    };
    return {
      applied: true,
      state: { ...(discardResult.state as any), battlefield } as GameState,
      log: [...log, `Added ${discardedNonlands} +1/+1 counter(s) to ${targetId}`],
      lastDiscardedCardCount: discardResult.discardedCount,
      lastDiscardedCards: discardResult.discardedCards,
      lastMovedCards: discardResult.discardedCards,
    };
  }

  return {
    applied: true,
    state: discardResult.state,
    log,
    lastDiscardedCardCount: discardResult.discardedCount,
    lastDiscardedCards: discardResult.discardedCards,
    lastMovedCards: discardResult.discardedCards,
  };
}

export function applyGainLifeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'gain_life' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  runtime?: ModifyPtRuntime,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): PlayerStepHandlerResult {
  const amount = resolveVariableAmount(state, controllerId, step.amount, ctx, runtime, evaluateWhereX);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped life gain (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped life gain (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const result = adjustLife(nextState, playerId, amount);
    nextState = result.state;
    log.push(...result.log);
  }

  return { applied: true, state: nextState, log };
}

export function applyLoseLifeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'lose_life' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  runtime?: ModifyPtRuntime,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): PlayerStepHandlerResult {
  const amount = resolveVariableAmount(state, controllerId, step.amount, ctx, runtime, evaluateWhereX);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped life loss (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped life loss (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const result = adjustLife(nextState, playerId, -amount);
    nextState = result.state;
    log.push(...result.log);
  }

  return { applied: true, state: nextState, log };
}

export function applyAddPlayerCounterStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_player_counter' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  runtime?: ModifyPtRuntime,
  evaluateWhereX?: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null
): PlayerStepHandlerResult {
  const amount = resolveVariableAmount(state, controllerId, step.amount, ctx, runtime, evaluateWhereX);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped player counter addition (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped player counter addition (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const result = adjustPlayerCounter(nextState, playerId, step.counter, amount);
    log.push(...result.log);
    if (!result.applied) {
      return {
        applied: false,
        message: log.join('\n') || `Skipped player counter addition (failed to apply): ${step.raw}`,
        reason: 'failed_to_apply',
      };
    }
    nextState = result.state;
  }

  return { applied: true, state: nextState, log };
}

export function applyDrawStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'draw' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const amount = quantityToNumber(step.amount);
  if (amount === null) {
    return {
      applied: false,
      message: `Skipped draw (unknown amount): ${step.raw}`,
      reason: 'unknown_amount',
      options: { classification: 'ambiguous' },
    };
  }

  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped draw (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  for (const playerId of players) {
    const result = drawCardsForPlayer(nextState, playerId, amount);
    nextState = result.state;
    log.push(...result.log);
  }

  return { applied: true, state: nextState, log };
}

export function applyAddManaStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_mana' }>,
  ctx: OracleIRExecutionContext
): PlayerStepHandlerResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length === 0) {
    return {
      applied: false,
      message: `Skipped add mana (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  let nextState = state;
  const log: string[] = [];
  const manaToAdd = (() => {
    const options = Array.isArray(step.manaOptions)
      ? step.manaOptions.map(option => String(option || '').trim()).filter(Boolean)
      : [];
    if (options.length <= 1) return String(step.mana || '').trim();

    const chosenMana = String(ctx.selectorContext?.chosenMana || '').trim();
    if (!chosenMana) return options[0] || '';
    const match = options.find(option => option.toUpperCase() === chosenMana.toUpperCase());
    return match || options[0] || '';
  })();

  for (const playerId of players) {
    const result = addManaToPoolForPlayer(nextState, playerId, manaToAdd);
    log.push(...result.log);
    if (!result.applied) {
      return {
        applied: false,
        message: log.join('\n') || `Skipped add mana (failed to apply): ${step.raw}`,
        reason: 'failed_to_apply',
        options: {
          metadata: log.length > 0 ? { log } : undefined,
        },
      };
    }
    nextState = result.state;
  }

  return { applied: true, state: nextState, log };
}

export function evaluateUnlessPaysLifeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'unless_pays_life' }>,
  ctx: OracleIRExecutionContext
): UnlessPaysLifeResult {
  const players = resolvePlayers(state, step.who, ctx);
  if (players.length !== 1) {
    return {
      applied: false,
      message: `Skipped unless-pays-life step (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          selectorKind: step.who.kind,
          candidateCount: players.length,
          lifeAmount: step.amount,
        },
      },
    };
  }

  const payerId = players[0];
  const payer = (state.players || []).find(player => String(player?.id || '').trim() === String(payerId || '').trim()) as any;
  if (!payer) {
    return {
      applied: false,
      message: `Skipped unless-pays-life step (unsupported player selector): ${step.raw}`,
      reason: 'unsupported_player_selector',
    };
  }

  const lifeTotal = Number(payer.life);
  const canPayLife = Number.isFinite(lifeTotal) && lifeTotal >= step.amount;
  const explicitChoice =
    ctx.unlessPaysLifeChoice === 'pay' || ctx.unlessPaysLifeChoice === 'decline'
      ? ctx.unlessPaysLifeChoice
      : (ctx.selectorContext?.unlessPaysLifeChoice === 'pay' || ctx.selectorContext?.unlessPaysLifeChoice === 'decline'
          ? ctx.selectorContext.unlessPaysLifeChoice
          : undefined);
  if (canPayLife) {
    if (explicitChoice === 'pay') {
      const payment = adjustLife(state, payerId, -step.amount);
      return {
        applied: true,
        shouldApplyNestedSteps: false,
        state: payment.state,
        log: [
          ...payment.log,
          `Resolved unless-pays-life step (payer chose to pay ${step.amount} life): ${step.raw}`,
        ],
      };
    }

    if (explicitChoice === 'decline') {
      return {
        applied: true,
        shouldApplyNestedSteps: true,
        log: [`Resolved unless-pays-life step (payer declined to pay ${step.amount} life): ${step.raw}`],
      };
    }

    return {
      applied: false,
      message: `Skipped unless-pays-life step (opponent choice required): ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          payerId,
          payerLife: lifeTotal,
          lifeAmount: step.amount,
        },
      },
    };
  }

  return {
    applied: true,
    shouldApplyNestedSteps: true,
    log: [`Resolved unless-pays-life step (payer cannot pay ${step.amount} life): ${step.raw}`],
  };
}
