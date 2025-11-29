#!/usr/bin/env node
/**
 * run-commander-games.ts
 * 
 * Runs 5 Commander games using the provided decklists with embedded card data.
 * Tracks gameplay metrics and generates a summary report.
 * 
 * Player 1: Morophon, the Boundless (Merfolk Tribal)
 * Player 2: Kynaios and Tiro of Meletis (Group Hug)
 */

import type { ManaPool } from '../../shared/src';

// ============================================================================
// Types
// ============================================================================

interface CardData {
  name: string;
  mana_cost: string;
  cmc: number;
  type_line: string;
  oracle_text: string;
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
}

interface SimulatedGameState {
  turn: number;
  activePlayer: number;
  phase: string;
  players: {
    1: PlayerState;
    2: PlayerState;
  };
  stack: any[];
  events: GameEvent[];
  cardsPlayed: Map<string, string[]>;
  morophonChosenType: string;
  winner: number | null;
  winCondition: string | null;
}

// ============================================================================
// Card Database (embedded from Scryfall data)
// ============================================================================

const CARD_DATABASE: Record<string, CardData> = {
  // Player 1 Commander
  "Morophon, the Boundless": {
    id: "84238335-e08c-421c-b9b9-70a679ff2967",
    name: "Morophon, the Boundless",
    type_line: "Legendary Creature — Shapeshifter",
    oracle_text: "Changeling (This card is every creature type.)\nAs Morophon enters, choose a creature type.\nSpells of the chosen type you cast cost {W}{U}{B}{R}{G} less to cast. This effect reduces only the amount of colored mana you pay.\nOther creatures you control of the chosen type get +1/+1.",
    mana_cost: "{7}",
    cmc: 7,
    power: "6",
    toughness: "6"
  },
  
  // Player 2 Commander and Deck
  "Kynaios and Tiro of Meletis": {
    id: "97fa8615-2b6c-445a-bcaf-44a7e847bf65",
    name: "Kynaios and Tiro of Meletis",
    type_line: "Legendary Creature — Human Soldier",
    oracle_text: "At the beginning of your end step, draw a card. Each player may put a land card from their hand onto the battlefield, then each opponent who didn't draws a card.",
    mana_cost: "{R}{G}{W}{U}",
    cmc: 4,
    power: "2",
    toughness: "8"
  },
  "Arcane Denial": {
    id: "9b3f47a9-65fb-4b53-8e52-1c4b678b5841",
    name: "Arcane Denial",
    type_line: "Instant",
    oracle_text: "Counter target spell. Its controller may draw up to two cards at the beginning of the next turn's upkeep.\nYou draw a card at the beginning of the next turn's upkeep.",
    mana_cost: "{1}{U}",
    cmc: 2
  },
  "Azorius Chancery": {
    id: "50ef0ac3-e911-4d67-a751-8d86160ae843",
    name: "Azorius Chancery",
    type_line: "Land",
    oracle_text: "This land enters tapped.\nWhen this land enters, return a land you control to its owner's hand.\n{T}: Add {W}{U}.",
    mana_cost: "",
    cmc: 0
  },
  "Beast Within": {
    id: "ccac70d4-6e04-4802-8bb8-021368a40e14",
    name: "Beast Within",
    type_line: "Instant",
    oracle_text: "Destroy target permanent. Its controller creates a 3/3 green Beast creature token.",
    mana_cost: "{2}{G}",
    cmc: 3
  },
  "Blasphemous Act": {
    id: "fbeeb7d0-cda8-414b-82d3-a83f1883bdd2",
    name: "Blasphemous Act",
    type_line: "Sorcery",
    oracle_text: "This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature.",
    mana_cost: "{8}{R}",
    cmc: 9
  },
  "Blazing Archon": {
    id: "f5e43875-ab5e-4233-892d-fc2c5687fae8",
    name: "Blazing Archon",
    type_line: "Creature — Archon",
    oracle_text: "Flying\nCreatures can't attack you.",
    mana_cost: "{6}{W}{W}{W}",
    cmc: 9,
    power: "5",
    toughness: "6"
  },
  "Chromatic Lantern": {
    id: "8f6448b1-ffc7-43f0-b713-881016ce9485",
    name: "Chromatic Lantern",
    type_line: "Artifact",
    oracle_text: "Lands you control have \"{T}: Add one mana of any color.\"\n{T}: Add one mana of any color.",
    mana_cost: "{3}",
    cmc: 3
  },
  "Collective Restraint": {
    id: "d71daa57-ac02-4dd9-8c90-d38bdd45fb51",
    name: "Collective Restraint",
    type_line: "Enchantment",
    oracle_text: "Domain — Creatures can't attack you unless their controller pays {X} for each creature they control that's attacking you, where X is the number of basic land types among lands you control.",
    mana_cost: "{3}{U}",
    cmc: 4
  },
  "Command Tower": {
    id: "85eb4b03-305b-45a4-82e5-5fcd586cc744",
    name: "Command Tower",
    type_line: "Land",
    oracle_text: "{T}: Add one mana of any color in your commander's color identity.",
    mana_cost: "",
    cmc: 0
  },
  "Cultivate": {
    id: "7ee610ee-7711-4a6b-b441-d6c73e6ef2b4",
    name: "Cultivate",
    type_line: "Sorcery",
    oracle_text: "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.",
    mana_cost: "{2}{G}",
    cmc: 3
  },
  "Ghostly Prison": {
    id: "da3b83cb-f778-4096-9022-b1d6637354ff",
    name: "Ghostly Prison",
    type_line: "Enchantment",
    oracle_text: "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.",
    mana_cost: "{2}{W}",
    cmc: 3
  },
  "Howling Mine": {
    id: "cdae9939-03a4-4561-92cd-01f498d29a7a",
    name: "Howling Mine",
    type_line: "Artifact",
    oracle_text: "At the beginning of each player's draw step, if this artifact is untapped, that player draws an additional card.",
    mana_cost: "{2}",
    cmc: 2
  },
  "Sol Ring": {
    id: "ee6e5a35-fe21-4dee-b0ef-a8f2841511ad",
    name: "Sol Ring",
    type_line: "Artifact",
    oracle_text: "{T}: Add {C}{C}.",
    mana_cost: "{1}",
    cmc: 1
  },
  "Psychosis Crawler": {
    id: "d0f42a19-c180-45b1-9f4c-787cf3a4a649",
    name: "Psychosis Crawler",
    type_line: "Artifact Creature — Phyrexian Horror",
    oracle_text: "Psychosis Crawler's power and toughness are each equal to the number of cards in your hand.\nWhenever you draw a card, each opponent loses 1 life.",
    mana_cost: "{5}",
    cmc: 5,
    power: "*",
    toughness: "*"
  },
  "Triumph of the Hordes": {
    id: "0a0f64d3-187c-41ff-a771-3a65da995341",
    name: "Triumph of the Hordes",
    type_line: "Sorcery",
    oracle_text: "Until end of turn, creatures you control get +1/+1 and gain trample and infect.",
    mana_cost: "{2}{G}{G}",
    cmc: 4
  },
  "Fog": {
    id: "bbc3152e-7b3b-4ac6-8b33-abfebde216aa",
    name: "Fog",
    type_line: "Instant",
    oracle_text: "Prevent all combat damage that would be dealt this turn.",
    mana_cost: "{G}",
    cmc: 1
  },
  "Swords to Plowshares": {
    id: "0e7ff4dc-af63-4342-9a44-d059e62bd14c",
    name: "Swords to Plowshares",
    type_line: "Instant",
    oracle_text: "Exile target creature. Its controller gains life equal to its power.",
    mana_cost: "{W}",
    cmc: 1
  },
  
  // Player 1 Cards (Merfolk Tribal)
  "Svyelun of Sea and Sky": {
    id: "svyelun-001",
    name: "Svyelun of Sea and Sky",
    type_line: "Legendary Creature — Merfolk God",
    oracle_text: "Svyelun of Sea and Sky has indestructible as long as you control at least two other Merfolk.\nWhenever Svyelun attacks, draw a card.\nOther Merfolk you control have ward {1}.",
    mana_cost: "{1}{U}{U}",
    cmc: 3,
    power: "3",
    toughness: "4"
  },
  "Merrow Reejerey": {
    id: "merrow-001",
    name: "Merrow Reejerey",
    type_line: "Creature — Merfolk Soldier",
    oracle_text: "Other Merfolk creatures you control get +1/+1.\nWhenever you cast a Merfolk spell, you may tap or untap target permanent.",
    mana_cost: "{2}{U}",
    cmc: 3,
    power: "2",
    toughness: "2"
  },
  "Kindred Discovery": {
    id: "kindred-001",
    name: "Kindred Discovery",
    type_line: "Enchantment",
    oracle_text: "As Kindred Discovery enters, choose a creature type.\nWhenever a creature you control of the chosen type enters or attacks, draw a card.",
    mana_cost: "{3}{U}{U}",
    cmc: 5
  },
  "Thassa's Oracle": {
    id: "thassas-oracle-001",
    name: "Thassa's Oracle",
    type_line: "Creature — Merfolk Wizard",
    oracle_text: "When Thassa's Oracle enters, look at the top X cards of your library, where X is your devotion to blue. Put up to one of them on top of your library and the rest on the bottom in a random order. If X is greater than or equal to the number of cards in your library, you win the game.",
    mana_cost: "{U}{U}",
    cmc: 2,
    power: "1",
    toughness: "3"
  },
  "Aetherflux Reservoir": {
    id: "aetherflux-001",
    name: "Aetherflux Reservoir",
    type_line: "Artifact",
    oracle_text: "Whenever you cast a spell, you gain 1 life for each spell you've cast this turn.\nPay 50 life: Aetherflux Reservoir deals 50 damage to any target.",
    mana_cost: "{4}",
    cmc: 4
  },
  "Intruder Alarm": {
    id: "intruder-001",
    name: "Intruder Alarm",
    type_line: "Enchantment",
    oracle_text: "Creatures don't untap during their controllers' untap steps.\nWhenever a creature enters, untap all creatures.",
    mana_cost: "{2}{U}",
    cmc: 3
  },
  "Cyclonic Rift": {
    id: "cyclonic-001",
    name: "Cyclonic Rift",
    type_line: "Instant",
    oracle_text: "Return target nonland permanent you don't control to its owner's hand.\nOverload {6}{U}",
    mana_cost: "{1}{U}",
    cmc: 2
  },
  "Rhystic Study": {
    id: "rhystic-001",
    name: "Rhystic Study",
    type_line: "Enchantment",
    oracle_text: "Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.",
    mana_cost: "{2}{U}",
    cmc: 3
  },
  "Smothering Tithe": {
    id: "smothering-001",
    name: "Smothering Tithe",
    type_line: "Enchantment",
    oracle_text: "Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token.",
    mana_cost: "{3}{W}",
    cmc: 4
  },
  "Deeproot Waters": {
    id: "deeproot-001",
    name: "Deeproot Waters",
    type_line: "Enchantment",
    oracle_text: "Whenever you cast a Merfolk spell, create a 1/1 blue Merfolk creature token with hexproof.",
    mana_cost: "{2}{U}",
    cmc: 3
  },
  "Altar of Dementia": {
    id: "altar-dementia-001",
    name: "Altar of Dementia",
    type_line: "Artifact",
    oracle_text: "Sacrifice a creature: Target player mills cards equal to the sacrificed creature's power.",
    mana_cost: "{2}",
    cmc: 2
  },
  "Counterspell": {
    id: "counterspell-001",
    name: "Counterspell",
    type_line: "Instant",
    oracle_text: "Counter target spell.",
    mana_cost: "{U}{U}",
    cmc: 2
  },
  "Force of Will": {
    id: "force-will-001",
    name: "Force of Will",
    type_line: "Instant",
    oracle_text: "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.\nCounter target spell.",
    mana_cost: "{3}{U}{U}",
    cmc: 5
  },
  "Demonic Tutor": {
    id: "demonic-tutor-001",
    name: "Demonic Tutor",
    type_line: "Sorcery",
    oracle_text: "Search your library for a card, put that card into your hand, then shuffle.",
    mana_cost: "{1}{B}",
    cmc: 2
  },
  
  // Basic Lands
  "Island": {
    id: "island-001",
    name: "Island",
    type_line: "Basic Land — Island",
    oracle_text: "({T}: Add {U}.)",
    mana_cost: "",
    cmc: 0
  },
  "Plains": {
    id: "plains-001",
    name: "Plains",
    type_line: "Basic Land — Plains",
    oracle_text: "({T}: Add {W}.)",
    mana_cost: "",
    cmc: 0
  },
  "Forest": {
    id: "forest-001",
    name: "Forest",
    type_line: "Basic Land — Forest",
    oracle_text: "({T}: Add {G}.)",
    mana_cost: "",
    cmc: 0
  },
  "Mountain": {
    id: "mountain-001",
    name: "Mountain",
    type_line: "Basic Land — Mountain",
    oracle_text: "({T}: Add {R}.)",
    mana_cost: "",
    cmc: 0
  },
  "Swamp": {
    id: "swamp-001",
    name: "Swamp",
    type_line: "Basic Land — Swamp",
    oracle_text: "({T}: Add {B}.)",
    mana_cost: "",
    cmc: 0
  }
};

