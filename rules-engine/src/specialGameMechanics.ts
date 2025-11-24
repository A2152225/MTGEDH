/**
 * Special Game Mechanics (Rules 720-732)
 * Implementation of special game mechanics including Omen cards, Station cards,
 * player control, turn ending, monarch, initiative, game restart, rad counters,
 * subgames, merging, day/night, shortcuts, and illegal action handling.
 * 
 * Reference: MagicCompRules 20251114.txt, Rules 720-732
 */

// ============================================================================
// Rule 720: Omen Cards
// ============================================================================

/**
 * Rule 720.1: Omen cards have a two-part card frame with alternative characteristics.
 */
export interface OmenCard {
  readonly normalCharacteristics: CardCharacteristics;
  readonly omenCharacteristics: CardCharacteristics;
  readonly wasCastAsOmen: boolean;
}

export interface CardCharacteristics {
  readonly name: string;
  readonly manaCost: string | null;
  readonly types: readonly string[];
  readonly abilities: readonly string[];
  readonly power?: number | null;
  readonly toughness?: number | null;
}

/**
 * Rule 720.3: Choose whether to cast as Omen or normally.
 */
export function castAsOmen(card: OmenCard): OmenCard {
  return { ...card, wasCastAsOmen: true };
}

export function castOmenNormally(card: OmenCard): OmenCard {
  return { ...card, wasCastAsOmen: false };
}

/**
 * Rule 720.3b/720.4: Get characteristics based on zone and cast mode.
 */
export function getOmenCharacteristics(card: OmenCard, zone: string, isOnStack: boolean): CardCharacteristics {
  if (isOnStack && card.wasCastAsOmen) {
    return card.omenCharacteristics;
  }
  return card.normalCharacteristics;
}

/**
 * Rule 720.3d: Omen spell shuffles into library instead of going to graveyard.
 */
export function resolveOmenSpell(card: OmenCard): { shouldShuffleIntoLibrary: boolean } {
  return { shouldShuffleIntoLibrary: card.wasCastAsOmen };
}

// ============================================================================
// Rule 721: Station Cards
// ============================================================================

/**
 * Rule 721.2: Station symbol represents conditional static ability.
 */
export interface StationAbility {
  readonly counterThreshold: number; // N in {N+}
  readonly abilities: readonly string[];
  readonly power?: number;
  readonly toughness?: number;
}

/**
 * Rule 721.2a: "{N+}[abilities]" means "As long as this permanent has N or more charge counters..."
 */
export function getActiveStationAbilities(chargeCounters: number, stationAbilities: readonly StationAbility[]): readonly StationAbility[] {
  return stationAbilities.filter(ability => chargeCounters >= ability.counterThreshold);
}

export function getStationPowerToughness(chargeCounters: number, stationAbilities: readonly StationAbility[]): { power: number | null; toughness: number | null } {
  const activeAbilities = getActiveStationAbilities(chargeCounters, stationAbilities);
  
  if (activeAbilities.length === 0) {
    return { power: null, toughness: null };
  }
  
  // Use highest threshold's P/T
  const highestThreshold = activeAbilities.reduce((max, ability) => 
    ability.counterThreshold > max.counterThreshold ? ability : max
  );
  
  return {
    power: highestThreshold.power ?? null,
    toughness: highestThreshold.toughness ?? null
  };
}

// ============================================================================
// Rule 722: Controlling Another Player
// ============================================================================

/**
 * Rule 722.1: Effects can give one player control of another player's turn.
 */
export interface PlayerControl {
  readonly controllingPlayer: string;
  readonly controlledPlayer: string;
  readonly duration: 'turn' | 'permanent' | number; // number = specific turns
  readonly turnsRemaining?: number;
}

export function gainControlOfPlayer(controller: string, controlled: string, duration: PlayerControl['duration']): PlayerControl {
  return {
    controllingPlayer: controller,
    controlledPlayer: controlled,
    duration,
    turnsRemaining: typeof duration === 'number' ? duration : undefined
  };
}

/**
 * Rule 722.2: Controlling player makes all choices for controlled player.
 */
export function makeChoiceForControlledPlayer(control: PlayerControl, choice: unknown): unknown {
  return choice; // Controller makes the choice
}

