#!/usr/bin/env node
/**
 * run-commander-games.ts
 * 
 * Runs Commander games using deck files from the precon_json folder.
 * Supports 2-8 players with configurable turn limits.
 * Tracks gameplay metrics and generates a summary report.
 * 
 * Uses oracleTextParser and triggeredAbilities for ability parsing and detection.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { ManaPool } from '../../shared/src';
import { parseOracleText, parseTriggeredAbility, type ParsedAbility, AbilityType } from '../src/oracleTextParser';
import { parseTriggeredAbilitiesFromText, TriggerEvent, type TriggeredAbility } from '../src/triggeredAbilities';

// ES module compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Constants
// ============================================================================

/** Spacing between seeds for each game to ensure different shuffles */
const SEED_SPACING = 1000;

/** Path to deck files */
const DECKS_PATH = path.join(__dirname, '../../precon_json');

/** Available deck files (files starting with "Deck") */
const DECK_FILES = [
  'DeckBreedLethalityPrecon.json',
  'DeckChatterfang.json',
  'DeckGodBoros.json',
  'DeckGroupSuffering.json',
  'DeckKingMaker.json',
  'DeckLiveShortandProsper.json',
  'DeckMorpholk.json',
  'DeckOmOmNom.json',
];

// ============================================================================
// Types
// ============================================================================

/** Card data from deck JSON files */
interface CardData {
  name: string;
  mana_cost: string;
  cmc?: number;
  type_line: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  id: string;
}

interface GameEvent {
  turn: number;
  player: string;
  action: string;
  card?: string;
  details?: string;
  reasoning?: string;
  result?: string;
  oracleTextExecuted?: boolean;
  expectedEffect?: string;
  actualEffect?: string;
  // Enhanced tracking for analysis mode
  targetCard?: string;
  targetPlayer?: string;
  fromZone?: string;
  toZone?: string;
  manaSpent?: number;
  lifeChange?: number;
  countersAdded?: Record<string, number>;
  tokenDetails?: string;
  triggerSource?: string;
  stackPosition?: number;
}

interface GameSummary {
  gameNumber: number;
  winner: string;
  winCondition: string;
  totalTurns: number;
  events: GameEvent[];
  cardsPlayed: Map<string, string[]>;
  cardsWithNoImpact: string[];
  unexpectedBehaviors: string[];
  expectedBehaviorsNotOccurred: string[];
  cardsNotFunctioningAsIntended: string[];
  seed: number;
}

interface PlayerState {
  name: string;
  life: number;
  commander: string;
  commanderInCommandZone: boolean;
  commanderTax: number;
  library: string[];
  hand: string[];
  battlefield: PermanentState[];
  graveyard: string[];
  exile: string[];
  manaPool: ManaPool;
  landsPlayedThisTurn: number;
  poisonCounters: number;
  cardsDrawnThisTurn: number;
}

interface PermanentState {
  card: string;
  tapped: boolean;
  summoningSickness: boolean;
  power: number;
  toughness: number;
  loyalty?: number;
  counters: Record<string, number>;
  damage?: number;
  isToken?: boolean;
  parsedAbilities?: ParsedAbility[];
  triggeredAbilities?: TriggeredAbility[];
}

/** Loaded deck with card data */
interface LoadedDeck {
  name: string;
  commander: CardData;
  cards: CardData[];
}

interface SimulatedGameState {
  turn: number;
  activePlayer: number;
  phase: string;
  players: Record<number, PlayerState>;
  playerCount: number;
  stack: any[];
  events: GameEvent[];
  cardsPlayed: Map<string, string[]>;
  winner: number | null;
  winCondition: string | null;
}

// ============================================================================
// Deck Loading Functions
// ============================================================================

/**
 * Load a deck from a JSON file in precon_json folder
 * The deck files are JSON fragments that need to be wrapped with braces
 */
function loadDeck(filename: string): LoadedDeck {
  const filePath = path.join(DECKS_PATH, filename);
  const rawContent = fs.readFileSync(filePath, 'utf-8').trim();
  
  // Deck files are JSON fragments starting with "cards": [...]
  // We need to wrap them in braces to make valid JSON
  // Validate the format before wrapping
  if (!rawContent.startsWith('"cards"')) {
    throw new Error(`Invalid deck file format: ${filename} - expected to start with "cards"`);
  }
  
  const jsonContent = '{' + rawContent + '}';
  let data: { cards: CardData[] };
  
  try {
    data = JSON.parse(jsonContent) as { cards: CardData[] };
  } catch (parseError) {
    throw new Error(`Failed to parse deck file ${filename}: ${parseError}`);
  }
  
  if (!data.cards || !Array.isArray(data.cards) || data.cards.length === 0) {
    throw new Error(`Deck file ${filename} has no cards`);
  }
  
  // First card is the commander (legendary creature)
  const commander = data.cards[0];
  const deckName = filename.replace('.json', '').replace('Deck', '');
  
  return {
    name: deckName,
    commander,
    cards: data.cards,
  };
}

/**
 * Get list of available deck files
 */
function getAvailableDeckFiles(): string[] {
  try {
    const files = fs.readdirSync(DECKS_PATH);
    return files.filter(f => f.startsWith('Deck') && f.endsWith('.json'));
  } catch (err) {
    console.error(`Warning: Could not read deck files from ${DECKS_PATH}: ${err}`);
    return DECK_FILES;
  }
}

/**
 * Randomly select n deck files from available decks
 */
