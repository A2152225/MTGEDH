import { v4 as uuidv4 } from 'uuid';
import { GameState, GameStatus, GameFormat, Player, GamePhase, GameStep } from '@mtgedh/shared';
import { DatabaseService } from './services/DatabaseService';
import { RulesEngine } from '@mtgedh/rules-engine';

export class GameManager {
  private games: Map<string, GameState> = new Map();
  private rulesEngine: RulesEngine;
  
  constructor(private db: DatabaseService) {
    this.rulesEngine = new RulesEngine();
  }
  
  createGame(options: {
    format: GameFormat;
    startingLife?: number;
    maxPlayers?: number;
  }): GameState {
    const gameId = uuidv4();
    
    const startingLife = options.startingLife || this.getDefaultLife(options.format);
    
    const game: GameState = {
      id: gameId,
      format: options.format,
      players: [],
      turnOrder: [],
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      turn: 0,
      phase: GamePhase.BEGINNING,
      step: GameStep.UNTAP,
      stack: [],
      startingLife,
      allowUndos: true,
      turnTimerEnabled: false,
      turnTimerSeconds: 300,
      createdAt: Date.now(),
      lastActionAt: Date.now(),
      spectators: [],
      status: GameStatus.WAITING
    };
    
    this.games.set(gameId, game);
    this.db.saveGame(game);
    
    return game;
  }
  
  joinGame(gameId: string, player: Partial<Player>): Player | null {
    const game = this.games.get(gameId);
    if (!game || game.status !== GameStatus.WAITING) {
      return null;
    }
    
    const newPlayer: Player = {
      id: player.id || uuidv4(),
      name: player.name || `Player ${game.players.length + 1}`,
      socketId: player.socketId,
      life: game.startingLife,
      startingLife: game.startingLife,
      poisonCounters: 0,
      energyCounters: 0,
      experienceCounters: 0,
      commanderDamage: {},
      library: [],
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      commandZone: [],
      manaPool: {
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
        generic: 0
      },
      hasPriority: false,
      hasPassedPriority: false,
      landsPlayedThisTurn: 0,
      maxLandsPerTurn: 1,
      autoPassPriority: {
        upkeep: false,
        draw: false,
        mainPhase: false,
        beginCombat: false,
        declareAttackers: false,
        declareBlockers: false,
        combatDamage: false,
        endStep: false
      },
      stopSettings: {
        opponentUpkeep: false,
        opponentDraw: false,
        opponentMain: false,
        opponentCombat: false,
        opponentEndStep: true,
        myUpkeep: true,
        myDraw: true,
        myEndStep: true
      },
      connected: true,
      lastActionAt: Date.now()
    };
    
    game.players.push(newPlayer);
    game.turnOrder.push(newPlayer.id);
    
    return newPlayer;
  }
  
  startGame(gameId: string): boolean {
    const game = this.games.get(gameId);
    if (!game || game.players.length < 2) {
      return false;
    }
    
    game.status = GameStatus.IN_PROGRESS;
    game.startedAt = Date.now();
    game.turn = 1;
    game.players[0].hasPriority = true;
    
    // Each player draws opening hand
    game.players.forEach(player => {
      this.drawCards(game, player.id, 7);
    });
    
    return true;
  }
  
  getGame(gameId: string): GameState | undefined {
    return this.games.get(gameId);
  }
  
  getAllGames(): GameState[] {
    return Array.from(this.games.values());
  }
  
  handleDisconnect(socketId: string): void {
    this.games.forEach(game => {
      const player = game.players.find(p => p.socketId === socketId);
      if (player) {
        player.connected = false;
        player.socketId = undefined;
      }
    });
  }
  
  private getDefaultLife(format: GameFormat): number {
    switch (format) {
      case GameFormat.COMMANDER:
        return 40;
      case GameFormat.STANDARD:
      case GameFormat.MODERN:
      case GameFormat.VINTAGE:
      case GameFormat.LEGACY:
      case GameFormat.PAUPER:
        return 20;
      default:
        return 20;
    }
  }
  
  private drawCards(game: GameState, playerId: string, count: number): void {
    const player = game.players.find(p => p.id === playerId);
    if (!player) return;
    
    for (let i = 0; i < count && player.library.length > 0; i++) {
      const card = player.library.shift()!;
      player.hand.push(card);
      card.zone = 'hand' as any;
      card.knownTo = [playerId];
    }
  }
}