export function endPlayerControl(control: PlayerControl): null {
  return null;
}

// ============================================================================
// Rule 723: Ending Turns and Phases
// ============================================================================

/**
 * Rule 723.1: End the turn.
 */
export interface TurnEndingEffect {
  readonly removeFromStack: boolean; // Rule 723.1a
  readonly exileUntilEndOfTurn: boolean; // Rule 723.1b-c
  readonly skipCleanup: boolean; // Rule 723.1d
}

export function endTheTurn(): TurnEndingEffect {
  return {
    removeFromStack: true,
    exileUntilEndOfTurn: true,
    skipCleanup: true
  };
}

export function endPhase(): { phase: 'ended' } {
  return { phase: 'ended' };
}

export function endStep(): { step: 'ended' } {
  return { step: 'ended' };
}

// ============================================================================
// Rule 724: The Monarch
// ============================================================================

/**
 * Rule 724.1: The monarch is a designation a player can have.
 */
export interface MonarchState {
  readonly currentMonarch: string | null;
}

/**
 * Rule 724.3: Only one player can be monarch at a time.
 */
export function becomeMonarch(state: MonarchState, newMonarch: string): MonarchState {
  return { currentMonarch: newMonarch };
}

/**
 * Rule 724.2: Inherent triggered abilities for monarch.
 */
export function shouldMonarchDraw(state: MonarchState, player: string, phase: string): boolean {
  return state.currentMonarch === player && phase === 'end';
}

export function handleMonarchCombatDamage(state: MonarchState, attacker: string): MonarchState {
  return becomeMonarch(state, attacker);
}

// ============================================================================
// Rule 725: The Initiative
// ============================================================================

/**
 * Rule 725.1: The initiative is a designation a player can have.
 */
export interface InitiativeState {
  readonly currentInitiative: string | null;
}

/**
 * Rule 725.2/725.3: Take the initiative.
 */
export function takeInitiative(state: InitiativeState, player: string): InitiativeState {
  return { currentInitiative: player };
}

/**
 * Rule 725.2: Venture into Undercity when taking initiative.
 */
export function shouldVentureFromInitiative(state: InitiativeState, player: string, phase: string): boolean {
  return state.currentInitiative === player && phase === 'upkeep';
}

export function handleInitiativeCombatDamage(state: InitiativeState, attacker: string): InitiativeState {
  return takeInitiative(state, attacker);
}

// ============================================================================
// Rule 726: Restarting the Game
// ============================================================================

/**
 * Rule 726.1: One card (Karn Liberated) restarts the game.
 */
export interface GameRestart {
  readonly startingPlayer: string;
  readonly exemptedCards: readonly string[];
}

export function restartGame(startingPlayer: string): GameRestart {
  return {
    startingPlayer,
    exemptedCards: []
  };
}

/**
 * Rule 726.5: Effects may exempt certain cards.
 */
export function exemptCardFromRestart(restart: GameRestart, cardId: string): GameRestart {
  return {
    ...restart,
    exemptedCards: [...restart.exemptedCards, cardId]
  };
}

// ============================================================================
// Rule 727: Rad Counters
// ============================================================================

/**
 * Rule 727.1: Rad counters with mill trigger at precombat main.
 */
export interface RadCounterState {
  readonly player: string;
  readonly radCounters: number;
}

export function addRadCounters(state: RadCounterState, amount: number): RadCounterState {
  return { ...state, radCounters: state.radCounters + amount };
}

/**
 * Rule 727.1: Mill equal to rad counters, lose life for nonlands, remove counters.
 */
export function triggerRadMill(state: RadCounterState): {
  readonly millCount: number;
  readonly newState: RadCounterState;
} {
  return {
    millCount: state.radCounters,
    newState: state
  };
}

export function processRadDamage(state: RadCounterState, nonlandsMilled: number): RadCounterState {
  return {
    ...state,
    radCounters: Math.max(0, state.radCounters - nonlandsMilled)
  };
}

// ============================================================================
// Rule 728: Subgames
// ============================================================================

/**
 * Rule 728.1: Subgames are completely separate Magic games.
 */
export interface Subgame {
  readonly subgameId: string;
  readonly mainGameState: unknown;
  readonly players: readonly string[];
}

