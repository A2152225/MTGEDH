/**
 * User accounts database module for MTG Online-like functionality.
 * Provides user registration, authentication, profiles, and friend lists.
 */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'mtgedh.sqlite');
const db = new Database(DB_FILE);

db.pragma('journal_mode = WAL');

// User accounts schema
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT,
  created_at INTEGER NOT NULL,
  last_login INTEGER,
  avatar_url TEXT,
  status TEXT DEFAULT 'offline',
  bio TEXT,
  rating INTEGER DEFAULT 1500,
  games_played INTEGER DEFAULT 0,
  games_won INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS users_username_idx ON users(username);
CREATE INDEX IF NOT EXISTS users_rating_idx ON users(rating DESC);
`);

// Friend relationships schema
db.exec(`
CREATE TABLE IF NOT EXISTS friends (
  user_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS friends_user_idx ON friends(user_id);
CREATE INDEX IF NOT EXISTS friends_friend_idx ON friends(friend_id);
`);

// Session tokens for authentication
db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
`);

// Prepared statements
const insertUserStmt = db.prepare(`
  INSERT INTO users (id, username, display_name, password_hash, email, created_at)
  VALUES (@id, @username, @display_name, @password_hash, @email, @created_at)
`);

const getUserByUsernameStmt = db.prepare(`
  SELECT * FROM users WHERE username = ?
`);

const getUserByIdStmt = db.prepare(`
  SELECT * FROM users WHERE id = ?
`);

const updateUserStmt = db.prepare(`
  UPDATE users 
  SET display_name = @display_name, avatar_url = @avatar_url, bio = @bio, last_login = @last_login
  WHERE id = @id
`);

const updateUserStatusStmt = db.prepare(`
  UPDATE users SET status = ? WHERE id = ?
`);

const updateUserStatsStmt = db.prepare(`
  UPDATE users SET games_played = games_played + 1, games_won = games_won + ? WHERE id = ?
`);

const insertSessionStmt = db.prepare(`
  INSERT INTO sessions (token, user_id, created_at, expires_at)
  VALUES (@token, @user_id, @created_at, @expires_at)
`);

const getSessionStmt = db.prepare(`
  SELECT * FROM sessions WHERE token = ? AND expires_at > ?
`);

const deleteSessionStmt = db.prepare(`
  DELETE FROM sessions WHERE token = ?
`);

const deleteExpiredSessionsStmt = db.prepare(`
  DELETE FROM sessions WHERE expires_at < ?
`);

const insertFriendRequestStmt = db.prepare(`
  INSERT OR REPLACE INTO friends (user_id, friend_id, status, created_at)
  VALUES (@user_id, @friend_id, @status, @created_at)
`);

const getFriendsStmt = db.prepare(`
  SELECT u.id, u.username, u.display_name, u.avatar_url, u.status, u.rating, u.games_played, u.games_won, f.status as friend_status
  FROM friends f
  JOIN users u ON (f.friend_id = u.id)
  WHERE f.user_id = ? AND f.status = 'accepted'
`);

const getPendingFriendRequestsStmt = db.prepare(`
  SELECT u.id, u.username, u.display_name, u.avatar_url, f.created_at
  FROM friends f
  JOIN users u ON (f.user_id = u.id)
  WHERE f.friend_id = ? AND f.status = 'pending'
`);

const acceptFriendRequestStmt = db.prepare(`
  UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?
`);

const deleteFriendStmt = db.prepare(`
  DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
`);

const searchUsersStmt = db.prepare(`
  SELECT id, username, display_name, avatar_url, rating, games_played, games_won
  FROM users
  WHERE username LIKE ? OR display_name LIKE ?
  LIMIT 20
`);

const getLeaderboardStmt = db.prepare(`
  SELECT id, username, display_name, avatar_url, rating, games_played, games_won
  FROM users
  WHERE games_played >= 5
  ORDER BY rating DESC
  LIMIT ?
`);

