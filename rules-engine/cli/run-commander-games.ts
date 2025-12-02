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

interface PlayerResult {
  playerName: string;
  position: number;  // 1st, 2nd, 3rd, etc.
  turnEliminated: number | null;  // null if winner
  eliminationReason: string | null;  // null if winner
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
  playerResults: PlayerResult[];  // Player positions and elimination info
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
  chosenCreatureType?: string;  // For cards that choose a creature type on ETB
  tokenType?: string;           // For tokens - their creature type (e.g., 'Merfolk')
}

/** Loaded deck with card data */
interface LoadedDeck {
  name: string;
  commander: CardData;
  cards: CardData[];
}

/** Represents a combo or synergy identified in a deck */
interface DeckCombo {
  name: string;
  cards: string[];  // Card names involved in the combo
  description: string;
  priority: number;  // Higher = more important to assemble
  type: 'infinite' | 'value' | 'wincon' | 'ramp' | 'protection';
}

/** Analysis of a deck's strategy and combos */
interface DeckAnalysis {
  deckName: string;
  primaryType: string;  // Primary creature type for tribal
  combos: DeckCombo[];
  keyCards: string[];   // Cards that should be prioritized
  strategy: 'aggro' | 'combo' | 'control' | 'midrange' | 'tribal';
  manaAccelerators: string[];
  winConditions: string[];
  tokenGenerators: string[];
  lords: string[];  // Cards that buff creature types
}

interface EliminationRecord {
  playerId: number;
  playerName: string;
  turn: number;
  reason: string;
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
  eliminations: EliminationRecord[];  // Track elimination order
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
  private deckAnalyses: Map<string, DeckAnalysis> = new Map();  // Deck name -> analysis
  
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
    