function selectRandomDecks(count: number, rng: () => number): string[] {
  const available = getAvailableDeckFiles();
  const shuffled = [...available];
  
  // Fisher-Yates shuffle
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * Calculate CMC from mana cost string
 */
function calculateCMC(manaCost: string): number {
  if (!manaCost) return 0;
  
  let cmc = 0;
  // Match generic mana {X} where X is a number
  const genericMatch = manaCost.match(/\{(\d+)\}/g);
  if (genericMatch) {
    for (const match of genericMatch) {
      const num = parseInt(match.replace(/[{}]/g, ''), 10);
      cmc += num;
    }
  }
  
  // Count colored mana symbols (each adds 1)
  const coloredSymbols = manaCost.match(/\{[WUBRGC]\}/gi);
  if (coloredSymbols) {
    cmc += coloredSymbols.length;
  }
  
  // Handle hybrid mana (e.g., {W/U}) - each adds 1
  const hybridSymbols = manaCost.match(/\{[WUBRG]\/[WUBRG]\}/gi);
  if (hybridSymbols) {
    cmc += hybridSymbols.length;
  }
  
  return cmc;
}

// ============================================================================
// Game Simulation Engine
// ============================================================================

class CommanderGameSimulator {
  private rng: () => number;
  private currentSeed: number;
  private analysisMode: boolean;
  private playerCount: number;
  private maxTurns: number;
  private loadedDecks: LoadedDeck[] = [];
  private cardDatabase: Map<string, CardData> = new Map();
  
  constructor(
    seed?: number, 
    analysisMode: boolean = false,
    playerCount: number = 2,
    maxTurns: number = 25
  ) {
    this.currentSeed = seed ?? Math.floor(Math.random() * 10000);
    this.analysisMode = analysisMode;
    this.playerCount = Math.max(2, Math.min(8, playerCount));
    this.maxTurns = Math.max(1, maxTurns);
    this.initRng(this.currentSeed);
  }

  private initRng(seed: number): void {
    this.currentSeed = seed;
    let s = seed;
    this.rng = () => {
      s = Math.sin(s) * 10000;
      return s - Math.floor(s);
    };
  }

  private log(message: string): void {
    if (this.analysisMode) {
      console.log(`  [ANALYSIS] ${message}`);
    }
  }

  /**
   * Load decks for the game and build card database
   */
  loadDecks(): void {
    const deckFiles = selectRandomDecks(this.playerCount, this.rng);
    
    console.log(`Loading ${deckFiles.length} decks...`);
    
    this.loadedDecks = [];
    this.cardDatabase.clear();
    
    for (const file of deckFiles) {
      try {
        const deck = loadDeck(file);
        this.loadedDecks.push(deck);
        
        // Add all cards to database
        for (const card of deck.cards) {
          this.cardDatabase.set(card.name, card);
        }
        
        console.log(`  Loaded: ${deck.name} (Commander: ${deck.commander.name})`);
      } catch (err) {
        console.error(`  Failed to load ${file}: ${err}`);
      }
    }
    
    // Verify we have enough decks
    if (this.loadedDecks.length < this.playerCount) {
      console.warn(`Warning: Only ${this.loadedDecks.length} decks available, adjusting player count`);
      this.playerCount = this.loadedDecks.length;
    }
  }

  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  getCard(name: string): CardData | undefined {
    return this.cardDatabase.get(name);
  }

  isLand(cardName: string): boolean {
    const card = this.getCard(cardName);
    return card?.type_line?.toLowerCase().includes('land') ?? false;
  }

  isCreature(cardName: string): boolean {
    const card = this.getCard(cardName);
    return card?.type_line?.toLowerCase().includes('creature') ?? false;
  }

  /**
   * Check if a card has a specific creature type
   */
  hasCreatureType(cardName: string, type: string): boolean {
    const card = this.getCard(cardName);
    return card?.type_line?.toLowerCase().includes(type.toLowerCase()) ?? false;
  }

  getCMC(cardName: string): number {
    const card = this.getCard(cardName);
    if (card?.cmc !== undefined) return card.cmc;
    // Calculate from mana cost if cmc not present
    return calculateCMC(card?.mana_cost || '');
  }

  /**
   * Parse and analyze triggered abilities from a card's oracle text
   */
  parseCardAbilities(card: CardData): { parsed: ParsedAbility[]; triggered: TriggeredAbility[] } {
    const oracleText = card.oracle_text || '';
    const parsed = parseOracleText(oracleText, card.name);
    const triggered = parseTriggeredAbilitiesFromText(
      oracleText, 
      card.id, 
      'controller', // Will be set properly during game
      card.name
    );
    
    return {
      parsed: [...parsed.abilities],
      triggered,
    };
  }

  getTotalMana(pool: ManaPool): number {
    return pool.white + pool.blue + pool.black + pool.red + pool.green + pool.colorless;
  }

  canPayMana(player: PlayerState, cost: number): boolean {
    return this.getTotalMana(player.manaPool) >= cost;
  }

  /**
   * Pay mana and return description of what was spent
   */
  payMana(player: PlayerState, cost: number): string {
    let remaining = cost;
    const spent: string[] = [];
    const colors: (keyof ManaPool)[] = ['colorless', 'white', 'blue', 'black', 'red', 'green'];
    const colorSymbols: Record<string, string> = {
      colorless: 'C',
      white: 'W',
      blue: 'U',
      black: 'B',
      red: 'R',
      green: 'G',
    };
    
    for (const color of colors) {
      const available = player.manaPool[color] || 0;
      const toPay = Math.min(available, remaining);
      if (toPay > 0) {
        spent.push(`${toPay}${colorSymbols[color]}`);
      }
      player.manaPool[color] = available - toPay;
      remaining -= toPay;
      if (remaining <= 0) break;
    }
    
    return spent.join(', ') || '0';
  }

  addManaForLand(player: PlayerState, landName: string): void {
    const card = this.getCard(landName);
    const oracle = card?.oracle_text?.toLowerCase() || '';
    const typeLine = card?.type_line?.toLowerCase() || '';
    
    // Check basic land types in type line
    if (typeLine.includes('plains') || oracle.includes('add {w}')) {
      player.manaPool.white++;
    } else if (typeLine.includes('island') || oracle.includes('add {u}')) {
      player.manaPool.blue++;
    } else if (typeLine.includes('swamp') || oracle.includes('add {b}')) {
      player.manaPool.black++;
    } else if (typeLine.includes('mountain') || oracle.includes('add {r}')) {
      player.manaPool.red++;
    } else if (typeLine.includes('forest') || oracle.includes('add {g}')) {
      player.manaPool.green++;
    } else if (oracle.includes('any color') || oracle.includes('mana of any')) {
      // Add colorless as a proxy for "any color" - pick based on what's commonly needed
      player.manaPool.colorless++;
    } else if (oracle.includes('add {c}')) {
      player.manaPool.colorless++;
    } else {
      // Default to colorless for unknown lands
      player.manaPool.colorless++;
    }
  }

  /**
   * Tap lands for mana and return list of tapped permanents
   */
  tapLandsForMana(player: PlayerState, state?: SimulatedGameState): string[] {
    const tappedLands: string[] = [];
    for (const perm of player.battlefield) {
      if (!perm.tapped && this.isLand(perm.card)) {
        perm.tapped = true;
        this.addManaForLand(player, perm.card);
        tappedLands.push(perm.card);
      }
    }
    
    if (state && this.analysisMode && tappedLands.length > 0) {
      // Count mana by type
      const manaGenerated = this.formatManaPool(player.manaPool);
      state.events.push({
        turn: state.turn,
        player: player.name,
        action: 'tap for mana',
        details: `Tapped ${tappedLands.length} lands`,
        result: `Generated: ${manaGenerated}`,
      });
    }
    
    return tappedLands;
  }

  /**
   * Format mana pool for display
   */
  formatManaPool(pool: ManaPool): string {
    const parts: string[] = [];
    if (pool.white > 0) parts.push(`${pool.white}W`);
    if (pool.blue > 0) parts.push(`${pool.blue}U`);
    if (pool.black > 0) parts.push(`${pool.black}B`);
    if (pool.red > 0) parts.push(`${pool.red}R`);
    if (pool.green > 0) parts.push(`${pool.green}G`);
    if (pool.colorless > 0) parts.push(`${pool.colorless}C`);
    return parts.length > 0 ? parts.join(', ') : '0';
  }

  /**
   * Summarize a list of lands for display (group duplicates)
   */
  summarizeLands(lands: string[]): string {
    const counts = new Map<string, number>();
    for (const land of lands) {
      counts.set(land, (counts.get(land) || 0) + 1);
    }
    
    const parts: string[] = [];
    for (const [land, count] of counts) {
      if (count > 1) {
        parts.push(`${count}x ${land}`);
      } else {
        parts.push(land);
      }
    }
    
    return parts.join(', ');
  }

  emptyManaPool(player: PlayerState): void {
    player.manaPool = { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
  }

  untapAll(player: PlayerState): void {
    for (const perm of player.battlefield) {
      perm.tapped = false;
      perm.summoningSickness = false;
    }
  }

  drawCards(player: PlayerState, count: number, state?: SimulatedGameState, source?: string): string[] {
    const drawn: string[] = [];
    for (let i = 0; i < count && player.library.length > 0; i++) {
      const card = player.library.shift()!;
      player.hand.push(card);
      drawn.push(card);
      player.cardsDrawnThisTurn++;
      
      // Log detailed draw event in analysis mode
      if (state && this.analysisMode) {
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'draw',
          card: card,
          fromZone: 'library',
          toZone: 'hand',
          details: source ? `Drew from ${source}` : 'Drew card',
          triggerSource: source,
        });
      }
    }
    
    // Process Psychosis Crawler-like effects (whenever you draw a card, each opponent loses life)
    if (state && drawn.length > 0) {
      this.processDrawTriggers(player, state, drawn.length);
    }
    
    return drawn;
  }

  /**
   * Process triggers that fire when a player draws cards.
   * Handles cards like Psychosis Crawler: "Whenever you draw a card, each opponent loses 1 life"
   */
  processDrawTriggers(player: PlayerState, state: SimulatedGameState, cardsDrawn: number): void {
    const playerId = this.getPlayerIdFromName(state, player.name);
    const opponents = this.getOpponents(state, playerId);
    
    for (const perm of player.battlefield) {
      const card = this.getCard(perm.card);
      const oracle = card?.oracle_text?.toLowerCase() || '';
      
      // Check for "whenever you draw a card, each opponent loses life" effects
      if (oracle.includes('whenever you draw') && oracle.includes('loses') && oracle.includes('life')) {
        for (const opponent of opponents) {
          opponent.life -= cardsDrawn;
        }
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'trigger',
          card: perm.card,
          details: `All opponents lost ${cardsDrawn} life from card draws`
        });
      }
    }
  }

  playLand(player: PlayerState, landName: string, state?: SimulatedGameState): boolean {
    if (player.landsPlayedThisTurn >= 1) return false;
    const handIndex = player.hand.indexOf(landName);
    if (handIndex === -1) return false;
    
    player.hand.splice(handIndex, 1);
    player.battlefield.push({
      card: landName,
      tapped: false,
      summoningSickness: false,
      power: 0,
      toughness: 0,
      counters: {},
    });
    player.landsPlayedThisTurn++;
    
    // Log detailed land play event
    if (state && this.analysisMode) {
      state.events.push({
        turn: state.turn,
        player: player.name,
        action: 'play land',
        card: landName,
        fromZone: 'hand',
        toZone: 'battlefield',
        details: `Played land (${player.landsPlayedThisTurn}/1 for turn)`,
      });
    }
    
    return true;
  }

  castSpell(player: PlayerState, cardName: string, state: SimulatedGameState, tappedForMana?: string[]): boolean {
    const cost = this.getCMC(cardName);
    if (!this.canPayMana(player, cost)) return false;
    
    const handIndex = player.hand.indexOf(cardName);
    if (handIndex === -1) return false;
    
    // Get mana pool state before paying
    const manaPoolBefore = this.formatManaPool(player.manaPool);
    const manaSpentDesc = this.payMana(player, cost);
    player.hand.splice(handIndex, 1);
    
    const card = this.getCard(cardName);
    const typeLine = card?.type_line?.toLowerCase() || '';
    const manaCostStr = card?.mana_cost || '';
    
    // Format tapped lands info
    const tappedInfo = tappedForMana && tappedForMana.length > 0 
      ? `Tapped: ${this.summarizeLands(tappedForMana)}` 
      : '';
    
    if (typeLine.includes('creature') || typeLine.includes('artifact') || 
        typeLine.includes('enchantment') || typeLine.includes('planeswalker')) {
      const power = parseInt(card?.power || '0', 10);
      const toughness = parseInt(card?.toughness || '0', 10);
      
      player.battlefield.push({
        card: cardName,
        tapped: false,
        summoningSickness: typeLine.includes('creature'),
        power,
        toughness,
        counters: {},
      });
      
      // Track cards played per player
      const playerKey = player.name;
      const existing = state.cardsPlayed.get(playerKey) || [];
      existing.push(cardName);
      state.cardsPlayed.set(playerKey, existing);
      
      // Log detailed cast event for permanents
      if (this.analysisMode) {
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'cast',
          card: cardName,
          fromZone: 'hand',
          toZone: 'stack → battlefield',
          manaSpent: cost,
          details: `Cast ${cardName} ${manaCostStr} (${typeLine})${power || toughness ? `, P/T: ${power}/${toughness}` : ''}`,
          reasoning: tappedInfo ? `${tappedInfo}, Spent: ${manaSpentDesc}` : `Spent: ${manaSpentDesc} from pool`,
          result: 'Resolved successfully, entered battlefield',
        });
      }
      
      this.handleETBTrigger(cardName, player, state);
    } else {
      // Log detailed cast event for instants/sorceries
      if (this.analysisMode) {
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'cast',
          card: cardName,
          fromZone: 'hand',
          toZone: 'stack → graveyard',
          manaSpent: cost,
          details: `Cast ${cardName} ${manaCostStr} (${typeLine})`,
          reasoning: tappedInfo ? `${tappedInfo}, Spent: ${manaSpentDesc}` : `Spent: ${manaSpentDesc} from pool`,
        });
      }
      
      this.resolveInstantSorcery(cardName, player, state);
      player.graveyard.push(cardName);
    }
    
    return true;
  }

  handleETBTrigger(cardName: string, player: PlayerState, state: SimulatedGameState): void {
    const card = this.getCard(cardName);
    const oracle = card?.oracle_text?.toLowerCase() || '';
    const playerId = this.getPlayerIdFromName(state, player.name);
    
    // Log the ETB trigger with parsed ability info
    if (oracle.includes('when') && oracle.includes('enters')) {
      const parsedAbility = parseTriggeredAbility(oracle);
      state.events.push({
        turn: state.turn,
        player: player.name,
        action: 'trigger',
        card: cardName,
        details: `ETB trigger: ${parsedAbility?.effect || 'effect detected'}`,
        oracleTextExecuted: true,
      });
    }
    
    // Check for devotion-based win conditions (like Thassa's Oracle)
    if (oracle.includes('devotion') && oracle.includes('you win the game')) {
      // Calculate devotion to blue (count blue mana symbols in mana costs)
      let devotion = 0;
      for (const p of player.battlefield) {
        const c = this.getCard(p.card);
        const manaCost = c?.mana_cost || '';
        const blueSymbols = (manaCost.match(/\{U\}/gi) || []).length;
        devotion += blueSymbols;
      }
      
      if (devotion >= player.library.length) {
        state.winner = playerId;
        state.winCondition = `${cardName} - devotion (${devotion}) exceeded library size (${player.library.length})`;
      }
    }
    
    // Check for tribal/type-based triggers
    const typeLine = card?.type_line?.toLowerCase() || '';
    for (const perm of player.battlefield) {
      const permCard = this.getCard(perm.card);
      const permOracle = permCard?.oracle_text?.toLowerCase() || '';
      
      // Kindred Discovery-like effect: draw when creature of chosen type enters
      if (permOracle.includes('whenever a creature you control') && permOracle.includes('enters') && permOracle.includes('draw')) {
        // Simplified: draw a card when a creature enters
        if (typeLine.includes('creature')) {
          this.drawCards(player, 1, state, perm.card);
          state.events.push({
            turn: state.turn,
            player: player.name,
            action: 'draw',
            card: perm.card,
            details: `Draw from creature entering (${cardName})`
          });
        }
      }
      
      // Token creation on creature spell cast (like Deeproot Waters)
      if (permOracle.includes('whenever you cast') && permOracle.includes('create') && permOracle.includes('token')) {
        // Create a token
        player.battlefield.push({
          card: 'Creature Token',
          tapped: false,
          summoningSickness: true,
          power: 1,
          toughness: 1,
          counters: {},
          isToken: true,
        });
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'trigger',
          card: perm.card,
          details: 'Created token from cast trigger'
        });
      }
    }
  }

  resolveInstantSorcery(cardName: string, player: PlayerState, state: SimulatedGameState): void {
    const playerId = this.getPlayerIdFromName(state, player.name);
    const opponents = this.getOpponents(state, playerId);
    const card = this.getCard(cardName);
    const oracle = card?.oracle_text?.toLowerCase() || '';
    
    // Parse the spell's effect using the oracle text parser
    const parsedResult = parseOracleText(oracle, cardName);
    
    // Handle common spell effects based on oracle text
    
    // Return to hand effects (like Cyclonic Rift)
    if (oracle.includes('return') && oracle.includes("owner's hand")) {
      let totalBounced = 0;
      const bouncedCards: string[] = [];
      
      for (const opponent of opponents) {
        const nonlands = opponent.battlefield.filter(p => !this.isLand(p.card));
        for (const perm of nonlands) {
          if (!perm.isToken) {
            opponent.hand.push(perm.card);
            bouncedCards.push(`${perm.card} (${opponent.name})`);
          }
          totalBounced++;
        }
        opponent.battlefield = opponent.battlefield.filter(p => this.isLand(p.card));
      }
      
      state.events.push({
        turn: state.turn,
        player: player.name,
        action: 'resolve',
        card: cardName,
        fromZone: 'battlefield',
        toZone: 'hand',
        details: `Bounced ${totalBounced} permanents: ${bouncedCards.slice(0, 3).join(', ')}${bouncedCards.length > 3 ? '...' : ''}`,
        result: `${totalBounced} permanents returned to owners' hands`,
      });
      return;
    }
    
    // Exile creature effects (like Swords to Plowshares)
    if (oracle.includes('exile target creature')) {
      const opponent = opponents[Math.floor(this.rng() * opponents.length)];
      if (opponent) {
        const creatures = opponent.battlefield.filter(p => this.isCreature(p.card));
        if (creatures.length > 0) {
          const target = creatures[0];
          opponent.battlefield = opponent.battlefield.filter(p => p !== target);
          opponent.exile.push(target.card);
          
          let lifeGained = 0;
          if (oracle.includes('gains life equal to its power')) {
            lifeGained = target.power;
            opponent.life += lifeGained;
          }
          
          state.events.push({
            turn: state.turn,
            player: player.name,
            action: 'resolve',
            card: cardName,
            targetCard: target.card,
            targetPlayer: opponent.name,
            fromZone: 'battlefield',
            toZone: 'exile',
            lifeChange: lifeGained,
            details: `Exiled ${target.card} (P/T: ${target.power}/${target.toughness})`,
            result: lifeGained > 0 ? `${opponent.name} gained ${lifeGained} life` : 'Exiled creature',
          });
        } else {
          state.events.push({
            turn: state.turn,
            player: player.name,
            action: 'fizzle',
            card: cardName,
            details: 'No valid target creature',
            result: 'Spell fizzled - no targets',
          });
        }
      }
      return;
    }
    
    // Search library for land (like Cultivate)
    if (oracle.includes('search') && oracle.includes('library') && oracle.includes('basic land')) {
      const basics = player.library.filter(c => {
        const cardData = this.getCard(c);
        return cardData?.type_line?.toLowerCase().includes('basic land');
      });
      
      if (basics.length >= 2) {
        const land1 = basics[0];
        const land2 = basics[1];
        
        // Remove from library
        let removedFirst = false;
        let removedSecond = false;
        player.library = player.library.filter(c => {
          if (!removedFirst && c === land1) {
            removedFirst = true;
            return false;
          }
          if (!removedSecond && c === land2) {
            removedSecond = true;
            return false;
          }
          return true;
        });
        
        // Put one on battlefield, one in hand
        player.battlefield.push({
          card: land1,
          tapped: true,
          summoningSickness: false,
          power: 0,
          toughness: 0,
          counters: {},
        });
        player.hand.push(land2);
        
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'resolve',
          card: cardName,
          details: `Searched library for basic lands`,
          result: `${land1}: library → battlefield (tapped), ${land2}: library → hand`,
        });
      } else {
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'resolve',
          card: cardName,
          details: 'Not enough basic lands in library',
          result: 'Partial resolution',
        });
      }
      return;
    }
    
    // Damage to all creatures (like Blasphemous Act)
    if (oracle.includes('damage to each creature')) {
      const damageMatch = oracle.match(/deals?\s+(\d+)\s+damage/);
      const damageAmount = damageMatch ? parseInt(damageMatch[1], 10) : 13;
      
      let killed = 0;
      const killedCreatures: string[] = [];
      
      for (let i = 1; i <= state.playerCount; i++) {
        const p = state.players[i];
        if (!p) continue;
        
        const creatures = p.battlefield.filter(perm => this.isCreature(perm.card));
        for (const creature of creatures) {
          creature.damage = (creature.damage || 0) + damageAmount;
          if ((creature.damage || 0) >= creature.toughness) {
            p.battlefield = p.battlefield.filter(x => x !== creature);
            if (!creature.isToken) {
              p.graveyard.push(creature.card);
              killedCreatures.push(`${creature.card} (${p.name})`);
            }
            killed++;
          }
        }
      }
      
      state.events.push({
        turn: state.turn,
        player: player.name,
        action: 'resolve',
        card: cardName,
        fromZone: 'battlefield',
        toZone: 'graveyard',
        details: `Dealt ${damageAmount} damage to all creatures`,
        result: `Killed ${killed} creatures: ${killedCreatures.slice(0, 3).join(', ')}${killedCreatures.length > 3 ? '...' : ''}`,
      });
      return;
    }
    
    // Pump effects (like Triumph of the Hordes)
    if (oracle.includes('creatures you control get') && oracle.includes('+')) {
      const creatureCount = player.battlefield.filter(p => this.isCreature(p.card)).length;
      for (const perm of player.battlefield) {
        if (this.isCreature(perm.card)) {
          perm.power += 1;
          perm.toughness += 1;
        }
      }
      state.events.push({
        turn: state.turn,
        player: player.name,
        action: 'cast',
        card: cardName,
        details: 'Creatures get +1/+1 until end of turn'
      });
      return;
    }
    
    // Counter target spell
    if (oracle.includes('counter target spell')) {
      state.events.push({
        turn: state.turn,
        player: player.name,
        action: 'cast',
        card: cardName,
        details: 'Countered a spell (simulated)'
      });
      return;
    }
    
    // Default: log that the spell was cast
    state.events.push({
      turn: state.turn,
      player: player.name,
      action: 'cast',
      card: cardName,
      details: `Effect: ${parsedResult.abilities[0]?.effect || oracle.substring(0, 50)}...`
    });
  }

  checkStateBasedActions(state: SimulatedGameState): boolean {
    let changed = false;
    const alivePlayers: number[] = [];
    
    for (let playerId = 1; playerId <= state.playerCount; playerId++) {
      const player = state.players[playerId];
      if (!player) continue;
      
      // Check for player elimination
      if (player.life <= 0) {
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'eliminated',
          details: `Life total reduced to ${player.life}`
        });
        // Mark as eliminated by setting life to a very negative number
        player.life = -999;
        changed = true;
        continue;
      }
      
      if (player.poisonCounters >= 10) {
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'eliminated',
          details: `Received ${player.poisonCounters} poison counters`
        });
        player.life = -999;
        changed = true;
        continue;
      }
      
      // Player is still alive
      if (player.life > 0) {
        alivePlayers.push(playerId);
      }
    }
    
    // Check for winner (last player standing)
    if (alivePlayers.length === 1 && !state.winner) {
      state.winner = alivePlayers[0];
      state.winCondition = 'Last player standing';
      return true;
    }
    
    // Check for no players left (shouldn't happen, but safety check)
    if (alivePlayers.length === 0 && !state.winner) {
      state.winner = 0; // Draw
      state.winCondition = 'All players eliminated simultaneously';
      return true;
    }
    
    return changed;
  }

  checkWinConditions(state: SimulatedGameState): boolean {
    for (let playerId = 1; playerId <= state.playerCount; playerId++) {
      const player = state.players[playerId];
      if (!player || player.life <= 0) continue;
      
      // Check for cards with win conditions in oracle text
      for (const perm of player.battlefield) {
        const card = this.getCard(perm.card);
        const oracle = card?.oracle_text?.toLowerCase() || '';
        
        // Aetherflux Reservoir-like effects
        if (oracle.includes('pay 50 life') && oracle.includes('50 damage') && player.life >= 51) {
          // Find an opponent to target
          const opponent = this.getRandomOpponent(state, playerId);
          if (opponent) {
            player.life -= 50;
            opponent.life -= 50;
            state.events.push({
              turn: state.turn,
              player: player.name,
              action: 'ability',
              card: perm.card,
              details: `Paid 50 life to deal 50 damage to ${opponent.name}`
            });
            if (opponent.life <= 0) {
              this.checkStateBasedActions(state);
              return true;
            }
          }
        }
        
        // Thassa's Oracle-like effects (devotion win)
        if (oracle.includes('devotion') && oracle.includes('you win the game')) {
          // Calculate blue devotion (count blue mana symbols in mana costs)
          let devotion = 0;
          for (const p of player.battlefield) {
            const c = this.getCard(p.card);
            const manaCost = c?.mana_cost || '';
            const blueSymbols = (manaCost.match(/\{U\}/gi) || []).length;
            devotion += blueSymbols;
          }
          
          if (devotion >= player.library.length) {
            state.winner = playerId;
            state.winCondition = `${perm.card} - devotion (${devotion}) >= library size (${player.library.length})`;
            return true;
          }
        }
      }
    }
    
    return false;
  }

  /**
   * Get a random opponent for the attacker in multiplayer
   */
  getRandomOpponent(state: SimulatedGameState, attackingPlayerId: number): PlayerState | null {
    const livingOpponents: number[] = [];
    for (let i = 1; i <= state.playerCount; i++) {
      if (i !== attackingPlayerId && state.players[i] && state.players[i].life > 0) {
        livingOpponents.push(i);
      }
    }
    
    if (livingOpponents.length === 0) return null;
    
    const targetIndex = Math.floor(this.rng() * livingOpponents.length);
    return state.players[livingOpponents[targetIndex]];
  }

  simulateCombat(state: SimulatedGameState, attackingPlayerId: number): void {
    const attacker = state.players[attackingPlayerId];
    const defender = this.getRandomOpponent(state, attackingPlayerId);
    
    if (!defender) return; // No valid opponent
    
    // Check for pillowfort effects on defender
    const hasGhostlyPrison = defender.battlefield.some(p => 
      p.card.toLowerCase().includes('ghostly prison') || 
      this.getCard(p.card)?.oracle_text?.toLowerCase().includes("can't attack you unless")
    );
    const hasNoAttackEffect = defender.battlefield.some(p => 
      this.getCard(p.card)?.oracle_text?.toLowerCase().includes("creatures can't attack you")
    );
    
    if (hasNoAttackEffect) {
      state.events.push({
        turn: state.turn,
        player: attacker.name,
        action: 'combat blocked',
        details: `Cannot attack ${defender.name} due to protection effect`
      });
      return;
    }
    
    const attackers = attacker.battlefield.filter(p => 
      this.isCreature(p.card) && 
      !p.tapped && 
      !p.summoningSickness
    );
    
    if (attackers.length === 0) return;
    
    // If Ghostly Prison-like effect, calculate how many creatures we can afford to attack with
    let affordableAttackers = attackers;
    if (hasGhostlyPrison) {
      const availableMana = this.getTotalMana(attacker.manaPool);
      const maxAttackers = Math.floor(availableMana / 2);
      affordableAttackers = attackers.slice(0, maxAttackers);
    }
    
    if (affordableAttackers.length === 0) {
      state.events.push({
        turn: state.turn,
        player: attacker.name,
        action: 'combat blocked',
        details: `Cannot afford to attack ${defender.name} through protection effects`
      });
      return;
    }
    
    let totalDamage = 0;
    let infect = false;
    
    for (const creature of affordableAttackers) {
      creature.tapped = true;
      if (hasGhostlyPrison) {
        this.payMana(attacker, 2);
      }
      totalDamage += creature.power || 0;
      
      const card = this.getCard(creature.card);
      if (card?.oracle_text?.toLowerCase().includes('infect')) {
        infect = true;
      }
    }
    
    if (infect) {
      defender.poisonCounters += totalDamage;
      state.events.push({
        turn: state.turn,
        player: attacker.name,
        action: 'combat',
        details: `Dealt ${totalDamage} infect damage to ${defender.name} (${defender.poisonCounters}/10 poison)`
      });
    } else {
      defender.life -= totalDamage;
      state.events.push({
        turn: state.turn,
        player: attacker.name,
        action: 'combat',
        details: `Dealt ${totalDamage} damage to ${defender.name} (at ${defender.life} life)`
      });
    }
  }

  simulateMainPhase(player: PlayerState, state: SimulatedGameState): void {
    // Play a land if possible
    const lands = player.hand.filter(c => this.isLand(c));
    if (lands.length > 0 && player.landsPlayedThisTurn < 1) {
      const land = lands[0];
      if (this.playLand(player, land, state)) {
        // Only add event if not in analysis mode (playLand adds detailed event)
        if (!this.analysisMode) {
          state.events.push({
            turn: state.turn,
            player: player.name,
            action: 'play land',
            card: land,
          });
        }
      }
    }
    
    // Tap lands for mana and track which lands were tapped
    const tappedLands = this.tapLandsForMana(player, state);
    
    // Cast spells prioritizing by importance
    const castable = player.hand
      .filter(c => !this.isLand(c))
      .filter(c => this.canPayMana(player, this.getCMC(c)))
      .sort((a, b) => {
        const aCard = this.getCard(a);
        const bCard = this.getCard(b);
        
        // Win conditions first
        const aOracle = aCard?.oracle_text?.toLowerCase() || '';
        const bOracle = bCard?.oracle_text?.toLowerCase() || '';
        if (aOracle.includes('you win the game')) return -1;
        if (bOracle.includes('you win the game')) return 1;
        
        // Mana rocks/acceleration next
        if (aOracle.includes('add {c}{c}') || aOracle.includes('add two mana')) return -1;
        if (bOracle.includes('add {c}{c}') || bOracle.includes('add two mana')) return 1;
        
        // Then by CMC (cheaper first)
        return this.getCMC(a) - this.getCMC(b);
      });
    
    let spellsCast = 0;
    for (const spell of castable) {
      if (spellsCast >= 3) break;
      
      // Determine reasoning for casting this spell
      const cardData = this.getCard(spell);
      const typeLine = cardData?.type_line || '';
      let reasoning = '';
      
      if (cardData?.oracle_text?.toLowerCase().includes('add {c}{c}')) {
        reasoning = 'Mana acceleration - provides additional mana for future turns';
      } else if (cardData?.oracle_text?.toLowerCase().includes('you win the game')) {
        reasoning = 'Win condition card';
      } else if (typeLine.includes('Creature')) {
        reasoning = `Creature for board presence (${cardData.power}/${cardData.toughness})`;
      } else if (typeLine.includes('Enchantment')) {
        reasoning = 'Enchantment for ongoing value';
      } else if (typeLine.includes('Artifact')) {
        reasoning = 'Artifact for utility';
      } else {
        const ORACLE_TEXT_PREVIEW_LENGTH = 50;
        reasoning = `Cast for its effect: ${cardData?.oracle_text?.substring(0, ORACLE_TEXT_PREVIEW_LENGTH) || 'unknown'}...`;
      }
      
      // Pass the list of tapped lands to castSpell for tracking
      if (this.castSpell(player, spell, state, tappedLands)) {
        spellsCast++;
        
        const isPermanent = typeLine.toLowerCase().includes('creature') || 
                           typeLine.toLowerCase().includes('artifact') || 
                           typeLine.toLowerCase().includes('enchantment') || 
                           typeLine.toLowerCase().includes('planeswalker');
        const result = isPermanent 
          ? 'Successfully resolved. Added to battlefield.'
          : 'Successfully resolved. Effect applied, card moved to graveyard.';
        
        // Only add basic event if not in analysis mode (castSpell adds detailed event)
        if (!this.analysisMode) {
          state.events.push({
            turn: state.turn,
            player: player.name,
            action: 'cast',
            card: spell,
            reasoning,
            result,
          });
        }
        this.log(`${player.name} cast ${spell}`);
        this.log(`  Reasoning: ${reasoning}`);
        this.log(`  Result: ${result}`);
      }
    }
  }

  /**
   * Get all opponents for a player in multiplayer
   */
  getOpponents(state: SimulatedGameState, playerId: number): PlayerState[] {
    const opponents: PlayerState[] = [];
    for (let i = 1; i <= state.playerCount; i++) {
      if (i !== playerId && state.players[i] && state.players[i].life > 0) {
        opponents.push(state.players[i]);
      }
    }
    return opponents;
  }

  /**
   * Get player ID from player name
   */
  getPlayerIdFromName(state: SimulatedGameState, name: string): number {
    for (let i = 1; i <= state.playerCount; i++) {
      if (state.players[i]?.name === name) {
        return i;
      }
    }
    return 1; // Default fallback
  }

  handleUpkeepTriggers(player: PlayerState, state: SimulatedGameState): void {
    // Check for Howling Mine effects across all players
    let hasUntappedHowlingMine = false;
    for (let i = 1; i <= state.playerCount; i++) {
      const p = state.players[i];
      if (p?.battlefield.some(perm => 
        perm.card.toLowerCase().includes('howling mine') && !perm.tapped ||
        this.getCard(perm.card)?.oracle_text?.toLowerCase().includes('each player draws an additional card')
      )) {
        hasUntappedHowlingMine = true;
        break;
      }
    }
    
    if (hasUntappedHowlingMine) {
      this.drawCards(player, 1, state, 'Howling Mine');
      state.events.push({
        turn: state.turn,
        player: player.name,
        action: 'draw',
        card: 'Howling Mine',
        details: 'Drew extra card from Howling Mine effect'
      });
    }
    
    // Note: Psychosis Crawler-like effects are now handled in processDrawTriggers,
    // which is called from drawCards when cards are actually drawn.
  }

  handleEndStepTriggers(player: PlayerState, state: SimulatedGameState): void {
    const playerId = this.getPlayerIdFromName(state, player.name);
    
    // Check for end step triggers on all permanents
    for (const perm of player.battlefield) {
      const card = this.getCard(perm.card);
      const oracle = card?.oracle_text?.toLowerCase() || '';
      
      // Check for "at the beginning of your end step, draw a card" effects
      if (oracle.includes('beginning of your end step') && oracle.includes('draw a card')) {
        this.drawCards(player, 1, state, perm.card);
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'trigger',
          card: perm.card,
          details: 'Drew a card at end step'
        });
        
        // Check if the effect allows others to put lands (like Kynaios and Tiro)
        if (oracle.includes('each player may put a land')) {
          for (let i = 1; i <= state.playerCount; i++) {
            const p = state.players[i];
            if (!p || p.life <= 0) continue;
            
            const landInHand = p.hand.find(c => this.isLand(c));
            if (landInHand) {
              const idx = p.hand.indexOf(landInHand);
              p.hand.splice(idx, 1);
              p.battlefield.push({
                card: landInHand,
                tapped: false,
                summoningSickness: false,
                power: 0,
                toughness: 0,
                counters: {},
              });
              state.events.push({
                turn: state.turn,
                player: p.name,
                action: 'play land',
                card: landInHand,
                details: `Put land onto battlefield from ${perm.card} trigger`
              });
            }
          }
        }
      }
    }
  }

  simulateTurn(state: SimulatedGameState): void {
    state.turn++;
    // Rotate through players based on player count
    const activePlayerId = ((state.turn - 1) % state.playerCount) + 1;
    state.activePlayer = activePlayerId;
    const player = state.players[activePlayerId];
    
    if (!player) {
      console.error(`No player found for ID ${activePlayerId}`);
      return;
    }
    
    // Untap
    this.untapAll(player);
    player.landsPlayedThisTurn = 0;
    player.cardsDrawnThisTurn = 0;
    
    // Upkeep
    this.handleUpkeepTriggers(player, state);
    
    // Draw (skip turn 1 for player 1 in first round)
    if (state.turn > state.playerCount || activePlayerId !== 1) {
      this.drawCards(player, 1, state, 'draw step');
    }
    
    // Pre-combat main
    this.simulateMainPhase(player, state);
    
    // Combat (skip early turns - wait until each player has had at least 2 turns)
    if (state.turn > state.playerCount * 2) {
      this.simulateCombat(state, activePlayerId);
    }
    
    // End step
    this.handleEndStepTriggers(player, state);
    
    // Cleanup
    while (player.hand.length > 7) {
      const discarded = player.hand.pop()!;
      player.graveyard.push(discarded);
    }
    
    this.emptyManaPool(player);
    
    for (const perm of player.battlefield) {
      perm.damage = 0;
    }
  }

  createInitialState(): SimulatedGameState {
    const players: Record<number, PlayerState> = {};
    
    for (let i = 1; i <= this.playerCount; i++) {
      const deck = this.loadedDecks[i - 1];
      const deckCards = deck.cards.slice(1).map(c => c.name); // Exclude commander
      
      players[i] = {
        name: `Player ${i} (${deck.name})`,
        life: 40,
        commander: deck.commander.name,
        commanderInCommandZone: true,
        commanderTax: 0,
        library: this.shuffle([...deckCards]),
        hand: [],
        battlefield: [],
        graveyard: [],
        exile: [],
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        landsPlayedThisTurn: 0,
        poisonCounters: 0,
        cardsDrawnThisTurn: 0,
      };
    }
    
    return {
      turn: 0,
      activePlayer: 1,
      phase: 'beginning',
      players,
      playerCount: this.playerCount,
      stack: [],
      events: [],
      cardsPlayed: new Map(),
      winner: null,
      winCondition: null,
    };
  }

  async runGame(gameNumber: number): Promise<GameSummary> {
    // Use a unique seed for each game based on base seed + game number * SEED_SPACING
    const gameSeed = this.currentSeed + gameNumber * SEED_SPACING;
    this.initRng(gameSeed);
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Starting Game ${gameNumber} (Seed: ${gameSeed}, Players: ${this.playerCount}, Max Turns: ${this.maxTurns})`);
    console.log(`${'='.repeat(60)}`);
    
    if (this.analysisMode) {
      console.log('\n[ANALYSIS MODE ENABLED - Detailed replay with reasoning]\n');
    }
    
    const state = this.createInitialState();
    
    // Log initial state for all players
    for (let i = 1; i <= this.playerCount; i++) {
      const player = state.players[i];
      this.log(`Player ${i} (${player.commander}) library top 5: ${player.library.slice(0, 5).join(', ')}`);
    }
    
    // Draw initial hands for all players
    for (let i = 1; i <= this.playerCount; i++) {
      this.drawCards(state.players[i], 7, state, 'opening hand');
      this.log(`Player ${i} opening hand: ${state.players[i].hand.join(', ')}`);
    }
    
    // Simple mulligan for all players
    for (let playerId = 1; playerId <= this.playerCount; playerId++) {
      const player = state.players[playerId];
      let mulligans = 0;
      
      while (mulligans < 2) {
        const lands = player.hand.filter(c => this.isLand(c)).length;
        if (lands >= 2 && lands <= 5) break;
        
        const handSize = 7 - mulligans - 1;
        if (handSize < 5) break;
        
        player.library.push(...player.hand);
        player.hand = [];
        player.library = this.shuffle(player.library);
        this.drawCards(player, handSize, state, 'mulligan');
        mulligans++;
        
        state.events.push({
          turn: 0,
          player: player.name,
          action: 'mulligan',
          details: `Mulliganed to ${handSize} cards`
        });
      }
    }
    
    // Main game loop - use configured maxTurns
    while (state.turn < this.maxTurns && !state.winner) {
      this.simulateTurn(state);
      this.checkStateBasedActions(state);
      this.checkWinConditions(state);
      
      // Print turn summary
      const activePlayer = state.players[state.activePlayer];
      if (activePlayer) {
        const lifeStatus = Array.from({ length: this.playerCount }, (_, i) => {
          const p = state.players[i + 1];
          return p && p.life > 0 ? `P${i + 1}=${p.life}` : `P${i + 1}=☠️`;
        }).join(', ');
        
        console.log(`Turn ${state.turn}: ${activePlayer.name.split('(')[1]?.replace(')', '') || activePlayer.name} - Life: ${lifeStatus}`);
      }
    }
    
    // Determine winner if game reached turn limit
    if (!state.winner) {
      // Find player with highest life total among living players
      let highestLife = -1;
      let winningPlayerId = 0;
      
      for (let i = 1; i <= this.playerCount; i++) {
        const player = state.players[i];
        if (player && player.life > highestLife) {
          highestLife = player.life;
          winningPlayerId = i;
        }
      }
      
      if (winningPlayerId > 0) {
        state.winner = winningPlayerId;
        state.winCondition = `Highest life total (${highestLife}) at turn limit`;
      } else {
        state.winner = 0;
        state.winCondition = 'Game timeout - no clear winner';
      }
    }
    
    const winnerName = state.winner > 0 && state.players[state.winner] 
      ? state.players[state.winner].name 
      : 'No winner';
    console.log(`\nGame ${gameNumber} Winner: ${winnerName}`);
    console.log(`Win Condition: ${state.winCondition}`);
    
    const cardsWithNoImpact = this.analyzeNoImpactCards(state);
    const unexpectedBehaviors = this.findUnexpectedBehaviors(state);
    const expectedNotOccurred = this.findExpectedBehaviorsNotOccurred(state);
    const cardsNotFunctioningAsIntended = this.analyzeCardFunctionality(state);
    
    // Print analysis mode replay if enabled
    if (this.analysisMode) {
      this.printDetailedReplay(state);
    }
    
    return {
      gameNumber,
      winner: winnerName,
      winCondition: state.winCondition || 'Unknown',
      totalTurns: state.turn,
      events: state.events,
      cardsPlayed: state.cardsPlayed,
      cardsWithNoImpact,
      unexpectedBehaviors,
      expectedBehaviorsNotOccurred: expectedNotOccurred,
      cardsNotFunctioningAsIntended,
      seed: gameSeed,
    };
  }

  private printDetailedReplay(state: SimulatedGameState): void {
    console.log('\n' + '='.repeat(60));
    console.log('DETAILED GAME REPLAY');
    console.log('='.repeat(60));
    
    let currentTurn = -1;
    for (const event of state.events) {
      if (event.turn !== currentTurn) {
        currentTurn = event.turn;
        console.log(`\n--- Turn ${currentTurn} ---`);
      }
      
      let eventStr = `  ${event.player}: ${event.action}`;
      if (event.card) eventStr += ` - ${event.card}`;
      if (event.details) eventStr += ` (${event.details})`;
      console.log(eventStr);
      
      // Show zone movements
      if (event.fromZone || event.toZone) {
        const zoneInfo = `    Zone: ${event.fromZone || '?'} → ${event.toZone || '?'}`;
        console.log(zoneInfo);
      }
      
      // Show target information
      if (event.targetCard) {
        let targetInfo = `    Target: ${event.targetCard}`;
        if (event.targetPlayer) targetInfo += ` (controlled by ${event.targetPlayer})`;
        console.log(targetInfo);
      }
      
      // Show mana spent
      if (event.manaSpent !== undefined && event.manaSpent > 0) {
        console.log(`    Mana: ${event.manaSpent} spent`);
      }
      
      // Show life changes
      if (event.lifeChange !== undefined && event.lifeChange !== 0) {
        const sign = event.lifeChange > 0 ? '+' : '';
        console.log(`    Life: ${sign}${event.lifeChange}`);
      }
      
      // Show reasoning (includes tapped lands info)
      if (event.reasoning) {
        console.log(`    Mana sources: ${event.reasoning}`);
      }
      
      // Show result
      if (event.result) {
        console.log(`    Result: ${event.result}`);
      }
      
      // Show oracle text execution status
      if (event.oracleTextExecuted === false) {
        console.log(`    ⚠️ Oracle text NOT fully executed!`);
        if (event.expectedEffect) console.log(`    Expected: ${event.expectedEffect}`);
        if (event.actualEffect) console.log(`    Actual: ${event.actualEffect}`);
      }
      
      // Show token details
      if (event.tokenDetails) {
        console.log(`    Token: ${event.tokenDetails}`);
      }
      
      // Show trigger source
      if (event.triggerSource) {
        console.log(`    Trigger source: ${event.triggerSource}`);
      }
    }
  }

  private analyzeCardFunctionality(state: SimulatedGameState): string[] {
    const notFunctioning: string[] = [];
    
    // Check events for cards where oracle text wasn't executed
    for (const event of state.events) {
      if (event.oracleTextExecuted === false && event.card) {
        const issue = `${event.card}: Expected "${event.expectedEffect}" but got "${event.actualEffect}"`;
        if (!notFunctioning.includes(issue)) {
          notFunctioning.push(issue);
        }
      }
    }
    
    // Check for specific known cards that should have effects
    for (const [playerName, cards] of state.cardsPlayed) {
      for (const card of cards) {
        const cardData = this.getCard(card);
        if (!cardData) continue;
        
        // Psychosis Crawler should deal damage when its controller draws cards
        if (card === 'Psychosis Crawler') {
          const crawlerDamage = state.events.filter(e => 
            e.card === 'Psychosis Crawler' && e.action === 'trigger'
          ).length;
          // Only count draws by the Psychosis Crawler's controller (the player who played it)
          const controllerDraws = state.events.filter(e => 
            e.action === 'draw' && e.player.includes(playerName.includes('1') ? '1' : '2')
          ).length;
          if (controllerDraws > 0 && crawlerDamage === 0) {
            notFunctioning.push(`Psychosis Crawler (${playerName}): Should have triggered on controller's card draws but didn't`);
          }
        }
      }
    }
    
    return [...new Set(notFunctioning)];
  }

  analyzeNoImpactCards(state: SimulatedGameState): string[] {
    const noImpact: string[] = [];
    
    for (const [playerName, cards] of state.cardsPlayed) {
      for (const card of cards) {
        const cardData = this.getCard(card);
        const oracle = cardData?.oracle_text?.toLowerCase() || '';
        
        const hadEffect = state.events.some(e => 
          e.card === card && (e.action === 'trigger' || e.details?.includes(card))
        );
        
        // Card has triggered abilities but never triggered during the game
        if (!hadEffect && (oracle.includes('whenever') || oracle.includes('at the beginning'))) {
          noImpact.push(`${card} (${playerName})`);
        }
      }
    }
    
    return [...new Set(noImpact)];
  }

  findUnexpectedBehaviors(state: SimulatedGameState): string[] {
    const unexpected: string[] = [];
    
    for (let playerId = 1; playerId <= state.playerCount; playerId++) {
      const player = state.players[playerId];
      if (!player) continue;
      
      if (player.life > 80) {
        unexpected.push(`${player.name} reached unusually high life total: ${player.life}`);
      }
      
      if (player.battlefield.length > 25) {
        unexpected.push(`${player.name} has very large board: ${player.battlefield.length} permanents`);
      }
    }
    
    return unexpected;
  }

  findExpectedBehaviorsNotOccurred(state: SimulatedGameState): string[] {
    const notOccurred: string[] = [];
    
    // Check for triggered abilities that should have triggered but didn't
    for (let playerId = 1; playerId <= state.playerCount; playerId++) {
      const player = state.players[playerId];
      if (!player) continue;
      
      for (const perm of player.battlefield) {
        const card = this.getCard(perm.card);
        const oracle = card?.oracle_text?.toLowerCase() || '';
        
        // Check for triggered abilities that have conditions that were likely met
        // Use regex to properly match "whenever...enters" patterns, excluding creature lands 
        // that have "whenever this creature attacks" and "this land enters tapped" separately
        const hasWheneverEntersTrigger = 
          /whenever.*enters the battlefield/i.test(oracle) ||
          /when.*enters the battlefield/i.test(oracle);
        
        if (hasWheneverEntersTrigger) {
          // Check if a creature ever entered but this trigger didn't fire
          const enterEvents = state.events.filter(e => 
            e.player === player.name && 
            (e.action === 'play land' || (e.action === 'cast' && this.isCreature(e.card || '')))
          ).length;
          
          const triggerEvents = state.events.filter(e => 
            e.card === perm.card && e.action === 'trigger'
          ).length;
          
          if (enterEvents > 0 && triggerEvents === 0) {
            notOccurred.push(`${perm.card} (${player.name}): Should have triggered on permanent entering but didn't`);
          }
        }
      }
    }
    
    return [...new Set(notOccurred)];
  }

  generateReport(summaries: GameSummary[]): void {
    console.log('\n' + '='.repeat(80));
    console.log(`SIMULATION REPORT - ${summaries.length} Commander Games`);
    console.log(`Players: ${this.playerCount}, Max Turns: ${this.maxTurns}`);
    console.log('Decks:');
    for (let i = 0; i < this.loadedDecks.length; i++) {
      console.log(`  Player ${i + 1}: ${this.loadedDecks[i].commander.name} (${this.loadedDecks[i].name})`);
    }
    console.log('='.repeat(80) + '\n');
    
    // Count wins per player
    const wins = new Map<string, number>();
    for (const summary of summaries) {
      const winner = summary.winner;
      wins.set(winner, (wins.get(winner) || 0) + 1);
    }
    
    console.log('WIN SUMMARY:');
    for (const [winner, count] of wins) {
      console.log(`  ${winner}: ${count} win(s)`);
    }
    console.log('');
    
    console.log('WIN CONDITIONS BY GAME:');
    for (const summary of summaries) {
      console.log(`  Game ${summary.gameNumber} (Seed: ${summary.seed}): ${summary.winner}`);
      console.log(`    Win Condition: ${summary.winCondition}`);
      console.log(`    Total Turns: ${summary.totalTurns}`);
    }
    console.log('');
    
    console.log('RANDOM SEEDS USED:');
    for (const summary of summaries) {
      console.log(`  Game ${summary.gameNumber}: Seed ${summary.seed}`);
    }
    console.log('');
    
    console.log('CARDS WITH NO IMPACT ON GAMEPLAY:');
    const allNoImpact = new Set<string>();
    for (const summary of summaries) {
      for (const card of summary.cardsWithNoImpact) {
        allNoImpact.add(card);
      }
    }
    if (allNoImpact.size === 0) {
      console.log('  All played cards contributed to gameplay.');
    } else {
      for (const card of allNoImpact) {
        console.log(`  - ${card}`);
      }
    }
    console.log('');
    
    console.log('UNEXPECTED BEHAVIORS:');
    const allUnexpected = new Set<string>();
    for (const summary of summaries) {
      for (const behavior of summary.unexpectedBehaviors) {
        allUnexpected.add(behavior);
      }
    }
    if (allUnexpected.size === 0) {
      console.log('  No unexpected behaviors observed.');
    } else {
      for (const behavior of allUnexpected) {
        console.log(`  - ${behavior}`);
      }
    }
    console.log('');
    
    console.log('EXPECTED BEHAVIORS THAT DID NOT OCCUR:');
    const allExpected = new Set<string>();
    for (const summary of summaries) {
      for (const behavior of summary.expectedBehaviorsNotOccurred) {
        allExpected.add(behavior);
      }
    }
    if (allExpected.size === 0) {
      console.log('  All expected synergies and triggers occurred as anticipated.');
    } else {
      for (const behavior of allExpected) {
        console.log(`  - ${behavior}`);
      }
    }
    console.log('');
    
    console.log('CARDS NOT FUNCTIONING AS INTENDED:');
    const allNotFunctioning = new Set<string>();
    for (const summary of summaries) {
      for (const issue of summary.cardsNotFunctioningAsIntended) {
        allNotFunctioning.add(issue);
      }
    }
    if (allNotFunctioning.size === 0) {
      console.log('  All cards functioned according to their oracle text.');
    } else {
      for (const issue of allNotFunctioning) {
        console.log(`  - ${issue}`);
      }
    }
    console.log('');
    
    console.log('TOP CARDS PLAYED (across all games):');
    const cardsByPlayer = new Map<string, Map<string, number>>();
    
    for (const summary of summaries) {
      for (const [playerKey, cards] of summary.cardsPlayed) {
        if (!cardsByPlayer.has(playerKey)) {
          cardsByPlayer.set(playerKey, new Map());
        }
        const playerCards = cardsByPlayer.get(playerKey)!;
        for (const card of cards) {
          playerCards.set(card, (playerCards.get(card) || 0) + 1);
        }
      }
    }
    
    for (const [playerKey, cards] of cardsByPlayer) {
      console.log(`  ${playerKey}:`);
      const sorted = [...cards.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      for (const [card, count] of sorted) {
        console.log(`    - ${card}: ${count} time(s)`);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('END OF SIMULATION REPORT');
    console.log('='.repeat(80));
  }

  async run(): Promise<void> {
    console.log('Commander Game Simulator');
    console.log(`Players: ${this.playerCount}, Max Turns: ${this.maxTurns}`);
    console.log('Loading decks from precon_json folder...\n');
    
    // Load decks
    this.loadDecks();
    
    if (this.loadedDecks.length < 2) {
      console.error('Error: Not enough decks available. Need at least 2 decks.');
      return;
    }
    
    const summaries: GameSummary[] = [];
    
    for (let i = 1; i <= 5; i++) {
      const summary = await this.runGame(i);
      summaries.push(summary);
    }
    
    this.generateReport(summaries);
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Parse a command line argument in format --flag=value or -flag value
 */
function parseArg(args: string[], flag: string, shortFlag?: string): string | undefined {
  // Check for --flag=value format
  const longMatch = args.find(a => a.startsWith(`--${flag}=`));
  if (longMatch) {
    const value = longMatch.split('=')[1];
    return value !== undefined && value !== '' ? value : undefined;
  }
  
  // Check for -flag value format
  const shortFlagStr = shortFlag || flag.charAt(0);
  const shortIndex = args.findIndex(a => a === `-${shortFlagStr}` || a === `--${flag}`);
  if (shortIndex >= 0 && shortIndex + 1 < args.length) {
    const nextArg = args[shortIndex + 1];
    if (!nextArg.startsWith('-')) {
      return nextArg;
    }
  }
  
  return undefined;
}

/**
 * Safely parse an integer with a default value
 */
function safeParseInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

async function main() {
  const args = process.argv.slice(2);
  const analysisMode = args.includes('--analysis') || args.includes('-a');
  
  // Parse seed with validation
  const seedArg = parseArg(args, 'seed', 's');
  const seed = safeParseInt(seedArg, 42);
  
  // Parse player count (2-8) with validation
  const playersArg = parseArg(args, 'players', 'p');
  const rawPlayerCount = safeParseInt(playersArg, 2);
  const playerCount = Math.max(2, Math.min(8, rawPlayerCount));
  
  // Parse max turns with validation
  const turnsArg = parseArg(args, 'turns', 't');
  const rawMaxTurns = safeParseInt(turnsArg, 25);
  const maxTurns = Math.max(1, rawMaxTurns);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Commander Game Simulator');
    console.log('');
    console.log('Usage: npx tsx run-commander-games.ts [options]');
    console.log('');
    console.log('Options:');
    console.log('  -p, --players=N   Number of players (2-8, default: 2)');
    console.log('  -t, --turns=N     Maximum number of turns per game (default: 25)');
    console.log('  -a, --analysis    Enable analysis mode with detailed replay and reasoning');
    console.log('  -s, --seed=N      Set the base random seed (default: 42)');
    console.log('  -h, --help        Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  npx tsx run-commander-games.ts');
    console.log('  npx tsx run-commander-games.ts -p 4 -t 30');
    console.log('  npx tsx run-commander-games.ts --players=4 --turns=30');
    console.log('  npx tsx run-commander-games.ts -p 8 --analysis');
    console.log('  npx tsx run-commander-games.ts --players=4 --turns=50 --seed=12345');
    console.log('');
    console.log('Available decks (randomly selected based on player count):');
    const availableDecks = getAvailableDeckFiles();
    for (const deck of availableDecks) {
      console.log(`  - ${deck.replace('.json', '').replace('Deck', '')}`);
    }
    return;
  }
  
  console.log(`Base seed: ${seed}`);
  console.log(`Player count: ${playerCount}`);
  console.log(`Max turns: ${maxTurns}`);
  if (analysisMode) {
    console.log('Analysis mode: ENABLED');
  }
  console.log('');
  
  const simulator = new CommanderGameSimulator(seed, analysisMode, playerCount, maxTurns);
  await simulator.run();
}

main().catch(console.error);
