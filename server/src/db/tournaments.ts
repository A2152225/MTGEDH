/**
 * Tournament database module for MTG Online-like functionality.
 * Provides tournament creation, bracket management, and result tracking.
 */
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { debug, debugWarn, debugError } from "../utils/debug.js";

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'mtgedh.sqlite');
const db = new Database(DB_FILE);

db.pragma('journal_mode = WAL');

// Tournament schema
db.exec(`
CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'swiss',
  status TEXT NOT NULL DEFAULT 'registration',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  max_players INTEGER DEFAULT 64,
  min_players INTEGER DEFAULT 4,
  rounds INTEGER,
  current_round INTEGER DEFAULT 0,
  description TEXT,
  rules TEXT,
  starting_life INTEGER DEFAULT 40,
  best_of INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS tournaments_status_idx ON tournaments(status);
CREATE INDEX IF NOT EXISTS tournaments_created_at_idx ON tournaments(created_at DESC);
`);

// Tournament participants
db.exec(`
CREATE TABLE IF NOT EXISTS tournament_participants (
  tournament_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  deck_id TEXT,
  commander_names TEXT,
  registered_at INTEGER NOT NULL,
  dropped INTEGER DEFAULT 0,
  dropped_at INTEGER,
  match_wins INTEGER DEFAULT 0,
  match_losses INTEGER DEFAULT 0,
  game_wins INTEGER DEFAULT 0,
  game_losses INTEGER DEFAULT 0,
  points INTEGER DEFAULT 0,
  tiebreaker1 REAL DEFAULT 0,
  tiebreaker2 REAL DEFAULT 0,
  final_standing INTEGER,
  PRIMARY KEY (tournament_id, user_id),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS tournament_participants_user_idx ON tournament_participants(user_id);
`);

// Tournament rounds/pairings
db.exec(`
CREATE TABLE IF NOT EXISTS tournament_pairings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  table_number INTEGER,
  player1_id TEXT NOT NULL,
  player2_id TEXT,
  winner_id TEXT,
  player1_wins INTEGER DEFAULT 0,
  player2_wins INTEGER DEFAULT 0,
  draws INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  match_id TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS tournament_pairings_tournament_idx ON tournament_pairings(tournament_id, round);
`);

// Prepared statements
const createTournamentStmt = db.prepare(`
  INSERT INTO tournaments (id, name, format, type, status, created_by, created_at, max_players, min_players, description, rules, starting_life, best_of)
  VALUES (@id, @name, @format, @type, @status, @created_by, @created_at, @max_players, @min_players, @description, @rules, @starting_life, @best_of)
`);

const updateTournamentStmt = db.prepare(`
  UPDATE tournaments SET status = @status, started_at = @started_at, ended_at = @ended_at, rounds = @rounds, current_round = @current_round WHERE id = @id
`);

const getTournamentStmt = db.prepare(`
  SELECT * FROM tournaments WHERE id = ?
`);

const listTournamentsStmt = db.prepare(`
  SELECT * FROM tournaments WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
`);

const listAllTournamentsStmt = db.prepare(`
  SELECT * FROM tournaments ORDER BY created_at DESC LIMIT ? OFFSET ?
`);

const registerParticipantStmt = db.prepare(`
  INSERT INTO tournament_participants (tournament_id, user_id, deck_id, commander_names, registered_at)
  VALUES (@tournament_id, @user_id, @deck_id, @commander_names, @registered_at)
`);

const dropParticipantStmt = db.prepare(`
  UPDATE tournament_participants SET dropped = 1, dropped_at = ? WHERE tournament_id = ? AND user_id = ?
`);

const getParticipantsStmt = db.prepare(`
  SELECT tp.*, u.username, u.display_name, u.rating
  FROM tournament_participants tp
  JOIN users u ON tp.user_id = u.id
  WHERE tp.tournament_id = ? AND tp.dropped = 0
  ORDER BY tp.points DESC, tp.tiebreaker1 DESC, tp.tiebreaker2 DESC
`);

const getParticipantStmt = db.prepare(`
  SELECT * FROM tournament_participants WHERE tournament_id = ? AND user_id = ?
`);

const updateParticipantStatsStmt = db.prepare(`
  UPDATE tournament_participants 
  SET match_wins = @match_wins, match_losses = @match_losses, 
      game_wins = @game_wins, game_losses = @game_losses, 
      points = @points, tiebreaker1 = @tiebreaker1, tiebreaker2 = @tiebreaker2
  WHERE tournament_id = @tournament_id AND user_id = @user_id
`);