    // Analyze each deck for combos and synergies
    this.analyzeAllDecks();
  }

  /**
   * Analyze all loaded decks to identify combos, synergies, and key cards.
   */
  private analyzeAllDecks(): void {
    console.log('\nAnalyzing deck strategies and combos...');
    
    for (const deck of this.loadedDecks) {
      const analysis = this.analyzeDeck(deck);
      this.deckAnalyses.set(deck.name, analysis);
      
      console.log(`  ${deck.name}:`);
      console.log(`    Strategy: ${analysis.strategy}, Primary Type: ${analysis.primaryType}`);
      console.log(`    Combos found: ${analysis.combos.length}`);
      for (const combo of analysis.combos.slice(0, 3)) {
        console.log(`      - ${combo.name}: ${combo.cards.join(' + ')}`);
      }
    }
  }

  /**
   * Analyze a single deck for combos, synergies, and strategy.
   */
  private analyzeDeck(deck: LoadedDeck): DeckAnalysis {
    const cardNames = deck.cards.map(c => c.name);
    const combos: DeckCombo[] = [];
    const keyCards: string[] = [];
    const manaAccelerators: string[] = [];
    const winConditions: string[] = [];
    const tokenGenerators: string[] = [];
    const lords: string[] = [];
    
    // Determine primary creature type
    const typeCounts = new Map<string, number>();
    const commonTypes = ['merfolk', 'goblin', 'elf', 'zombie', 'soldier', 'wizard', 
                         'human', 'dragon', 'vampire', 'angel', 'demon', 'beast',
                         'elemental', 'spirit', 'horror', 'sliver', 'cat', 'bird'];
    
    for (const card of deck.cards) {
      const typeLine = card.type_line?.toLowerCase() || '';
      const oracle = card.oracle_text?.toLowerCase() || '';
      
      // Count creature types
      for (const type of commonTypes) {
        if (typeLine.includes(type)) {
          typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
        }
      }
      
      // Identify mana accelerators
      if (oracle.includes('add {') || oracle.includes('add one mana') || 
          oracle.includes('add two mana') || oracle.includes('mana of any')) {
        manaAccelerators.push(card.name);
      }
      
      // Identify win conditions
      if (oracle.includes('you win the game') || oracle.includes('loses the game') ||
          oracle.includes('infinite') || card.name.includes('Lab Man')) {
        winConditions.push(card.name);
        keyCards.push(card.name);
      }
      
      // Identify token generators
      if (oracle.includes('create') && oracle.includes('token')) {
        tokenGenerators.push(card.name);
      }
      
      // Identify lords (cards that buff creature types)
      if (oracle.includes('get +') && (oracle.includes('you control') || oracle.includes('other'))) {
        lords.push(card.name);
        keyCards.push(card.name);
      }
    }
    
    // Find primary creature type
    let primaryType = 'creature';
    let maxCount = 0;
    for (const [type, count] of typeCounts) {
      if (count > maxCount) {
        maxCount = count;
        primaryType = type.charAt(0).toUpperCase() + type.slice(1);
      }
    }
    
    // Detect specific combos based on card presence
    this.detectCombos(deck, cardNames, combos, primaryType);
    
    // Determine strategy based on deck composition
    let strategy: DeckAnalysis['strategy'] = 'midrange';
    if (maxCount >= 15) {
      strategy = 'tribal';
    } else if (combos.some(c => c.type === 'infinite')) {
      strategy = 'combo';
    } else if (deck.cards.filter(c => c.type_line?.includes('Creature')).length > 35) {
      strategy = 'aggro';
    } else if (deck.cards.filter(c => 
      c.oracle_text?.toLowerCase().includes('counter') || 
      c.oracle_text?.toLowerCase().includes('destroy')
    ).length > 15) {
      strategy = 'control';
    }
    
    return {
      deckName: deck.name,
      primaryType,
      combos,
      keyCards: [...new Set(keyCards)],
      strategy,
      manaAccelerators,
      winConditions,
      tokenGenerators,
      lords,
    };
  }

  /**
   * Detect specific combos based on cards present in the deck.
   */
  private detectCombos(deck: LoadedDeck, cardNames: string[], combos: DeckCombo[], primaryType: string): void {
    const hasCard = (name: string) => cardNames.some(c => c.toLowerCase().includes(name.toLowerCase()));
    const hasOracle = (text: string) => deck.cards.some(c => c.oracle_text?.toLowerCase().includes(text.toLowerCase()));
    
    // Merfolk combos
    if (primaryType.toLowerCase() === 'merfolk') {
      // Summon the School + Merrow Reejerey + 4 Merfolk = infinite tokens
      if (hasCard('Summon the School') && hasCard('Merrow Reejerey')) {
        combos.push({
          name: 'Summon the School Loop',
          cards: ['Summon the School', 'Merrow Reejerey', '4+ Merfolk'],
          description: 'Cast Summon, untap lands with Reejerey, tap 4 Merfolk to return Summon, repeat',
          priority: 10,
          type: 'infinite'
        });
      }
      
      // Drowner of Secrets + many Merfolk = mill win
      if (hasCard('Drowner of Secrets')) {
        combos.push({
          name: 'Merfolk Mill',
          cards: ['Drowner of Secrets', 'Many Merfolk tokens'],
          description: 'Tap Merfolk to mill opponents out',
          priority: 8,
          type: 'wincon'
        });
      }
      
      // Deeproot Waters + token doublers
      if (hasCard('Deeproot Waters') && (hasCard('Parallel Lives') || hasCard('Anointed Procession') || hasCard('Adrix and Nev'))) {
        combos.push({
          name: 'Merfolk Token Flood',
          cards: ['Deeproot Waters', 'Token Doubler', 'Merfolk spells'],
          description: 'Each Merfolk spell creates multiple tokens',
          priority: 7,
          type: 'value'
        });
      }
    }
    
    // Morophon + Jodah/Fist of Suns = free creatures
    if (hasCard('Morophon') && (hasCard('Jodah') || hasCard('Fist of Suns'))) {
      combos.push({
        name: 'Free Tribal Creatures',
        cards: ['Morophon, the Boundless', 'Jodah/Fist of Suns'],
        description: `Cast ${primaryType} creatures for free`,
        priority: 10,
        type: 'value'
      });
    }
    
    // Kindred Discovery + creature spam = massive draw
    if (hasCard('Kindred Discovery')) {
      combos.push({
        name: 'Kindred Discovery Engine',
        cards: ['Kindred Discovery', `${primaryType} creatures`],
        description: `Draw cards whenever ${primaryType} enter or attack`,
        priority: 8,
        type: 'value'
      });
    }
    
    // Token doublers + token generators
    const tokenDoublers = ['Parallel Lives', 'Anointed Procession', 'Doubling Season', 'Adrix and Nev'];
    const foundDoublers = tokenDoublers.filter(d => hasCard(d));
    if (foundDoublers.length > 0 && hasOracle('create') && hasOracle('token')) {
      combos.push({
        name: 'Token Multiplication',
        cards: [...foundDoublers, 'Token generators'],
        description: 'Double or quadruple token production',
        priority: 7,
        type: 'value'
      });
    }
    
    // Ashnod's Altar + token generation = infinite mana potential
    if (hasCard("Ashnod's Altar") && hasOracle('create') && hasOracle('token')) {
      combos.push({
        name: "Ashnod's Altar Engine",
        cards: ["Ashnod's Altar", 'Token generators'],
        description: 'Sacrifice tokens for mana, potentially infinite with recursion',
        priority: 9,
        type: 'infinite'
      });
    }
    
    // Roaming Throne doubles tribal triggers
    if (hasCard('Roaming Throne')) {
      combos.push({
        name: 'Doubled Tribal Triggers',
        cards: ['Roaming Throne', `${primaryType} creatures with triggers`],
        description: `All ${primaryType} triggered abilities trigger twice`,
        priority: 8,
        type: 'value'
      });
    }
    
    // Reflections of Littjara copies spells
    if (hasCard('Reflections of Littjara')) {
      combos.push({
        name: 'Spell Copying',
        cards: ['Reflections of Littjara', `${primaryType} creature spells`],
        description: `Copy every ${primaryType} creature spell`,
        priority: 8,
        type: 'value'
      });
    }
    
    // Sort combos by priority
    combos.sort((a, b) => b.priority - a.priority);
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
    const typeLine = card?.type_line?.toLowerCase() || '';
    // Also check for Changeling (is every creature type)
    if (typeLine.includes('changeling') || card?.oracle_text?.toLowerCase().includes('changeling')) {
      return true;
    }
    return typeLine.includes(type.toLowerCase());
  }

  /**
   * Determine the primary creature type for a deck based on the most common type.
   * Used for cards that "choose a creature type" - the AI picks the optimal type.
   */
  getDeckPrimaryCreatureType(player: PlayerState): string {
    const typeCounts = new Map<string, number>();
    const commonTypes = ['merfolk', 'goblin', 'elf', 'zombie', 'soldier', 'wizard', 
                         'human', 'dragon', 'vampire', 'angel', 'demon', 'beast',
                         'elemental', 'spirit', 'horror', 'sliver', 'cat', 'bird'];
    
    // Count creature types in library, hand, and battlefield
    const allCards = [...player.library, ...player.hand, ...player.battlefield.map(p => p.card)];
    
    for (const cardName of allCards) {
      const card = this.getCard(cardName);
      const typeLine = card?.type_line?.toLowerCase() || '';
      
      for (const type of commonTypes) {
        if (typeLine.includes(type)) {
          typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
        }
      }
    }
    
    // Find the most common type
    let maxCount = 0;
    let primaryType = 'creature'; // Default fallback
    for (const [type, count] of typeCounts) {
      if (count > maxCount) {
        maxCount = count;
        primaryType = type;
      }
    }
    
    // Capitalize first letter
    return primaryType.charAt(0).toUpperCase() + primaryType.slice(1);
  }

  /**
   * Get creature types from a card's type line.
   * Returns an array of creature subtypes (e.g., ['Merfolk', 'Wizard'])
   */
  getCreatureTypes(cardName: string): string[] {
    const card = this.getCard(cardName);
    const typeLine = card?.type_line || '';
    const oracle = card?.oracle_text?.toLowerCase() || '';
    
    // Check for Changeling (is every creature type)
    if (typeLine.toLowerCase().includes('changeling') || oracle.includes('changeling')) {
      return ['Changeling']; // Special marker that matches all types
    }
    
    // Extract subtypes after the dash
    const dashIndex = typeLine.indexOf('—');
    if (dashIndex === -1) return [];
    
    const subtypes = typeLine.substring(dashIndex + 1).trim();
    return subtypes.split(/\s+/).filter(t => t.length > 0);
  }

  /**
   * Check if a card matches a chosen creature type.
   * Handles Changeling which matches all types.
   */
  matchesCreatureType(cardName: string, chosenType: string): boolean {
    const types = this.getCreatureTypes(cardName);
    if (types.includes('Changeling')) return true;
    return types.some(t => t.toLowerCase() === chosenType.toLowerCase());
  }

  /**
   * Calculate effective mana cost considering cost reductions.
   * Checks for Morophon, Urza's Incubator, and similar effects.
   */
  getEffectiveCost(cardName: string, player: PlayerState): number {
    const baseCost = this.getCMC(cardName);
    const card = this.getCard(cardName);
    const typeLine = card?.type_line?.toLowerCase() || '';
    
    // Only creatures can benefit from tribal cost reductions
    if (!typeLine.includes('creature')) return baseCost;
    
    let reduction = 0;
    const cardTypes = this.getCreatureTypes(cardName);
    const isChangeling = cardTypes.includes('Changeling');
    
    for (const perm of player.battlefield) {
      const permCard = this.getCard(perm.card);
      const permOracle = permCard?.oracle_text?.toLowerCase() || '';
      const chosenType = perm.chosenCreatureType?.toLowerCase();
      
      // Morophon, the Boundless: "Spells of the chosen type you cast cost {W}{U}{B}{R}{G} less to cast"
      // This reduces colored mana by 5 (one of each color)
      if (perm.card.includes('Morophon') && chosenType) {
        if (isChangeling || cardTypes.some(t => t.toLowerCase() === chosenType)) {
          // WUBRG reduction - effectively reduces cost by 5 colored mana
          reduction += 5;
        }
      }
      
      // Urza's Incubator: "Creature spells of the chosen type cost {2} less to cast"
      if (permOracle.includes('creature spells of the chosen type cost') && 
          permOracle.includes('less to cast') && chosenType) {
        if (isChangeling || cardTypes.some(t => t.toLowerCase() === chosenType)) {
          reduction += 2;
        }
      }
      
      // Herald's Horn: "Creature spells of the chosen type cost {1} less to cast"
      if (permOracle.includes('creature spells') && 
          permOracle.includes('cost {1} less') && chosenType) {
        if (isChangeling || cardTypes.some(t => t.toLowerCase() === chosenType)) {
          reduction += 1;
        }
      }
    }
    
    // Check for Jodah + Morophon combo (or Fist of Suns)
    // Jodah: "You may pay WUBRG rather than pay the mana cost for spells you cast"
    // With Morophon reducing WUBRG, the creature is free!
    const hasJodahEffect = player.battlefield.some(p => {
      const o = this.getCard(p.card)?.oracle_text?.toLowerCase() || '';
      return o.includes('pay {w}{u}{b}{r}{g}') && o.includes('rather than pay');
    });
    
    const hasFistOfSuns = player.battlefield.some(p => 
      p.card.toLowerCase().includes('fist of suns')
    );
    
    const hasMorophon = player.battlefield.some(p => 
      p.card.includes('Morophon') && 
      p.chosenCreatureType && 
      (isChangeling || cardTypes.some(t => t.toLowerCase() === p.chosenCreatureType?.toLowerCase()))
    );
    
    // Jodah/Fist + Morophon = free creature spells of chosen type
    if ((hasJodahEffect || hasFistOfSuns) && hasMorophon) {
      return 0;
    }
    
    return Math.max(0, baseCost - reduction);
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
    // Use effective cost which considers tribal cost reductions (Morophon, Urza's Incubator, etc.)
    const baseCost = this.getCMC(cardName);
    const effectiveCost = this.getEffectiveCost(cardName, player);
    
    if (!this.canPayMana(player, effectiveCost)) return false;
    
    const handIndex = player.hand.indexOf(cardName);
    if (handIndex === -1) return false;
    
    // Get mana pool state before paying
    const manaPoolBefore = this.formatManaPool(player.manaPool);
    const manaSpentDesc = this.payMana(player, effectiveCost);
    player.hand.splice(handIndex, 1);
    
    // Log cost reduction if applicable
    const costReduction = baseCost - effectiveCost;
    const costReductionStr = costReduction > 0 ? ` (reduced from ${baseCost} by ${costReduction})` : '';
    
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
      const oracle = card?.oracle_text?.toLowerCase() || '';
      
      // Check if this card needs to choose a creature type
      let chosenCreatureType: string | undefined;
      if (oracle.includes('choose a creature type') || oracle.includes('as this') && oracle.includes('enters')) {
        if (oracle.includes('choose a creature type')) {
          chosenCreatureType = this.getDeckPrimaryCreatureType(player);
        }
      }
      
      const newPermanent: PermanentState = {
        card: cardName,
        tapped: false,
        summoningSickness: typeLine.includes('creature'),
        power,
        toughness,
        counters: {},
      };
      
      if (chosenCreatureType) {
        newPermanent.chosenCreatureType = chosenCreatureType;
      }
      
      player.battlefield.push(newPermanent);
      
      // Track cards played per player
      const playerKey = player.name;
      const existing = state.cardsPlayed.get(playerKey) || [];
      existing.push(cardName);
      state.cardsPlayed.set(playerKey, existing);
      
      // Log detailed cast event for permanents
      if (this.analysisMode) {
        const chosenTypeStr = chosenCreatureType ? `, Chose type: ${chosenCreatureType}` : '';
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'cast',
          card: cardName,
          fromZone: 'hand',
          toZone: 'stack → battlefield',
          manaSpent: effectiveCost,
          details: `Cast ${cardName} ${manaCostStr} (${typeLine})${power || toughness ? `, P/T: ${power}/${toughness}` : ''}${chosenTypeStr}${costReductionStr}`,
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
          manaSpent: effectiveCost,
          details: `Cast ${cardName} ${manaCostStr} (${typeLine})${costReductionStr}`,
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
    const cardCreatureTypes = this.getCreatureTypes(cardName);
    
    for (const perm of player.battlefield) {
      const permCard = this.getCard(perm.card);
      const permOracle = permCard?.oracle_text?.toLowerCase() || '';
      
      // Kindred Discovery-like effect: draw when creature of chosen type enters
      // "As this enchantment enters, choose a creature type. Whenever a creature you control of the chosen type enters or attacks, draw a card."
      if (permOracle.includes('choose a creature type') && 
          permOracle.includes('whenever') && 
          permOracle.includes('enters') && 
          permOracle.includes('draw')) {
        const chosenType = perm.chosenCreatureType?.toLowerCase();
        // Check if the entering creature matches the chosen type
        if (typeLine.includes('creature') && 
            (cardCreatureTypes.some(t => t.toLowerCase() === chosenType) || 
             typeLine.includes('changeling') || 
             oracle.includes('changeling'))) {
          this.drawCards(player, 1, state, perm.card);
          state.events.push({
            turn: state.turn,
            player: player.name,
            action: 'trigger',
            card: perm.card,
            details: `Drew card: ${perm.chosenCreatureType} creature entered (${cardName})`
          });
        }
      }
      
      // Merfolk-specific: Deeproot Waters - "Whenever you cast a Merfolk spell, create a 1/1 blue Merfolk creature token with hexproof"
      if (permOracle.includes('whenever you cast a merfolk') && permOracle.includes('create') && permOracle.includes('merfolk')) {
        if (typeLine.includes('merfolk') || typeLine.includes('changeling') || oracle.includes('changeling')) {
          player.battlefield.push({
            card: 'Merfolk Token',
            tapped: false,
            summoningSickness: true,
            power: 1,
            toughness: 1,
            counters: {},
            isToken: true,
            tokenType: 'Merfolk',
          });
          state.events.push({
            turn: state.turn,
            player: player.name,
            action: 'trigger',
            card: perm.card,
            details: `Created 1/1 Merfolk token (cast ${cardName})`
          });
        }
      }
      // Generic token creation for other tribal effects - check for chosen type
      else if (permOracle.includes('choose a creature type') && 
               permOracle.includes('whenever you cast') && 
               permOracle.includes('create') && 
               permOracle.includes('token')) {
        const chosenType = perm.chosenCreatureType?.toLowerCase();
        if (typeLine.includes('creature') && 
            (cardCreatureTypes.some(t => t.toLowerCase() === chosenType) ||
             typeLine.includes('changeling') || 
             oracle.includes('changeling'))) {
          player.battlefield.push({
            card: `${perm.chosenCreatureType} Token`,
            tapped: false,
            summoningSickness: true,
            power: 1,
            toughness: 1,
            counters: {},
            isToken: true,
            tokenType: perm.chosenCreatureType,
          });
          state.events.push({
            turn: state.turn,
            player: player.name,
            action: 'trigger',
            card: perm.card,
            details: `Created ${perm.chosenCreatureType} token from cast trigger`
          });
        }
      }
      // Reflections of Littjara - copy creature spells of the chosen type
      else if (permOracle.includes('choose a creature type') && 
               permOracle.includes('whenever you cast a spell of the chosen type') && 
               permOracle.includes('copy')) {
        const chosenType = perm.chosenCreatureType?.toLowerCase();
        if (typeLine.includes('creature') && 
            (cardCreatureTypes.some(t => t.toLowerCase() === chosenType) ||
             typeLine.includes('changeling') || 
             oracle.includes('changeling'))) {
          // Create a token copy of the creature
          const power = parseInt(card?.power || '0', 10);
          const toughness = parseInt(card?.toughness || '0', 10);
          player.battlefield.push({
            card: `${cardName} (Copy)`,
            tapped: false,
            summoningSickness: true,
            power,
            toughness,
            counters: {},
            isToken: true,
            tokenType: perm.chosenCreatureType,
          });
          state.events.push({
            turn: state.turn,
            player: player.name,
            action: 'trigger',
            card: perm.card,
            details: `Copied ${cardName} (${perm.chosenCreatureType} spell)`
          });
        }
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
      
      // Skip already eliminated players
      if (player.life === -999) continue;
      
      // Check for player elimination
      if (player.life <= 0) {
        const reason = `Life total reduced to ${player.life}`;
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'eliminated',
          details: reason
        });
        // Track elimination order
        state.eliminations.push({
          playerId,
          playerName: player.name,
          turn: state.turn,
          reason
        });
        // Mark as eliminated by setting life to a very negative number
        player.life = -999;
        changed = true;
        continue;
      }
      
      if (player.poisonCounters >= 10) {
        const reason = `Received ${player.poisonCounters} poison counters`;
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'eliminated',
          details: reason
        });
        // Track elimination order
        state.eliminations.push({
          playerId,
          playerName: player.name,
          turn: state.turn,
          reason
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
    const attackerDetails: string[] = [];
    
    for (const creature of affordableAttackers) {
      creature.tapped = true;
      if (hasGhostlyPrison) {
        this.payMana(attacker, 2);
      }
      const creaturePower = creature.power || 0;
      totalDamage += creaturePower;
      
      // Build attacker description with power/toughness
      attackerDetails.push(`${creature.card} (${creaturePower}/${creature.toughness || 0})`);
      
      const card = this.getCard(creature.card);
      if (card?.oracle_text?.toLowerCase().includes('infect')) {
        infect = true;
      }
    }
    
    // Format attackers list for event details
    const attackersStr = attackerDetails.length <= 3 
      ? attackerDetails.join(', ')
      : `${attackerDetails.slice(0, 3).join(', ')} and ${attackerDetails.length - 3} more`;
    
    if (infect) {
      defender.poisonCounters += totalDamage;
      state.events.push({
        turn: state.turn,
        player: attacker.name,
        action: 'combat',
        card: attackerDetails.length === 1 ? affordableAttackers[0].card : undefined,
        details: `Attacked ${defender.name} with ${attackerDetails.length} creature(s): ${attackersStr}. Dealt ${totalDamage} infect damage (${defender.poisonCounters}/10 poison)`
      });
    } else {
      defender.life -= totalDamage;
      state.events.push({
        turn: state.turn,
        player: attacker.name,
        action: 'combat',
        card: attackerDetails.length === 1 ? affordableAttackers[0].card : undefined,
        details: `Attacked ${defender.name} with ${attackerDetails.length} creature(s): ${attackersStr}. Dealt ${totalDamage} damage (${defender.name} at ${defender.life} life)`
      });
    }
  }

  simulateMainPhase(player: PlayerState, state: SimulatedGameState): void {
    // Get deck analysis for this player
    const deckName = player.name.match(/\(([^)]+)\)/)?.[1] || '';
    const analysis = this.deckAnalyses.get(deckName);
    
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
    
    // Cast spells prioritizing by importance, using deck analysis
    const castable = player.hand
      .filter(c => !this.isLand(c))
      .filter(c => this.canPayMana(player, this.getEffectiveCost(c, player)))
      .sort((a, b) => this.compareSpellPriority(a, b, player, analysis));
    
    let spellsCast = 0;
    for (const spell of castable) {
      if (spellsCast >= 3) break;
      
      // Determine reasoning for casting this spell using deck analysis
      const reasoning = this.getSpellReasoning(spell, player, analysis);
      
      // Pass the list of tapped lands to castSpell for tracking
      if (this.castSpell(player, spell, state, tappedLands)) {
        spellsCast++;
        
        const cardData = this.getCard(spell);
        const typeLine = cardData?.type_line || '';
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
   * Compare two spells for casting priority based on deck analysis.
   */
  private compareSpellPriority(a: string, b: string, player: PlayerState, analysis?: DeckAnalysis): number {
    const aCard = this.getCard(a);
    const bCard = this.getCard(b);
    const aOracle = aCard?.oracle_text?.toLowerCase() || '';
    const bOracle = bCard?.oracle_text?.toLowerCase() || '';
    
    // Win conditions always first
    if (aOracle.includes('you win the game')) return -1;
    if (bOracle.includes('you win the game')) return 1;
    
    if (analysis) {
      // Check if cards are part of combos
      const aInCombo = analysis.combos.some(c => c.cards.some(cc => a.toLowerCase().includes(cc.toLowerCase()) || cc.toLowerCase().includes(a.toLowerCase())));
      const bInCombo = analysis.combos.some(c => c.cards.some(cc => b.toLowerCase().includes(cc.toLowerCase()) || cc.toLowerCase().includes(b.toLowerCase())));
      
      // Check if cards are key cards
      const aIsKey = analysis.keyCards.includes(a);
      const bIsKey = analysis.keyCards.includes(b);
      
      // Prioritize combo pieces and key cards
      if (aInCombo && !bInCombo) return -1;
      if (bInCombo && !aInCombo) return 1;
      if (aIsKey && !bIsKey) return -1;
      if (bIsKey && !aIsKey) return 1;
      
      // For tribal decks, prioritize lords early
      if (analysis.strategy === 'tribal') {
        const aIsLord = analysis.lords.includes(a);
        const bIsLord = analysis.lords.includes(b);
        if (aIsLord && !bIsLord) return -1;
        if (bIsLord && !aIsLord) return 1;
        
        // Prioritize creatures of the primary type
        const aMatchesType = this.matchesCreatureType(a, analysis.primaryType);
        const bMatchesType = this.matchesCreatureType(b, analysis.primaryType);
        if (aMatchesType && !bMatchesType) return -1;
        if (bMatchesType && !aMatchesType) return 1;
      }
      
      // Prioritize mana accelerators early game
      const totalMana = this.countLandsOnBattlefield(player);
      if (totalMana < 5) {
        const aIsMana = analysis.manaAccelerators.includes(a);
        const bIsMana = analysis.manaAccelerators.includes(b);
        if (aIsMana && !bIsMana) return -1;
        if (bIsMana && !aIsMana) return 1;
      }
      
      // Prioritize token generators if we have doublers
      const hasDoublers = player.battlefield.some(p => {
        const o = this.getCard(p.card)?.oracle_text?.toLowerCase() || '';
        return o.includes('twice that many') || o.includes('double');
      });
      if (hasDoublers) {
        const aIsTokenGen = analysis.tokenGenerators.includes(a);
        const bIsTokenGen = analysis.tokenGenerators.includes(b);
        if (aIsTokenGen && !bIsTokenGen) return -1;
        if (bIsTokenGen && !aIsTokenGen) return 1;
      }
    }
    
    // Mana rocks/acceleration next
    if (aOracle.includes('add {c}{c}') || aOracle.includes('add two mana')) return -1;
    if (bOracle.includes('add {c}{c}') || bOracle.includes('add two mana')) return 1;
    
    // Then by effective cost (cheaper first, considering reductions)
    return this.getEffectiveCost(a, player) - this.getEffectiveCost(b, player);
  }

  /**
   * Get reasoning for why we're casting a spell based on deck analysis.
   */
  private getSpellReasoning(spell: string, player: PlayerState, analysis?: DeckAnalysis): string {
    const cardData = this.getCard(spell);
    const typeLine = cardData?.type_line || '';
    const oracle = cardData?.oracle_text?.toLowerCase() || '';
    
    if (analysis) {
      // Check if part of a combo
      for (const combo of analysis.combos) {
        if (combo.cards.some(c => spell.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(spell.toLowerCase()))) {
          return `Combo piece for "${combo.name}": ${combo.description}`;
        }
      }
      
      // Check if it's a key card
      if (analysis.keyCards.includes(spell)) {
        return `Key card for ${analysis.strategy} strategy`;
      }
      
      // Check if it's a lord
      if (analysis.lords.includes(spell)) {
        return `Lord - buffs ${analysis.primaryType} creatures`;
      }
      
      // Check if it matches tribal type
      if (this.matchesCreatureType(spell, analysis.primaryType)) {
        const effectiveCost = this.getEffectiveCost(spell, player);
        const baseCost = this.getCMC(spell);
        if (effectiveCost < baseCost) {
          return `${analysis.primaryType} creature with cost reduction (${baseCost} → ${effectiveCost})`;
        }
        return `${analysis.primaryType} creature for tribal synergy`;
      }
    }
    
    // Fallback to basic reasoning
    if (oracle.includes('add {c}{c}') || oracle.includes('add two mana')) {
      return 'Mana acceleration - provides additional mana for future turns';
    } else if (oracle.includes('you win the game')) {
      return 'Win condition card';
    } else if (typeLine.includes('Creature')) {
      return `Creature for board presence (${cardData?.power}/${cardData?.toughness})`;
    } else if (typeLine.includes('Enchantment')) {
      return 'Enchantment for ongoing value';
    } else if (typeLine.includes('Artifact')) {
      return 'Artifact for utility';
    }
    
    const ORACLE_TEXT_PREVIEW_LENGTH = 50;
    return `Cast for its effect: ${oracle.substring(0, ORACLE_TEXT_PREVIEW_LENGTH) || 'unknown'}...`;
  }

  /**
   * Count lands on the battlefield for a player.
   */
  private countLandsOnBattlefield(player: PlayerState): number {
    return player.battlefield.filter(p => this.isLand(p.card)).length;
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
      eliminations: [],
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
    
    // Build player results with positions and elimination info
    const playerResults = this.buildPlayerResults(state, winnerName);
    
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
      playerResults,
    };
  }

  /**
   * Build player results with positions and elimination information.
   * Position 1 is the winner, subsequent positions are based on elimination order (last eliminated = 2nd, etc.)
   */
  private buildPlayerResults(state: SimulatedGameState, winnerName: string): PlayerResult[] {
    const results: PlayerResult[] = [];
    
    // Winner gets position 1
    if (state.winner && state.winner > 0 && state.players[state.winner]) {
      results.push({
        playerName: state.players[state.winner].name,
        position: 1,
        turnEliminated: null,
        eliminationReason: null,
      });
    }
    
    // Eliminated players get positions based on reverse elimination order
    // (last eliminated = 2nd place, first eliminated = last place)
    const eliminatedPlayers = [...state.eliminations].reverse();
    let position = 2;
    for (const elim of eliminatedPlayers) {
      results.push({
        playerName: elim.playerName,
        position,
        turnEliminated: elim.turn,
        eliminationReason: elim.reason,
      });
      position++;
    }
    
    // Handle players who weren't eliminated but also didn't win (e.g., game timeout)
    for (let playerId = 1; playerId <= state.playerCount; playerId++) {
      const player = state.players[playerId];
      if (!player) continue;
      
      const alreadyIncluded = results.some(r => r.playerName === player.name);
      if (!alreadyIncluded) {
        results.push({
          playerName: player.name,
          position,
          turnEliminated: null,
          eliminationReason: 'Game ended without elimination',
        });
        position++;
      }
    }
    
    // Sort by position
    results.sort((a, b) => a.position - b.position);
    
    return results;
  }

  /**
   * Get ordinal string for a position (1st, 2nd, 3rd, etc.)
   */
  private getOrdinal(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
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
      
      // Print player positions and elimination info
      if (summary.playerResults && summary.playerResults.length > 0) {
        console.log('    Player Results:');
        for (const result of summary.playerResults) {
          const positionStr = this.getOrdinal(result.position);
          if (result.turnEliminated !== null) {
            console.log(`      ${positionStr}: ${result.playerName} - Eliminated turn ${result.turnEliminated} (${result.eliminationReason})`);
          } else if (result.position === 1) {
            console.log(`      ${positionStr}: ${result.playerName} - WINNER`);
          } else {
            console.log(`      ${positionStr}: ${result.playerName} - ${result.eliminationReason || 'Survived'}`);
          }
        }
      }
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