// Types
export interface User {
  id: string;
  username: string;
  display_name: string;
  password_hash?: string; // Only for internal use
  email?: string;
  created_at: number;
  last_login?: number;
  avatar_url?: string;
  status: 'online' | 'offline' | 'in_game' | 'away';
  bio?: string;
  rating: number;
  games_played: number;
  games_won: number;
}

export interface PublicUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  status: string;
  rating: number;
  games_played: number;
  games_won: number;
}

export interface Friend extends PublicUser {
  friend_status: string;
}

export interface PendingFriendRequest {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  created_at: number;
}

export interface Session {
  token: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

// Helper functions
function generateId(): string {
  return `user_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':');
  const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(testHash, 'hex'));
}

// API functions

/**
 * Register a new user account.
 */
export function registerUser(username: string, password: string, displayName?: string, email?: string): User | null {
  try {
    const id = generateId();
    const passwordHash = hashPassword(password);
    const now = Date.now();
    
    insertUserStmt.run({
      id,
      username: username.toLowerCase(),
      display_name: displayName || username,
      password_hash: passwordHash,
      email: email || null,
      created_at: now,
    });
    
    const user = getUserByIdStmt.get(id) as User | undefined;
    if (user) {
      delete user.password_hash;
      return user;
    }
    return null;
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return null; // Username already exists
    }
    console.error('[DB] registerUser failed:', err);
    throw err;
  }
}

/**
 * Login and create a session token.
 */
export function loginUser(username: string, password: string): { user: User; token: string } | null {
  const user = getUserByUsernameStmt.get(username.toLowerCase()) as User | undefined;
  if (!user || !user.password_hash) {
    return null;
  }
  
  if (!verifyPassword(password, user.password_hash)) {
    return null;
  }
  
  // Create session
  const token = generateSessionToken();
  const now = Date.now();
  const expiresAt = now + (7 * 24 * 60 * 60 * 1000); // 7 days
  
  insertSessionStmt.run({
    token,
    user_id: user.id,
    created_at: now,
    expires_at: expiresAt,
  });
  
  // Update last login
  updateUserStmt.run({
    id: user.id,
    display_name: user.display_name,
    avatar_url: user.avatar_url || null,
    bio: user.bio || null,
    last_login: now,
  });
  
  // Update status to online
  updateUserStatusStmt.run('online', user.id);
  
  // Remove password hash before returning
  delete user.password_hash;
  
  return { user, token };
}

/**
 * Validate a session token and return the user.
 */
export function validateSession(token: string): User | null {
  const now = Date.now();
  const session = getSessionStmt.get(token, now) as Session | undefined;
  
  if (!session) {
    return null;
  }
  
  const user = getUserByIdStmt.get(session.user_id) as User | undefined;
  if (user) {
    delete user.password_hash;
    return user;
  }
  return null;
}

/**
 * Logout and invalidate session.
 */
export function logoutUser(token: string): boolean {
  const session = getSessionStmt.get(token, Date.now()) as Session | undefined;
  if (session) {
    updateUserStatusStmt.run('offline', session.user_id);
  }
  const info = deleteSessionStmt.run(token);
  return info.changes > 0;
}

/**
 * Clean up expired sessions.
 */
export function cleanupExpiredSessions(): number {
  const info = deleteExpiredSessionsStmt.run(Date.now());
  return info.changes;
}

/**
 * Get user by ID (public info only).
 */
export function getUserById(id: string): PublicUser | null {
  const user = getUserByIdStmt.get(id) as User | undefined;
  if (!user) return null;
  
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    status: user.status,
    rating: user.rating,
    games_played: user.games_played,
    games_won: user.games_won,
  };
}

/**
 * Get user by username (public info only).
 */
export function getUserByUsername(username: string): PublicUser | null {
  const user = getUserByUsernameStmt.get(username.toLowerCase()) as User | undefined;
  if (!user) return null;
  
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    status: user.status,
    rating: user.rating,
    games_played: user.games_played,
    games_won: user.games_won,
  };
}

/**
 * Update user profile.
 */
export function updateUserProfile(userId: string, updates: { display_name?: string; avatar_url?: string; bio?: string }): boolean {
  const user = getUserByIdStmt.get(userId) as User | undefined;
  if (!user) return false;
  
  const info = updateUserStmt.run({
    id: userId,
    display_name: updates.display_name || user.display_name,
    avatar_url: updates.avatar_url ?? user.avatar_url ?? null,
    bio: updates.bio ?? user.bio ?? null,
    last_login: user.last_login,
  });
  
  return info.changes > 0;
}

/**
 * Update user online status.
 */
export function setUserStatus(userId: string, status: 'online' | 'offline' | 'in_game' | 'away'): boolean {
  const info = updateUserStatusStmt.run(status, userId);
  return info.changes > 0;
}

/**
 * Update user stats after a game.
 */
export function updateUserStats(userId: string, won: boolean): boolean {
  const info = updateUserStatsStmt.run(won ? 1 : 0, userId);
  return info.changes > 0;
}

/**
 * Send a friend request.
 */
export function sendFriendRequest(fromUserId: string, toUserId: string): boolean {
  if (fromUserId === toUserId) return false;
  
  try {
    insertFriendRequestStmt.run({
      user_id: fromUserId,
      friend_id: toUserId,
      status: 'pending',
      created_at: Date.now(),
    });
    return true;
  } catch (err) {
    console.error('[DB] sendFriendRequest failed:', err);
    return false;
  }
}

/**
 * Accept a friend request.
 */
export function acceptFriendRequest(userId: string, fromUserId: string): boolean {
  try {
    // Update the incoming request to accepted
    const info = acceptFriendRequestStmt.run(fromUserId, userId);
    if (info.changes === 0) return false;
    
    // Create the reciprocal friendship
    insertFriendRequestStmt.run({
      user_id: userId,
      friend_id: fromUserId,
      status: 'accepted',
      created_at: Date.now(),
    });
    
    return true;
  } catch (err) {
    console.error('[DB] acceptFriendRequest failed:', err);
    return false;
  }
}

/**
 * Remove a friend or decline a friend request.
 */
export function removeFriend(userId: string, friendId: string): boolean {
  const info = deleteFriendStmt.run(userId, friendId, friendId, userId);
  return info.changes > 0;
}

/**
 * Get user's friend list.
 */
export function getFriends(userId: string): Friend[] {
  return getFriendsStmt.all(userId) as Friend[];
}

/**
 * Get pending friend requests for a user.
 */
export function getPendingFriendRequests(userId: string): PendingFriendRequest[] {
  return getPendingFriendRequestsStmt.all(userId) as PendingFriendRequest[];
}

/**
 * Search for users by username or display name.
 */
export function searchUsers(query: string): PublicUser[] {
  const searchTerm = `%${query}%`;
  return searchUsersStmt.all(searchTerm, searchTerm) as PublicUser[];
}

/**
 * Get leaderboard (top players by rating).
 */
export function getLeaderboard(limit: number = 50): PublicUser[] {
  return getLeaderboardStmt.all(limit) as PublicUser[];
}

// Guest user support (for playing without an account)
const guestUsers = new Map<string, { id: string; display_name: string; created_at: number }>();

/**
 * Create a temporary guest user.
 */
export function createGuestUser(displayName: string): { id: string; display_name: string; isGuest: true } {
  const id = `guest_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const guest = {
    id,
    display_name: displayName || `Guest_${id.slice(-6)}`,
    created_at: Date.now(),
  };
  guestUsers.set(id, guest);
  return { ...guest, isGuest: true as const };
}

/**
 * Check if a user ID is a guest.
 */
export function isGuestUser(userId: string): boolean {
  return userId.startsWith('guest_') || guestUsers.has(userId);
}

/**
 * Clean up old guest users (older than 24 hours).
 */
export function cleanupGuestUsers(): number {
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  let removed = 0;
  for (const [id, guest] of guestUsers.entries()) {
    if (guest.created_at < cutoff) {
      guestUsers.delete(id);
      removed++;
    }
  }
  return removed;
}