const setFinalStandingStmt = db.prepare(`
  UPDATE tournament_participants SET final_standing = ? WHERE tournament_id = ? AND user_id = ?
`);

const createPairingStmt = db.prepare(`
  INSERT INTO tournament_pairings (tournament_id, round, table_number, player1_id, player2_id, status)
  VALUES (@tournament_id, @round, @table_number, @player1_id, @player2_id, @status)
`);

const updatePairingStmt = db.prepare(`
  UPDATE tournament_pairings 
  SET winner_id = @winner_id, player1_wins = @player1_wins, player2_wins = @player2_wins, 
      draws = @draws, status = @status, match_id = @match_id, completed_at = @completed_at
  WHERE id = @id
`);

const startPairingStmt = db.prepare(`
  UPDATE tournament_pairings SET status = 'in_progress', started_at = ? WHERE id = ?
`);

const getPairingsForRoundStmt = db.prepare(`
  SELECT * FROM tournament_pairings WHERE tournament_id = ? AND round = ?
`);

const getPairingStmt = db.prepare(`
  SELECT * FROM tournament_pairings WHERE id = ?
`);

const getPlayerPairingsStmt = db.prepare(`
  SELECT * FROM tournament_pairings 
  WHERE tournament_id = ? AND (player1_id = ? OR player2_id = ?)
  ORDER BY round
`);

const getParticipantCountStmt = db.prepare(`
  SELECT COUNT(*) as count FROM tournament_participants WHERE tournament_id = ? AND dropped = 0
`);

// Types
export interface Tournament {
  id: string;
  name: string;
  format: string;
  type: 'swiss' | 'single_elimination' | 'double_elimination' | 'round_robin';
  status: 'registration' | 'in_progress' | 'completed' | 'cancelled';
  created_by: string;
  created_at: number;
  started_at?: number;
  ended_at?: number;
  max_players: number;
  min_players: number;
  rounds?: number;
  current_round: number;
  description?: string;
  rules?: string;
  starting_life: number;
  best_of: number;
}

export interface TournamentParticipant {
  tournament_id: string;
  user_id: string;
  deck_id?: string;
  commander_names?: string;
  registered_at: number;
  dropped: boolean;
  dropped_at?: number;
  match_wins: number;
  match_losses: number;
  game_wins: number;
  game_losses: number;
  points: number;
  tiebreaker1: number;
  tiebreaker2: number;
  final_standing?: number;
  username?: string;
  display_name?: string;
  rating?: number;
}

export interface TournamentPairing {
  id: number;
  tournament_id: string;
  round: number;
  table_number?: number;
  player1_id: string;
  player2_id?: string;
  winner_id?: string;
  player1_wins: number;
  player2_wins: number;
  draws: number;
  status: 'pending' | 'in_progress' | 'completed' | 'bye';
  match_id?: string;
  started_at?: number;
  completed_at?: number;
}

// API functions

/**
 * Create a new tournament.
 */