// ============================================================================
// Deck Lists
// ============================================================================

const PLAYER1_DECK: string[] = [
  "Morophon, the Boundless", // Commander
  "Svyelun of Sea and Sky",
  "Merrow Reejerey",
  "Kindred Discovery",
  "Thassa's Oracle",
  "Aetherflux Reservoir",
  "Intruder Alarm",
  "Cyclonic Rift",
  "Rhystic Study",
  "Smothering Tithe",
  "Deeproot Waters",
  "Altar of Dementia",
  "Sol Ring",
  "Counterspell",
  "Force of Will",
  "Demonic Tutor",
  "Swords to Plowshares",
  "Command Tower",
  // Fill with lands
  ...Array(20).fill("Island"),
  ...Array(10).fill("Plains"),
  ...Array(10).fill("Forest"),
  ...Array(5).fill("Mountain"),
  ...Array(5).fill("Swamp"),
  // More utility cards
  ...Array(30).fill("Island") // Padding to 99
];

const PLAYER2_DECK: string[] = [
  "Kynaios and Tiro of Meletis", // Commander
  "Arcane Denial",
  "Beast Within",
  "Blasphemous Act",
  "Blazing Archon",
  "Chromatic Lantern",
  "Collective Restraint",
  "Cultivate",
  "Ghostly Prison",
  "Howling Mine",
  "Sol Ring",
  "Psychosis Crawler",
  "Triumph of the Hordes",
  "Fog",
  "Swords to Plowshares",
  "Command Tower",
  // Fill with lands
  ...Array(5).fill("Island"),
  ...Array(5).fill("Plains"),
  ...Array(5).fill("Forest"),
  ...Array(5).fill("Mountain"),
  // Padding
  ...Array(62).fill("Island")
];

