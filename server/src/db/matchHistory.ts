/**
 * Match history database module for MTG Online-like functionality.
 * Provides match recording, replay storage, and statistics.
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

// Match history schema
db.exec(`
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  format TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  winner_id TEXT,
  status TEXT DEFAULT 'in_progress',
  turn_count INTEGER DEFAULT 0,
  is_tournament_match INTEGER DEFAULT 0,
  tournament_id TEXT,
  round INTEGER,
  replay_available INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS matches_game_id_idx ON matches(game_id);
CREATE INDEX IF NOT EXISTS matches_started_at_idx ON matches(started_at DESC);
CREATE INDEX IF NOT EXISTS matches_tournament_idx ON matches(tournament_id);
`);

// Match participants (who played in each match)
db.exec(`
CREATE TABLE IF NOT EXISTS match_participants (
  match_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  deck_name TEXT,
  commander_names TEXT,
  final_life INTEGER,
  place INTEGER,
  rating_change INTEGER DEFAULT 0,
  PRIMARY KEY (match_id, user_id),
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS match_participants_user_idx ON match_participants(user_id);
`);

// Match replays (compressed event logs for replay)
db.exec(`
CREATE TABLE IF NOT EXISTS match_replays (
  match_id TEXT PRIMARY KEY,
  events TEXT NOT NULL,
  initial_state TEXT,
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
);
`);

// Direct messages between users
db.exec(`
CREATE TABLE IF NOT EXISTS direct_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS dm_from_idx ON direct_messages(from_user_id);
CREATE INDEX IF NOT EXISTS dm_to_idx ON direct_messages(to_user_id);
CREATE INDEX IF NOT EXISTS dm_sent_at_idx ON direct_messages(sent_at DESC);
`);

// Prepared statements
const insertMatchStmt = db.prepare(`
  INSERT INTO matches (id, game_id, format, started_at, status)
  VALUES (@id, @game_id, @format, @started_at, @status)
`);

const updateMatchEndStmt = db.prepare(`
  UPDATE matches 
  SET ended_at = @ended_at, winner_id = @winner_id, status = @status, turn_count = @turn_count, replay_available = @replay_available
  WHERE id = @id
`);

const getMatchStmt = db.prepare(`
  SELECT * FROM matches WHERE id = ?
`);

const getMatchByGameIdStmt = db.prepare(`
  SELECT * FROM matches WHERE game_id = ?
`);

const listMatchesForUserStmt = db.prepare(`
  SELECT m.*, mp.deck_name, mp.commander_names, mp.final_life, mp.place, mp.rating_change
  FROM matches m
  JOIN match_participants mp ON m.id = mp.match_id
  WHERE mp.user_id = ?
  ORDER BY m.started_at DESC
  LIMIT ? OFFSET ?
`);

const listRecentMatchesStmt = db.prepare(`
  SELECT * FROM matches
  WHERE status = 'completed'
  ORDER BY ended_at DESC
  LIMIT ?
`);

const insertParticipantStmt = db.prepare(`
  INSERT OR REPLACE INTO match_participants (match_id, user_id, deck_name, commander_names, final_life, place, rating_change)
  VALUES (@match_id, @user_id, @deck_name, @commander_names, @final_life, @place, @rating_change)
`);

const getParticipantsStmt = db.prepare(`
  SELECT * FROM match_participants WHERE match_id = ?
`);

const insertReplayStmt = db.prepare(`
  INSERT OR REPLACE INTO match_replays (match_id, events, initial_state)
  VALUES (@match_id, @events, @initial_state)
`);

const getReplayStmt = db.prepare(`
  SELECT * FROM match_replays WHERE match_id = ?
`);

const insertDMStmt = db.prepare(`
  INSERT INTO direct_messages (from_user_id, to_user_id, message, sent_at)
  VALUES (@from_user_id, @to_user_id, @message, @sent_at)
`);

const getConversationStmt = db.prepare(`
  SELECT * FROM direct_messages
  WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
  ORDER BY sent_at DESC
  LIMIT ? OFFSET ?
`);

const markMessagesReadStmt = db.prepare(`
  UPDATE direct_messages SET read_at = ? WHERE to_user_id = ? AND from_user_id = ? AND read_at IS NULL
`);

const getUnreadCountStmt = db.prepare(`
  SELECT COUNT(*) as count FROM direct_messages WHERE to_user_id = ? AND read_at IS NULL
`);

const getRecentConversationsStmt = db.prepare(`
  SELECT DISTINCT 
    CASE WHEN from_user_id = ? THEN to_user_id ELSE from_user_id END as other_user_id,
    MAX(sent_at) as last_message_at
  FROM direct_messages
  WHERE from_user_id = ? OR to_user_id = ?
  GROUP BY other_user_id
  ORDER BY last_message_at DESC
  LIMIT ?
`);

// User statistics
const getUserStatsStmt = db.prepare(`
  SELECT 
    COUNT(*) as total_matches,
    SUM(CASE WHEN mp.place = 1 THEN 1 ELSE 0 END) as wins,
    SUM(CASE WHEN mp.place > 1 THEN 1 ELSE 0 END) as losses,
    AVG(mp.final_life) as avg_final_life
  FROM match_participants mp
  JOIN matches m ON mp.match_id = m.id
  WHERE mp.user_id = ? AND m.status = 'completed'
`);

// Types
export interface Match {
  id: string;
  game_id: string;
  format: string;
  started_at: number;
  ended_at?: number;
  winner_id?: string;
  status: 'in_progress' | 'completed' | 'abandoned';
  turn_count: number;
  is_tournament_match: boolean;
  tournament_id?: string;
  round?: number;
  replay_available: boolean;
}

export interface MatchParticipant {
  match_id: string;
  user_id: string;
  deck_name?: string;
  commander_names?: string;
  final_life?: number;
  place?: number;
  rating_change?: number;
}

export interface MatchWithParticipant extends Match, Omit<MatchParticipant, 'match_id'> {}

export interface MatchReplay {
  match_id: string;
  events: string;
  initial_state?: string;
}

export interface DirectMessage {
  id: number;
  from_user_id: string;
  to_user_id: string;
  message: string;
  sent_at: number;
  read_at?: number;
}

export interface UserStats {
  total_matches: number;
  wins: number;
  losses: number;
  avg_final_life: number;
}

export interface Conversation {
  other_user_id: string;
  last_message_at: number;
}

// API functions

/**
 * Start recording a new match.
 */