export function createTournament(config: {
  name: string;
  format: string;
  type?: 'swiss' | 'single_elimination' | 'double_elimination' | 'round_robin';
  createdBy: string;
  maxPlayers?: number;
  minPlayers?: number;
  description?: string;
  rules?: string;
  startingLife?: number;
  bestOf?: number;
}): Tournament {
  const id = `tourn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  
  createTournamentStmt.run({
    id,
    name: config.name,
    format: config.format,
    type: config.type || 'swiss',
    status: 'registration',
    created_by: config.createdBy,
    created_at: now,
    max_players: config.maxPlayers || 64,
    min_players: config.minPlayers || 4,
    description: config.description || null,
    rules: config.rules || null,
    starting_life: config.startingLife || 40,
    best_of: config.bestOf || 1,
  });
  
  return {
    id,
    name: config.name,
    format: config.format,
    type: (config.type || 'swiss') as Tournament['type'],
    status: 'registration',
    created_by: config.createdBy,
    created_at: now,
    max_players: config.maxPlayers || 64,
    min_players: config.minPlayers || 4,
    current_round: 0,
    description: config.description,
    rules: config.rules,
    starting_life: config.startingLife || 40,
    best_of: config.bestOf || 1,
  };
}

/**
 * Get tournament by ID.
 */
export function getTournament(tournamentId: string): Tournament | null {
  const row = getTournamentStmt.get(tournamentId) as any;
  if (!row) return null;
  return row as Tournament;
}

/**
 * List tournaments by status.
 */
export function listTournaments(status?: string, limit: number = 20, offset: number = 0): Tournament[] {
  if (status) {
    return listTournamentsStmt.all(status, limit, offset) as Tournament[];
  }
  return listAllTournamentsStmt.all(limit, offset) as Tournament[];
}

/**
 * Register a player for a tournament.
 */
export function registerForTournament(
  tournamentId: string,
  userId: string,
  deckId?: string,
  commanderNames?: string
): boolean {
  try {
    registerParticipantStmt.run({
      tournament_id: tournamentId,
      user_id: userId,
      deck_id: deckId || null,
      commander_names: commanderNames || null,
      registered_at: Date.now(),
    });
    return true;
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      return false; // Already registered
    }
    debugError(1, '[DB] registerForTournament failed:', err);
    return false;
  }
}

/**
 * Drop a player from a tournament.
 */
export function dropFromTournament(tournamentId: string, userId: string): boolean {
  const info = dropParticipantStmt.run(Date.now(), tournamentId, userId);
  return info.changes > 0;
}

/**
 * Get tournament participants.
 */
export function getParticipants(tournamentId: string): TournamentParticipant[] {
  const rows = getParticipantsStmt.all(tournamentId) as any[];
  return rows.map(row => ({
    ...row,
    dropped: !!row.dropped,
  }));
}

/**
 * Get participant count.
 */
export function getParticipantCount(tournamentId: string): number {
  const row = getParticipantCountStmt.get(tournamentId) as { count: number };
  return row?.count || 0;
}

/**
 * Start a tournament.
 */
export function startTournament(tournamentId: string): boolean {
  const tournament = getTournament(tournamentId);
  if (!tournament || tournament.status !== 'registration') {
    return false;
  }
  
  const participantCount = getParticipantCount(tournamentId);
  if (participantCount < tournament.min_players) {
    return false;
  }
  
  // Calculate number of rounds for Swiss
  let rounds: number;
  if (tournament.type === 'swiss') {
    rounds = Math.ceil(Math.log2(participantCount));
  } else if (tournament.type === 'single_elimination') {
    rounds = Math.ceil(Math.log2(participantCount));
  } else if (tournament.type === 'double_elimination') {
    rounds = Math.ceil(Math.log2(participantCount)) * 2 - 1;
  } else {
    rounds = participantCount - 1; // Round robin
  }
  
  updateTournamentStmt.run({
    id: tournamentId,
    status: 'in_progress',
    started_at: Date.now(),
    ended_at: null,
    rounds,
    current_round: 1,
  });
  
  return true;
}

/**
 * Generate pairings for the next round (Swiss).
 */
export function generateSwissPairings(tournamentId: string): TournamentPairing[] {
  const tournament = getTournament(tournamentId);
  if (!tournament) return [];
  
  const participants = getParticipants(tournamentId);
  if (participants.length < 2) return [];
  
  // Sort by points, then tiebreakers
  participants.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.tiebreaker1 !== a.tiebreaker1) return b.tiebreaker1 - a.tiebreaker1;
    return b.tiebreaker2 - a.tiebreaker2;
  });
  
  // Get previous pairings to avoid rematches
  const previousPairings = new Set<string>();
  for (let r = 1; r < tournament.current_round; r++) {
    const pairings = getPairingsForRound(tournamentId, r);
    for (const p of pairings) {
      if (p.player2_id) {
        previousPairings.add(`${p.player1_id}-${p.player2_id}`);
        previousPairings.add(`${p.player2_id}-${p.player1_id}`);
      }
    }
  }
  
  // Simple greedy pairing algorithm
  const paired = new Set<string>();
  const newPairings: TournamentPairing[] = [];
  let tableNumber = 1;
  
  for (let i = 0; i < participants.length; i++) {
    const p1 = participants[i];
    if (paired.has(p1.user_id)) continue;
    
    // Find best opponent (highest ranked not yet paired, not previously faced)
    let opponent: TournamentParticipant | null = null;
    for (let j = i + 1; j < participants.length; j++) {
      const p2 = participants[j];
      if (paired.has(p2.user_id)) continue;
      
      const pairKey = `${p1.user_id}-${p2.user_id}`;
      if (!previousPairings.has(pairKey)) {
        opponent = p2;
        break;
      }
    }
    
    // If no unpaired opponent found, allow rematch
    if (!opponent) {
      for (let j = i + 1; j < participants.length; j++) {
        const p2 = participants[j];
        if (!paired.has(p2.user_id)) {
          opponent = p2;
          break;
        }
      }
    }
    
    if (opponent) {
      createPairingStmt.run({
        tournament_id: tournamentId,
        round: tournament.current_round,
        table_number: tableNumber++,
        player1_id: p1.user_id,
        player2_id: opponent.user_id,
        status: 'pending',
      });
      
      paired.add(p1.user_id);
      paired.add(opponent.user_id);
    } else {
      // Bye for this player
      createPairingStmt.run({
        tournament_id: tournamentId,
        round: tournament.current_round,
        table_number: tableNumber++,
        player1_id: p1.user_id,
        player2_id: null,
        status: 'bye',
      });
      
      // Award bye points
      updateParticipantStatsStmt.run({
        tournament_id: tournamentId,
        user_id: p1.user_id,
        match_wins: p1.match_wins + 1,
        match_losses: p1.match_losses,
        game_wins: p1.game_wins + 2,
        game_losses: p1.game_losses,
        points: p1.points + 3,
        tiebreaker1: p1.tiebreaker1,
        tiebreaker2: p1.tiebreaker2,
      });
      
      paired.add(p1.user_id);
    }
  }
  
  return getPairingsForRound(tournamentId, tournament.current_round);
}

/**
 * Get pairings for a round.
 */
export function getPairingsForRound(tournamentId: string, round: number): TournamentPairing[] {
  return getPairingsForRoundStmt.all(tournamentId, round) as TournamentPairing[];
}

/**
 * Get a single pairing.
 */
export function getPairing(pairingId: number): TournamentPairing | null {
  return getPairingStmt.get(pairingId) as TournamentPairing | null;
}

/**
 * Get all pairings for a player in a tournament.
 */
export function getPlayerPairings(tournamentId: string, userId: string): TournamentPairing[] {
  return getPlayerPairingsStmt.all(tournamentId, userId, userId) as TournamentPairing[];
}

/**
 * Start a match from a pairing.
 */
export function startPairingMatch(pairingId: number): boolean {
  const info = startPairingStmt.run(Date.now(), pairingId);
  return info.changes > 0;
}

/**
 * Report match result.
 */
export function reportMatchResult(
  pairingId: number,
  winnerId: string | null,
  player1Wins: number,
  player2Wins: number,
  draws: number,
  matchId?: string
): boolean {
  const pairing = getPairing(pairingId);
  if (!pairing) return false;
  
  updatePairingStmt.run({
    id: pairingId,
    winner_id: winnerId,
    player1_wins: player1Wins,
    player2_wins: player2Wins,
    draws: draws,
    status: 'completed',
    match_id: matchId || null,
    completed_at: Date.now(),
  });
  
  // Update participant stats
  if (pairing.player2_id) {
    const p1 = getParticipantStmt.get(pairing.tournament_id, pairing.player1_id) as TournamentParticipant;
    const p2 = getParticipantStmt.get(pairing.tournament_id, pairing.player2_id) as TournamentParticipant;
    
    if (p1 && p2) {
      // Calculate points: 3 for win, 1 for draw, 0 for loss
      let p1Points = p1.points;
      let p2Points = p2.points;
      let p1MatchWins = p1.match_wins;
      let p1MatchLosses = p1.match_losses;
      let p2MatchWins = p2.match_wins;
      let p2MatchLosses = p2.match_losses;
      
      if (winnerId === pairing.player1_id) {
        p1Points += 3;
        p1MatchWins += 1;
        p2MatchLosses += 1;
      } else if (winnerId === pairing.player2_id) {
        p2Points += 3;
        p2MatchWins += 1;
        p1MatchLosses += 1;
      } else {
        // Draw
        p1Points += 1;
        p2Points += 1;
      }
      
      updateParticipantStatsStmt.run({
        tournament_id: pairing.tournament_id,
        user_id: pairing.player1_id,
        match_wins: p1MatchWins,
        match_losses: p1MatchLosses,
        game_wins: p1.game_wins + player1Wins,
        game_losses: p1.game_losses + player2Wins,
        points: p1Points,
        tiebreaker1: p1.tiebreaker1,
        tiebreaker2: p1.tiebreaker2,
      });
      
      updateParticipantStatsStmt.run({
        tournament_id: pairing.tournament_id,
        user_id: pairing.player2_id,
        match_wins: p2MatchWins,
        match_losses: p2MatchLosses,
        game_wins: p2.game_wins + player2Wins,
        game_losses: p2.game_losses + player1Wins,
        points: p2Points,
        tiebreaker1: p2.tiebreaker1,
        tiebreaker2: p2.tiebreaker2,
      });
    }
  }
  
  return true;
}

/**
 * Check if a round is complete.
 */
export function isRoundComplete(tournamentId: string, round: number): boolean {
  const pairings = getPairingsForRound(tournamentId, round);
  return pairings.every(p => p.status === 'completed' || p.status === 'bye');
}

/**
 * Advance to the next round.
 */
export function advanceToNextRound(tournamentId: string): boolean {
  const tournament = getTournament(tournamentId);
  if (!tournament) return false;
  
  if (!isRoundComplete(tournamentId, tournament.current_round)) {
    return false;
  }
  
  // Calculate tiebreakers (simplified opponent match win percentage)
  calculateTiebreakers(tournamentId);
  
  if (tournament.current_round >= (tournament.rounds || 1)) {
    // Tournament complete
    endTournament(tournamentId);
    return true;
  }
  
  // Advance to next round
  updateTournamentStmt.run({
    id: tournamentId,
    status: 'in_progress',
    started_at: tournament.started_at,
    ended_at: null,
    rounds: tournament.rounds,
    current_round: tournament.current_round + 1,
  });
  
  return true;
}

/**
 * Calculate tiebreakers for all participants.
 */
function calculateTiebreakers(tournamentId: string): void {
  const participants = getParticipants(tournamentId);
  
  // Calculate opponent match win percentage for each player
  for (const p of participants) {
    const pairings = getPlayerPairings(tournamentId, p.user_id);
    let oppMatchWinPct = 0;
    let oppCount = 0;
    
    for (const pairing of pairings) {
      const oppId = pairing.player1_id === p.user_id ? pairing.player2_id : pairing.player1_id;
      if (!oppId) continue;
      
      const opp = getParticipantStmt.get(tournamentId, oppId) as TournamentParticipant;
      if (opp) {
        const totalMatches = opp.match_wins + opp.match_losses;
        if (totalMatches > 0) {
          oppMatchWinPct += Math.max(0.33, opp.match_wins / totalMatches);
          oppCount++;
        }
      }
    }
    
    const tiebreaker1 = oppCount > 0 ? oppMatchWinPct / oppCount : 0;
    
    // Game win percentage as tiebreaker2
    const totalGames = p.game_wins + p.game_losses;
    const tiebreaker2 = totalGames > 0 ? p.game_wins / totalGames : 0;
    
    updateParticipantStatsStmt.run({
      tournament_id: tournamentId,
      user_id: p.user_id,
      match_wins: p.match_wins,
      match_losses: p.match_losses,
      game_wins: p.game_wins,
      game_losses: p.game_losses,
      points: p.points,
      tiebreaker1,
      tiebreaker2,
    });
  }
}

/**
 * End a tournament and calculate final standings.
 */
export function endTournament(tournamentId: string): boolean {
  const tournament = getTournament(tournamentId);
  if (!tournament) return false;
  
  calculateTiebreakers(tournamentId);
  
  // Get final standings
  const participants = getParticipants(tournamentId);
  
  // Assign final standings
  for (let i = 0; i < participants.length; i++) {
    setFinalStandingStmt.run(i + 1, tournamentId, participants[i].user_id);
  }
  
  updateTournamentStmt.run({
    id: tournamentId,
    status: 'completed',
    started_at: tournament.started_at,
    ended_at: Date.now(),
    rounds: tournament.rounds,
    current_round: tournament.current_round,
  });
  
  return true;
}

/**
 * Cancel a tournament.
 */
export function cancelTournament(tournamentId: string): boolean {
  updateTournamentStmt.run({
    id: tournamentId,
    status: 'cancelled',
    started_at: null,
    ended_at: Date.now(),
    rounds: null,
    current_round: 0,
  });
  return true;
}

