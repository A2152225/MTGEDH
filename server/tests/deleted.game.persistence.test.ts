import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame, gameExistsInDb, listGames } from '../src/db/index';
import GameManager from '../src/GameManager';

// Helper to clean up test games from the database (synchronous operations)
function cleanupTestGames(gameIds: string[]) {
  for (const gameId of gameIds) {
    try {
      deleteGame(gameId);
      GameManager.deleteGame(gameId);
    } catch {
      // Ignore cleanup errors
    }
  }
}

describe('Deleted game persistence', () => {
  const testGameIds: string[] = [];
  
  beforeEach(async () => {
    // Ensure DB is initialized before each test
    try {
      await initDb();
    } catch {
      // May already be initialized
    }
  });
  
  afterEach(() => {
    // Clean up any test games created during tests
    cleanupTestGames(testGameIds);
    testGameIds.length = 0;
  });

  it('should return true for gameExistsInDb when game exists', async () => {
    const gameId = `test_game_exists_${Date.now()}`;
    testGameIds.push(gameId);
    
    // Create a game in the database
    createGameIfNotExists(gameId, 'commander', 40);
    
    // Check that it exists
    expect(gameExistsInDb(gameId)).toBe(true);
  });

  it('should return false for gameExistsInDb when game does not exist', async () => {
    const gameId = `test_game_not_exists_${Date.now()}`;
    
    // Check that a non-existent game returns false
    expect(gameExistsInDb(gameId)).toBe(false);
  });

  it('should return false for gameExistsInDb after game is deleted', async () => {
    const gameId = `test_game_deleted_${Date.now()}`;
    testGameIds.push(gameId);
    
    // Create a game in the database
    createGameIfNotExists(gameId, 'commander', 40);
    
    // Verify it exists
    expect(gameExistsInDb(gameId)).toBe(true);
    
    // Delete the game
    const deleted = deleteGame(gameId);
    expect(deleted).toBe(true);
    
    // Verify it no longer exists
    expect(gameExistsInDb(gameId)).toBe(false);
  });

  it('should not recreate a deleted game via GameManager.ensureGame', async () => {
    const gameId = `test_ensure_deleted_${Date.now()}`;
    testGameIds.push(gameId);
    
    // Create a game via GameManager
    const game1 = GameManager.createGame({ id: gameId });
    expect(game1).toBeDefined();
    expect(GameManager.getGame(gameId)).toBeDefined();
    
    // Verify it exists in database
    expect(gameExistsInDb(gameId)).toBe(true);
    
    // Delete the game from both memory and database
    GameManager.deleteGame(gameId);
    deleteGame(gameId);
    
    // Verify it's deleted from memory
    expect(GameManager.getGame(gameId)).toBeUndefined();
    
    // Verify it's deleted from database
    expect(gameExistsInDb(gameId)).toBe(false);
    
    // Now try to ensureGame - it should NOT recreate the game
    const game2 = GameManager.ensureGame(gameId);
    expect(game2).toBeUndefined();
    
    // Verify the game was not re-added to memory
    expect(GameManager.getGame(gameId)).toBeUndefined();
    
    // Verify the game was not recreated in database
    expect(gameExistsInDb(gameId)).toBe(false);
  });

  it('should correctly recreate an existing game via GameManager.ensureGame after server restart simulation', async () => {
    const gameId = `test_recreate_existing_${Date.now()}`;
    testGameIds.push(gameId);
    
    // Create a game via GameManager
    const game1 = GameManager.createGame({ id: gameId });
    expect(game1).toBeDefined();
    
    // Verify it exists in database
    expect(gameExistsInDb(gameId)).toBe(true);
    
    // Simulate server restart by clearing only in-memory state
    GameManager.deleteGame(gameId); // Only removes from memory, not DB
    
    // Verify it's removed from memory
    expect(GameManager.getGame(gameId)).toBeUndefined();
    
    // Verify it still exists in database (simulating data persisted across restart)
    expect(gameExistsInDb(gameId)).toBe(true);
    
    // Now ensureGame should recreate the game from the database
    const game2 = GameManager.ensureGame(gameId);
    expect(game2).toBeDefined();
    
    // Verify the game is back in memory
    expect(GameManager.getGame(gameId)).toBeDefined();
  });

  it('should not appear in listGames after deletion', async () => {
    const gameId = `test_list_after_delete_${Date.now()}`;
    testGameIds.push(gameId);
    
    // Create a game
    createGameIfNotExists(gameId, 'commander', 40);
    
    // Verify it appears in listGames
    let games = listGames();
    expect(games.some(g => g.game_id === gameId)).toBe(true);
    
    // Delete the game
    deleteGame(gameId);
    
    // Verify it no longer appears in listGames
    games = listGames();
    expect(games.some(g => g.game_id === gameId)).toBe(false);
  });
});