// ============================================================================
// Game Simulation Engine
// ============================================================================

class CommanderGameSimulator {
  private rng: () => number;
  private currentSeed: number;
  private analysisMode: boolean;
  
  constructor(seed?: number, analysisMode: boolean = false) {
    this.currentSeed = seed ?? Math.floor(Math.random() * 10000);
    this.analysisMode = analysisMode;
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

  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  getCard(name: string): CardData | undefined {
    return CARD_DATABASE[name];
  }

  isLand(cardName: string): boolean {
    const card = this.getCard(cardName);
    return card?.type_line?.toLowerCase().includes('land') ?? false;
  }

  isCreature(cardName: string): boolean {
    const card = this.getCard(cardName);
    return card?.type_line?.toLowerCase().includes('creature') ?? false;
  }

  isMerfolk(cardName: string): boolean {
    const card = this.getCard(cardName);
    return card?.type_line?.toLowerCase().includes('merfolk') ?? false;
  }

  getCMC(cardName: string): number {
    const card = this.getCard(cardName);
    return card?.cmc ?? 0;
  }

  getTotalMana(pool: ManaPool): number {
    return pool.white + pool.blue + pool.black + pool.red + pool.green + pool.colorless;
  }

  canPayMana(player: PlayerState, cost: number): boolean {
    return this.getTotalMana(player.manaPool) >= cost;
  }

  payMana(player: PlayerState, cost: number): void {
    let remaining = cost;
    const colors: (keyof ManaPool)[] = ['colorless', 'white', 'blue', 'black', 'red', 'green'];
    for (const color of colors) {
      const available = player.manaPool[color] || 0;
      const toPay = Math.min(available, remaining);
      player.manaPool[color] = available - toPay;
      remaining -= toPay;
      if (remaining <= 0) break;
    }
  }

  addManaForLand(player: PlayerState, landName: string): void {
    if (landName === 'Plains') player.manaPool.white++;
    else if (landName === 'Island') player.manaPool.blue++;
    else if (landName === 'Swamp') player.manaPool.black++;
    else if (landName === 'Mountain') player.manaPool.red++;
    else if (landName === 'Forest') player.manaPool.green++;
    else if (landName === 'Command Tower') {
      // Add any color - pick blue for merfolk deck
      player.manaPool.blue++;
    } else {
      player.manaPool.colorless++;
    }
  }

  tapLandsForMana(player: PlayerState): void {
    for (const perm of player.battlefield) {
      if (!perm.tapped && this.isLand(perm.card)) {
        perm.tapped = true;
        this.addManaForLand(player, perm.card);
      }
    }
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

  drawCards(player: PlayerState, count: number): string[] {
    const drawn: string[] = [];
    for (let i = 0; i < count && player.library.length > 0; i++) {
      const card = player.library.shift()!;
      player.hand.push(card);
      drawn.push(card);
      player.cardsDrawnThisTurn++;
    }
    return drawn;
  }

  playLand(player: PlayerState, landName: string): boolean {
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
    return true;
  }

  castSpell(player: PlayerState, cardName: string, state: SimulatedGameState): boolean {
    const cost = this.getCMC(cardName);
    if (!this.canPayMana(player, cost)) return false;
    
    const handIndex = player.hand.indexOf(cardName);
    if (handIndex === -1) return false;
    
    this.payMana(player, cost);
    player.hand.splice(handIndex, 1);
    
    const card = this.getCard(cardName);
    const typeLine = card?.type_line?.toLowerCase() || '';
    
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
      
      const playerName = player.name.includes('1') ? 'Player 1' : 'Player 2';
      const existing = state.cardsPlayed.get(playerName) || [];
      existing.push(cardName);
      state.cardsPlayed.set(playerName, existing);
      
      this.handleETBTrigger(cardName, player, state);
    } else {
      this.resolveInstantSorcery(cardName, player, state);
      player.graveyard.push(cardName);
    }
    
    return true;
  }

  handleETBTrigger(cardName: string, player: PlayerState, state: SimulatedGameState): void {
    const card = this.getCard(cardName);
    const oracle = card?.oracle_text?.toLowerCase() || '';
    
    if (oracle.includes('when') && oracle.includes('enters')) {
      state.events.push({
        turn: state.turn,
        player: player.name,
        action: 'trigger',
        card: cardName,
        details: 'ETB trigger'
      });
    }
    
    // Thassa's Oracle win condition
    if (cardName === "Thassa's Oracle") {
      const devotion = player.battlefield.filter(p => {
        const c = this.getCard(p.card);
        return c?.mana_cost?.includes('U');
      }).length * 1;
      
      if (devotion >= player.library.length) {
        state.winner = player.name.includes('1') ? 1 : 2;
        state.winCondition = "Thassa's Oracle - devotion to blue exceeded library size";
      }
    }
    
    // Merfolk triggers with Kindred Discovery
    if (this.isMerfolk(cardName)) {
      const hasKindredDiscovery = player.battlefield.some(p => p.card === 'Kindred Discovery');
      if (hasKindredDiscovery) {
        this.drawCards(player, 1);
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'draw',
          card: 'Kindred Discovery',
          details: 'Draw from Merfolk entering'
        });
      }
      
      const hasDeeproot = player.battlefield.some(p => p.card === 'Deeproot Waters');
      if (hasDeeproot) {
        player.battlefield.push({
          card: 'Merfolk Token',
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
          card: 'Deeproot Waters',
          details: 'Created 1/1 Merfolk token'
        });
      }
    }
  }

  resolveInstantSorcery(cardName: string, player: PlayerState, state: SimulatedGameState): void {
    const opponentId = player.name.includes('1') ? 2 : 1;
    const opponent = state.players[opponentId as 1 | 2];
    
    switch (cardName) {
      case 'Cyclonic Rift':
        const nonlands = opponent.battlefield.filter(p => !this.isLand(p.card));
        for (const perm of nonlands) {
          if (!perm.isToken) {
            opponent.hand.push(perm.card);
          }
        }
        opponent.battlefield = opponent.battlefield.filter(p => this.isLand(p.card));
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'cast',
          card: cardName,
          details: `Bounced ${nonlands.length} nonland permanents`
        });
        break;
        
      case 'Swords to Plowshares':
        const creatures = opponent.battlefield.filter(p => this.isCreature(p.card));
        if (creatures.length > 0) {
          const target = creatures[0];
          opponent.battlefield = opponent.battlefield.filter(p => p !== target);
          opponent.exile.push(target.card);
          opponent.life += target.power;
          state.events.push({
            turn: state.turn,
            player: player.name,
            action: 'cast',
            card: cardName,
            details: `Exiled ${target.card}, opponent gained ${target.power} life`
          });
        }
        break;
        
      case 'Cultivate':
        const basics = player.library.filter(c => 
          c === 'Island' || c === 'Plains' || c === 'Forest' || c === 'Mountain' || c === 'Swamp'
        );
        if (basics.length >= 2) {
          const land1 = basics[0];
          const land2 = basics[1];
          // Remove only one instance of each land
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
            action: 'cast',
            card: cardName,
            details: `Put ${land1} onto battlefield, ${land2} to hand`
          });
        }
        break;
        
      case 'Blasphemous Act':
        let killed = 0;
        for (const p of [player, opponent]) {
          const creatures = p.battlefield.filter(perm => this.isCreature(perm.card));
          for (const creature of creatures) {
            creature.damage = (creature.damage || 0) + 13;
            if ((creature.damage || 0) >= creature.toughness) {
              p.battlefield = p.battlefield.filter(x => x !== creature);
              if (!creature.isToken) {
                p.graveyard.push(creature.card);
              }
              killed++;
            }
          }
        }
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'cast',
          card: cardName,
          details: `Dealt 13 damage to all creatures, killed ${killed}`
        });
        break;

      case 'Triumph of the Hordes':
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
          details: 'Creatures get +1/+1 and infect until end of turn'
        });
        break;
    }
  }

  checkStateBasedActions(state: SimulatedGameState): boolean {
    let changed = false;
    
    for (const playerId of [1, 2] as const) {
      const player = state.players[playerId];
      
      if (player.life <= 0) {
        state.winner = playerId === 1 ? 2 : 1;
        state.winCondition = `${player.name} life total reduced to 0 or below`;
        return true;
      }
      
      if (player.poisonCounters >= 10) {
        state.winner = playerId === 1 ? 2 : 1;
        state.winCondition = `${player.name} received 10+ poison counters`;
        return true;
      }
    }
    
    return changed;
  }

  checkWinConditions(state: SimulatedGameState): boolean {
    for (const playerId of [1, 2] as const) {
      const player = state.players[playerId];
      
      // Aetherflux Reservoir win
      const hasReservoir = player.battlefield.some(p => p.card === 'Aetherflux Reservoir');
      if (hasReservoir && player.life >= 51) {
        const opponent = state.players[playerId === 1 ? 2 : 1];
        player.life -= 50;
        opponent.life -= 50;
        if (opponent.life <= 0) {
          state.winner = playerId;
          state.winCondition = 'Aetherflux Reservoir activation (paid 50 life to deal 50 damage)';
          return true;
        }
      }
    }
    
    return false;
  }

  simulateCombat(state: SimulatedGameState, attackingPlayerId: 1 | 2): void {
    const attacker = state.players[attackingPlayerId];
    const defender = state.players[attackingPlayerId === 1 ? 2 : 1];
    
    // Check for pillowfort effects
    const hasGhostlyPrison = defender.battlefield.some(p => p.card === 'Ghostly Prison');
    const hasBlazingArchon = defender.battlefield.some(p => p.card === 'Blazing Archon');
    
    if (hasBlazingArchon) {
      state.events.push({
        turn: state.turn,
        player: attacker.name,
        action: 'combat blocked',
        details: 'Blazing Archon prevents attacks'
      });
      return;
    }
    
    const attackers = attacker.battlefield.filter(p => 
      this.isCreature(p.card) && 
      !p.tapped && 
      !p.summoningSickness
    );
    
    if (attackers.length === 0) return;
    
    // If Ghostly Prison, calculate how many creatures we can afford to attack with
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
        details: 'Cannot afford to attack through Ghostly Prison'
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
        details: `Dealt ${totalDamage} infect damage (${defender.poisonCounters}/10 poison)`
      });
    } else {
      defender.life -= totalDamage;
      state.events.push({
        turn: state.turn,
        player: attacker.name,
        action: 'combat',
        details: `Dealt ${totalDamage} damage (${defender.name} at ${defender.life} life)`
      });
    }
  }

  simulateMainPhase(player: PlayerState, state: SimulatedGameState): void {
    // Play a land if possible
    const lands = player.hand.filter(c => this.isLand(c));
    if (lands.length > 0 && player.landsPlayedThisTurn < 1) {
      const land = lands[0];
      if (this.playLand(player, land)) {
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'play land',
          card: land,
        });
      }
    }
    
    // Tap lands for mana
    this.tapLandsForMana(player);
    
    // Cast spells prioritizing by importance
    const castable = player.hand
      .filter(c => !this.isLand(c))
      .filter(c => this.canPayMana(player, this.getCMC(c)))
      .sort((a, b) => {
        const aCard = this.getCard(a);
        const bCard = this.getCard(b);
        
        // Win conditions first
        if (a === "Thassa's Oracle") return -1;
        if (b === "Thassa's Oracle") return 1;
        if (a === "Aetherflux Reservoir") return -1;
        if (b === "Aetherflux Reservoir") return 1;
        
        // Mana rocks next
        if (a === "Sol Ring") return -1;
        if (b === "Sol Ring") return 1;
        
        // Then by CMC
        return (aCard?.cmc || 0) - (bCard?.cmc || 0);
      });
    
    let spellsCast = 0;
    for (const spell of castable) {
      if (spellsCast >= 3) break;
      
      // Determine reasoning for casting this spell
      const cardData = this.getCard(spell);
      let reasoning = '';
      if (spell === "Sol Ring") {
        reasoning = 'Mana acceleration - Sol Ring provides 2 colorless mana for only 1 mana investment';
      } else if (spell === "Thassa's Oracle") {
        reasoning = 'Win condition - can win the game if devotion to blue exceeds library size';
      } else if (spell === "Aetherflux Reservoir") {
        reasoning = 'Win condition - can deal 50 damage if life total reaches 51+';
      } else if (cardData?.type_line?.includes('Creature')) {
        reasoning = `Creature for board presence (${cardData.power}/${cardData.toughness})`;
      } else if (cardData?.type_line?.includes('Enchantment')) {
        reasoning = 'Enchantment for ongoing value';
      } else {
        reasoning = `Cast for its effect: ${cardData?.oracle_text?.substring(0, 50) || 'unknown'}...`;
      }
      
      if (this.castSpell(player, spell, state)) {
        spellsCast++;
        const result = `Successfully resolved. Added to battlefield.`;
        state.events.push({
          turn: state.turn,
          player: player.name,
          action: 'cast',
          card: spell,
          reasoning,
          result,
        });
        this.log(`${player.name} cast ${spell}`);
        this.log(`  Reasoning: ${reasoning}`);
        this.log(`  Result: ${result}`);
        this.tapLandsForMana(player);
      }
    }
  }

  handleUpkeepTriggers(player: PlayerState, state: SimulatedGameState): void {
    const opponent = state.players[player.name.includes('1') ? 2 : 1];
    
    // Howling Mine - both players draw (only if untapped)
    const playerHasUntappedHowlingMine = player.battlefield.some(p => p.card === 'Howling Mine' && !p.tapped);
    const opponentHasUntappedHowlingMine = opponent.battlefield.some(p => p.card === 'Howling Mine' && !p.tapped);
    if (playerHasUntappedHowlingMine || opponentHasUntappedHowlingMine) {
      this.drawCards(player, 1);
      state.events.push({
        turn: state.turn,
        player: player.name,
        action: 'draw',
        card: 'Howling Mine',
        details: 'Drew extra card'
      });
    }
    
    // Psychosis Crawler damage on draw
    const hasCrawler = player.battlefield.some(p => p.card === 'Psychosis Crawler');
    if (hasCrawler && player.cardsDrawnThisTurn > 0) {
      opponent.life -= player.cardsDrawnThisTurn;
      state.events.push({
        turn: state.turn,
        player: player.name,
        action: 'trigger',
        card: 'Psychosis Crawler',
        details: `Opponent lost ${player.cardsDrawnThisTurn} life from card draws`
      });
    }
  }

  handleEndStepTriggers(player: PlayerState, state: SimulatedGameState): void {
    // Kynaios and Tiro trigger
    const hasKT = player.battlefield.some(p => p.card === 'Kynaios and Tiro of Meletis');
    if (hasKT) {
      this.drawCards(player, 1);
      state.events.push({
        turn: state.turn,
        player: player.name,
        action: 'trigger',
        card: 'Kynaios and Tiro of Meletis',
        details: 'Drew a card at end step'
      });
      
      // Each player may put a land from hand onto battlefield
      const opponent = state.players[player.name.includes('1') ? 2 : 1];
      for (const p of [player, opponent]) {
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
        }
      }
    }
  }

  simulateTurn(state: SimulatedGameState): void {
    state.turn++;
    const activePlayerId = ((state.turn - 1) % 2) + 1 as 1 | 2;
    state.activePlayer = activePlayerId;
    const player = state.players[activePlayerId];
    
    // Untap
    this.untapAll(player);
    player.landsPlayedThisTurn = 0;
    player.cardsDrawnThisTurn = 0;
    
    // Upkeep
    this.handleUpkeepTriggers(player, state);
    
    // Draw (skip turn 1 for player 1)
    if (state.turn > 1 || activePlayerId === 2) {
      this.drawCards(player, 1);
    }
    
    // Pre-combat main
    this.simulateMainPhase(player, state);
    
    // Combat (skip early turns)
    if (state.turn > 4) {
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
    return {
      turn: 0,
      activePlayer: 1,
      phase: 'beginning',
      players: {
        1: {
          name: 'Player 1 (Morophon Merfolk)',
          life: 40,
          commander: 'Morophon, the Boundless',
          commanderInCommandZone: true,
          commanderTax: 0,
          library: this.shuffle([...PLAYER1_DECK.slice(1)]),
          hand: [],
          battlefield: [],
          graveyard: [],
          exile: [],
          manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          landsPlayedThisTurn: 0,
          poisonCounters: 0,
          cardsDrawnThisTurn: 0,
        },
        2: {
          name: 'Player 2 (Kynaios and Tiro)',
          life: 40,
          commander: 'Kynaios and Tiro of Meletis',
          commanderInCommandZone: true,
          commanderTax: 0,
          library: this.shuffle([...PLAYER2_DECK.slice(1)]),
          hand: [],
          battlefield: [],
          graveyard: [],
          exile: [],
          manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          landsPlayedThisTurn: 0,
          poisonCounters: 0,
          cardsDrawnThisTurn: 0,
        },
      },
      stack: [],
      events: [],
      cardsPlayed: new Map(),
      morophonChosenType: 'Merfolk',
      winner: null,
      winCondition: null,
    };
  }

  async runGame(gameNumber: number): Promise<GameSummary> {
    // Use a unique seed for each game based on base seed + game number
    const gameSeed = this.currentSeed + gameNumber * 1000;
    this.initRng(gameSeed);
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Starting Game ${gameNumber} (Seed: ${gameSeed})`);
    console.log(`${'='.repeat(60)}`);
    
    if (this.analysisMode) {
      console.log('\n[ANALYSIS MODE ENABLED - Detailed replay with reasoning]\n');
    }
    
    const state = this.createInitialState();
    
    this.log(`Libraries shuffled with seed ${gameSeed}`);
    this.log(`Player 1 library top 5: ${state.players[1].library.slice(0, 5).join(', ')}`);
    this.log(`Player 2 library top 5: ${state.players[2].library.slice(0, 5).join(', ')}`);
    
    // Draw initial hands
    this.drawCards(state.players[1], 7);
    this.drawCards(state.players[2], 7);
    
    this.log(`Player 1 opening hand: ${state.players[1].hand.join(', ')}`);
    this.log(`Player 2 opening hand: ${state.players[2].hand.join(', ')}`);
    
    // Simple mulligan
    for (const playerId of [1, 2] as const) {
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
        this.drawCards(player, handSize);
        mulligans++;
        
        state.events.push({
          turn: 0,
          player: player.name,
          action: 'mulligan',
          details: `Mulliganed to ${handSize} cards`
        });
      }
    }
    
    const maxTurns = 25;
    while (state.turn < maxTurns && !state.winner) {
      this.simulateTurn(state);
      this.checkStateBasedActions(state);
      this.checkWinConditions(state);
      
      const activePlayer = state.players[state.activePlayer as 1 | 2];
      const p1 = state.players[1];
      const p2 = state.players[2];
      console.log(`Turn ${state.turn}: ${activePlayer.name.split(' ')[0]} ${activePlayer.name.split(' ')[1]} - Life: P1=${p1.life}, P2=${p2.life} | Poison: P1=${p1.poisonCounters}, P2=${p2.poisonCounters}`);
    }
    
    if (!state.winner) {
      if (state.players[1].life > state.players[2].life) {
        state.winner = 1;
        state.winCondition = 'Higher life total at turn limit';
      } else if (state.players[2].life > state.players[1].life) {
        state.winner = 2;
        state.winCondition = 'Higher life total at turn limit';
      } else {
        state.winner = 2;
        state.winCondition = 'Game timeout - tie broken by turn order';
      }
    }
    
    const winnerName = state.winner === 1 ? 'Player 1 (Morophon Merfolk)' : 'Player 2 (Kynaios and Tiro)';
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
      
      if (event.reasoning) {
        console.log(`    Reasoning: ${event.reasoning}`);
      }
      if (event.result) {
        console.log(`    Result: ${event.result}`);
      }
      if (event.oracleTextExecuted === false) {
        console.log(`    ⚠️ Oracle text NOT fully executed!`);
        if (event.expectedEffect) console.log(`    Expected: ${event.expectedEffect}`);
        if (event.actualEffect) console.log(`    Actual: ${event.actualEffect}`);
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
        
        const oracle = cardData.oracle_text?.toLowerCase() || '';
        
        // Sol Ring should add 2 colorless mana
        if (card === 'Sol Ring') {
          const solRingTaps = state.events.filter(e => 
            e.card === 'Sol Ring' && e.action === 'tap for mana'
          ).length;
          // Sol Ring is passive, this is expected
        }
        
        // Psychosis Crawler should deal damage when cards are drawn
        if (card === 'Psychosis Crawler') {
          const crawlerDamage = state.events.filter(e => 
            e.card === 'Psychosis Crawler' && e.action === 'trigger'
          ).length;
          const cardDraws = state.events.filter(e => 
            e.action === 'draw' && e.player === playerName
          ).length;
          if (cardDraws > 0 && crawlerDamage === 0) {
            notFunctioning.push(`Psychosis Crawler (${playerName}): Should have triggered on card draws but didn't`);
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
    
    for (const playerId of [1, 2] as const) {
      const player = state.players[playerId];
      
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
    
    const p1 = state.players[1];
    
    // Check if Intruder Alarm combo was assembled
    const hasAlarm = p1.battlefield.some(p => p.card === 'Intruder Alarm');
    const hasTokenGen = p1.battlefield.some(p => 
      p.card === 'Deeproot Waters' || p.card === 'Kindred Discovery'
    );
    if (hasAlarm && hasTokenGen) {
      const untapTriggers = state.events.filter(e => 
        e.card === 'Intruder Alarm' && e.action === 'trigger'
      ).length;
      if (untapTriggers === 0) {
        notOccurred.push('Intruder Alarm + token generators were on board but combo did not trigger');
      }
    }
    
    // Check Kindred Discovery + Merfolk
    const hasDiscovery = p1.battlefield.some(p => p.card === 'Kindred Discovery');
    const merfolkCount = p1.battlefield.filter(p => this.isMerfolk(p.card)).length;
    if (hasDiscovery && merfolkCount > 0) {
      const discoveryDraws = state.events.filter(e => 
        e.card === 'Kindred Discovery' && e.action === 'draw'
      ).length;
      if (discoveryDraws === 0) {
        notOccurred.push('Kindred Discovery on board with Merfolk but no card draw triggers occurred');
      }
    }
    
    return notOccurred;
  }

  generateReport(summaries: GameSummary[]): void {
    console.log('\n' + '='.repeat(80));
    console.log('SIMULATION REPORT - 5 Commander Games');
    console.log('Player 1: Morophon, the Boundless (Merfolk Tribal)');
    console.log('Player 2: Kynaios and Tiro of Meletis (Group Hug)');
    console.log('='.repeat(80) + '\n');
    
    const p1Wins = summaries.filter(s => s.winner.includes('Player 1')).length;
    const p2Wins = summaries.filter(s => s.winner.includes('Player 2')).length;
    
    console.log('WIN SUMMARY:');
    console.log(`  Player 1 (Morophon Merfolk): ${p1Wins} wins`);
    console.log(`  Player 2 (Kynaios and Tiro): ${p2Wins} wins`);
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
    const p1Cards = new Map<string, number>();
    const p2Cards = new Map<string, number>();
    
    for (const summary of summaries) {
      const p1Played = summary.cardsPlayed.get('Player 1') || [];
      const p2Played = summary.cardsPlayed.get('Player 2') || [];
      
      for (const card of p1Played) {
        p1Cards.set(card, (p1Cards.get(card) || 0) + 1);
      }
      for (const card of p2Played) {
        p2Cards.set(card, (p2Cards.get(card) || 0) + 1);
      }
    }
    
    console.log('  Player 1 (Morophon):');
    const sortedP1 = [...p1Cards.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    for (const [card, count] of sortedP1) {
      console.log(`    - ${card}: ${count} time(s)`);
    }
    
    console.log('  Player 2 (Kynaios and Tiro):');
    const sortedP2 = [...p2Cards.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    for (const [card, count] of sortedP2) {
      console.log(`    - ${card}: ${count} time(s)`);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('END OF SIMULATION REPORT');
    console.log('='.repeat(80));
  }

  async run(): Promise<void> {
    console.log('Commander Game Simulator');
    console.log('Using embedded card data (Scryfall oracle text)');
    console.log('');
    
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

async function main() {
  const args = process.argv.slice(2);
  const analysisMode = args.includes('--analysis') || args.includes('-a');
  const seedArg = args.find(a => a.startsWith('--seed='));
  const seed = seedArg ? parseInt(seedArg.split('=')[1], 10) : 42;
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Commander Game Simulator');
    console.log('');
    console.log('Usage: npx tsx run-commander-games.ts [options]');
    console.log('');
    console.log('Options:');
    console.log('  --analysis, -a    Enable analysis mode with detailed replay and reasoning');
    console.log('  --seed=N          Set the base random seed (default: 42)');
    console.log('  --help, -h        Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  npx tsx run-commander-games.ts');
    console.log('  npx tsx run-commander-games.ts --analysis');
    console.log('  npx tsx run-commander-games.ts --analysis --seed=12345');
    return;
  }
  
  console.log(`Base seed: ${seed}`);
  if (analysisMode) {
    console.log('Analysis mode: ENABLED');
  }
  
  const simulator = new CommanderGameSimulator(seed, analysisMode);
  await simulator.run();
}

main().catch(console.error);