export function createSubgame(mainGameState: unknown, players: readonly string[]): Subgame {
  return {
    subgameId: `subgame-${Date.now()}`,
    mainGameState,
    players
  };
}

/**
 * Rule 728.5: Return cards to main game at end.
 */
export function endSubgame(subgame: Subgame): { mainGameState: unknown } {
  return { mainGameState: subgame.mainGameState };
}

// ============================================================================
// Rule 729: Merging with Permanents
// ============================================================================

/**
 * Rule 729.1: Objects merge under one permanent.
 */
export interface MergedPermanent {
  readonly topObject: string;
  readonly mergedObjects: readonly string[];
}

/**
 * Rule 729.2/729.3: Merged permanent has abilities from all, characteristics from top.
 */
export function mergePermanents(top: string, others: readonly string[]): MergedPermanent {
  return {
    topObject: top,
    mergedObjects: [top, ...others]
  };
}

export function getMergedCharacteristics(merged: MergedPermanent): {
  readonly characteristicsFrom: string;
  readonly abilitiesFrom: readonly string[];
} {
  return {
    characteristicsFrom: merged.topObject,
    abilitiesFrom: merged.mergedObjects
  };
}

// ============================================================================
// Rule 730: Day and Night
// ============================================================================

/**
 * Rule 730.1: Day and night is a game-wide designation.
 */
export interface DayNightState {
  readonly current: 'day' | 'night' | null;
}

/**
 * Rule 730.2: Turn-based action checks at untap.
 */
export function initializeDayNight(): DayNightState {
  return { current: 'day' };
}

/**
 * Rule 730.3-730.5: Day/night transition logic.
 */
export function shouldBecomeDay(spellsCastByActivePlayer: number, spellsCastByOthers: number): boolean {
  return spellsCastByActivePlayer >= 2;
}

export function shouldBecomeNight(spellsCastByActivePlayer: number): boolean {
  return spellsCastByActivePlayer === 0;
}

export function checkDayNightChange(state: DayNightState, activePlayerSpells: number, otherSpells: number): DayNightState {
  if (state.current === null) return state;
  
  if (state.current === 'day' && shouldBecomeNight(activePlayerSpells)) {
    return { current: 'night' };
  }
  if (state.current === 'night' && shouldBecomeDay(activePlayerSpells, otherSpells)) {
    return { current: 'day' };
  }
  return state;
}

// ============================================================================
// Rule 731: Taking Shortcuts
// ============================================================================

/**
 * Rule 731.1: Players can propose shortcuts for repetitive actions.
 */
export interface Shortcut {
  readonly proposer: string;
  readonly action: string;
  readonly iterations: number;
  readonly accepted: readonly string[];
}

export function proposeShortcut(proposer: string, action: string, iterations: number): Shortcut {
  return {
    proposer,
    action,
    iterations,
    accepted: []
  };
}

/**
 * Rule 731.2: All players must agree or shortcut is not taken.
 */
export function acceptShortcut(shortcut: Shortcut, player: string): Shortcut {
  return {
    ...shortcut,
    accepted: [...shortcut.accepted, player]
  };
}

export function objectToShortcut(shortcut: Shortcut): null {
  return null; // Shortcut rejected
}

// ============================================================================
// Rule 732: Handling Illegal Actions
// ============================================================================

/**
 * Rule 732.1: Rewind to before illegal action.
 */
export interface IllegalAction {
  readonly action: string;
  readonly gameStateBefore: unknown;
}

export function detectIllegalAction(action: string, gameState: unknown): IllegalAction {
  return {
    action,
    gameStateBefore: gameState
  };
}

/**
 * Rule 732.1: Revert to previous game state.
 */
export function rewindIllegalAction(illegal: IllegalAction): { gameState: unknown } {
  return { gameState: illegal.gameStateBefore };
}

/**
 * Rule 732.2: Handle illegal card draws specifically.
 */
export function handleIllegalCardDraw(drawnCards: readonly string[]): {
  readonly action: 'return-random-to-library';
  readonly cards: readonly string[];
} {
  return {
    action: 'return-random-to-library',
    cards: drawnCards
  };
}