export function startMatch(gameId: string, format: string): Match {
  const id = `match_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  
  insertMatchStmt.run({
    id,
    game_id: gameId,
    format,
    started_at: now,
    status: 'in_progress',
  });
  
  return {
    id,
    game_id: gameId,
    format,
    started_at: now,
    status: 'in_progress',
    turn_count: 0,
    is_tournament_match: false,
    replay_available: false,
  };
}

/**
 * Add a participant to a match.
 */
export function addMatchParticipant(matchId: string, userId: string, deckName?: string, commanderNames?: string): boolean {
  try {
    insertParticipantStmt.run({
      match_id: matchId,
      user_id: userId,
      deck_name: deckName || null,
      commander_names: commanderNames || null,
      final_life: null,
      place: null,
      rating_change: 0,
    });
    return true;
  } catch (err) {
    debugError(1, '[DB] addMatchParticipant failed:', err);
    return false;
  }
}

/**
 * End a match and record results.
 */
export function endMatch(
  matchId: string,
  winnerId: string | null,
  turnCount: number,
  participants: Array<{ userId: string; finalLife: number; place: number; ratingChange?: number }>
): boolean {
  try {
    const now = Date.now();
    
    // Update match record
    updateMatchEndStmt.run({
      id: matchId,
      ended_at: now,
      winner_id: winnerId,
      status: 'completed',
      turn_count: turnCount,
      replay_available: 1,
    });
    
    // Update participant records
    for (const p of participants) {
      insertParticipantStmt.run({
        match_id: matchId,
        user_id: p.userId,
        deck_name: null,
        commander_names: null,
        final_life: p.finalLife,
        place: p.place,
        rating_change: p.ratingChange || 0,
      });
    }
    
    return true;
  } catch (err) {
    debugError(1, '[DB] endMatch failed:', err);
    return false;
  }
}

/**
 * Abandon a match (e.g., all players left).
 */
export function abandonMatch(matchId: string): boolean {
  try {
    updateMatchEndStmt.run({
      id: matchId,
      ended_at: Date.now(),
      winner_id: null,
      status: 'abandoned',
      turn_count: 0,
      replay_available: 0,
    });
    return true;
  } catch (err) {
    debugError(1, '[DB] abandonMatch failed:', err);
    return false;
  }
}

/**
 * Get match by ID.
 */
export function getMatch(matchId: string): Match | null {
  const row = getMatchStmt.get(matchId) as any;
  if (!row) return null;
  
  return {
    ...row,
    is_tournament_match: !!row.is_tournament_match,
    replay_available: !!row.replay_available,
  };
}

/**
 * Get match by game ID.
 */
export function getMatchByGameId(gameId: string): Match | null {
  const row = getMatchByGameIdStmt.get(gameId) as any;
  if (!row) return null;
  
  return {
    ...row,
    is_tournament_match: !!row.is_tournament_match,
    replay_available: !!row.replay_available,
  };
}

/**
 * Get participants for a match.
 */
export function getMatchParticipants(matchId: string): MatchParticipant[] {
  return getParticipantsStmt.all(matchId) as MatchParticipant[];
}

/**
 * Get match history for a user.
 */
export function getMatchHistory(userId: string, limit: number = 20, offset: number = 0): MatchWithParticipant[] {
  return listMatchesForUserStmt.all(userId, limit, offset) as MatchWithParticipant[];
}

/**
 * Get recent completed matches.
 */
export function getRecentMatches(limit: number = 20): Match[] {
  const rows = listRecentMatchesStmt.all(limit) as any[];
  return rows.map(row => ({
    ...row,
    is_tournament_match: !!row.is_tournament_match,
    replay_available: !!row.replay_available,
  }));
}

/**
 * Save match replay data.
 */
export function saveMatchReplay(matchId: string, events: any[], initialState?: any): boolean {
  try {
    insertReplayStmt.run({
      match_id: matchId,
      events: JSON.stringify(events),
      initial_state: initialState ? JSON.stringify(initialState) : null,
    });
    return true;
  } catch (err) {
    debugError(1, '[DB] saveMatchReplay failed:', err);
    return false;
  }
}

/**
 * Get match replay data.
 */
export function getMatchReplay(matchId: string): { events: any[]; initialState?: any } | null {
  const row = getReplayStmt.get(matchId) as MatchReplay | undefined;
  if (!row) return null;
  
  try {
    return {
      events: JSON.parse(row.events),
      initialState: row.initial_state ? JSON.parse(row.initial_state) : undefined,
    };
  } catch (err) {
    debugError(1, '[DB] getMatchReplay parse failed:', err);
    return null;
  }
}

/**
 * Get user statistics.
 */
export function getUserStats(userId: string): UserStats {
  const row = getUserStatsStmt.get(userId) as any;
  return {
    total_matches: row?.total_matches || 0,
    wins: row?.wins || 0,
    losses: row?.losses || 0,
    avg_final_life: row?.avg_final_life || 0,
  };
}

// Direct messaging functions

/**
 * Send a direct message to another user.
 */
export function sendDirectMessage(fromUserId: string, toUserId: string, message: string): number {
  const info = insertDMStmt.run({
    from_user_id: fromUserId,
    to_user_id: toUserId,
    message,
    sent_at: Date.now(),
  });
  return Number(info.lastInsertRowid);
}

/**
 * Get conversation between two users.
 */
export function getConversation(userId: string, otherUserId: string, limit: number = 50, offset: number = 0): DirectMessage[] {
  return getConversationStmt.all(userId, otherUserId, otherUserId, userId, limit, offset) as DirectMessage[];
}

/**
 * Mark messages as read.
 */
export function markMessagesRead(userId: string, fromUserId: string): number {
  const info = markMessagesReadStmt.run(Date.now(), userId, fromUserId);
  return info.changes;
}

/**
 * Get unread message count for a user.
 */
export function getUnreadMessageCount(userId: string): number {
  const row = getUnreadCountStmt.get(userId) as { count: number };
  return row?.count || 0;
}

/**
 * Get recent conversations for a user.
 */
export function getRecentConversations(userId: string, limit: number = 20): Conversation[] {
  return getRecentConversationsStmt.all(userId, userId, userId, limit) as Conversation[];
}

