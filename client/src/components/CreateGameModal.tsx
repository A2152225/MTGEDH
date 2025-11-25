import React, { useState, useEffect, useMemo } from 'react';
import { socket } from '../socket';

/**
 * Game formats supported by the application
 */
export type GameFormat = 'commander' | 'standard' | 'modern' | 'legacy' | 'vintage' | 'pauper';

/**
 * AI Strategy options matching the rules-engine AIStrategy enum
 */
export type AIStrategy = 'random' | 'basic' | 'aggressive' | 'defensive' | 'control' | 'combo';

/**
 * Saved deck summary for selection
 */
interface SavedDeckSummary {
  id: string;
  name: string;
  card_count: number;
  created_by_name?: string;
}

/**
 * Props for CreateGameModal
 */
interface CreateGameModalProps {
  open: boolean;
  onClose: () => void;
  onCreateGame: (config: GameCreationConfig) => void;
  savedDecks?: SavedDeckSummary[];
  onRefreshDecks?: () => void;
}

/**
 * Configuration for creating a new game
 */
export interface GameCreationConfig {
  gameId: string;
  playerName: string;
  format: GameFormat;
  startingLife: number;
  // AI opponent settings
  includeAI: boolean;
  aiName?: string;
  aiStrategy?: AIStrategy;
  aiDeckId?: string;
  // New: AI deck text for import
  aiDeckText?: string;
  aiDeckName?: string;
}

/**
 * Default starting life by format
 */
const DEFAULT_LIFE_BY_FORMAT: Record<GameFormat, number> = {
  commander: 40,
  standard: 20,
  modern: 20,
  legacy: 20,
  vintage: 20,
  pauper: 20,
};

/**
 * Format display names
 */
const FORMAT_NAMES: Record<GameFormat, string> = {
  commander: 'Commander (EDH)',
  standard: 'Standard',
  modern: 'Modern',
  legacy: 'Legacy',
  vintage: 'Vintage',
  pauper: 'Pauper',
};

/**
 * AI Strategy display names and descriptions
 */
const AI_STRATEGY_INFO: Record<AIStrategy, { name: string; description: string }> = {
  random: { name: 'Random', description: 'Makes completely random decisions' },
  basic: { name: 'Basic', description: 'Uses simple heuristics for decisions' },
  aggressive: { name: 'Aggressive', description: 'Prioritizes attacking and dealing damage' },
  defensive: { name: 'Defensive', description: 'Focuses on blocking and life preservation' },
  control: { name: 'Control', description: 'Focuses on controlling the board state' },
  combo: { name: 'Combo', description: 'Tries to assemble winning combos' },
};

/**
 * Modal for creating a new game with format, AI opponent, and deck selection
 */
export function CreateGameModal({ open, onClose, onCreateGame, savedDecks = [], onRefreshDecks }: CreateGameModalProps) {
  // Form state
  const [gameId, setGameId] = useState(() => `game_${Date.now().toString(36)}`);
  const [playerName, setPlayerName] = useState('Player');
  const [format, setFormat] = useState<GameFormat>('commander');
  const [startingLife, setStartingLife] = useState(40);
  
  // AI opponent settings
  const [includeAI, setIncludeAI] = useState(false);
  const [aiName, setAiName] = useState('AI Opponent');
  const [aiStrategy, setAiStrategy] = useState<AIStrategy>('basic');
  const [aiDeckId, setAiDeckId] = useState<string>('');
  
  // AI deck import mode
  const [aiDeckMode, setAiDeckMode] = useState<'select' | 'import'>('select');
  const [aiDeckText, setAiDeckText] = useState('');
  const [aiDeckName, setAiDeckName] = useState('');
  const [aiDeckFilter, setAiDeckFilter] = useState('');
  const [savingDeck, setSavingDeck] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Update starting life when format changes
  useEffect(() => {
    setStartingLife(DEFAULT_LIFE_BY_FORMAT[format]);
  }, [format]);

  // Generate new game ID when modal opens
  useEffect(() => {
    if (open) {
      setGameId(`game_${Date.now().toString(36)}`);
      // Reset save message when modal opens
      setSaveMessage(null);
    }
  }, [open]);

  // Filter saved decks
  const filteredDecks = useMemo(() => {
    const q = aiDeckFilter.trim().toLowerCase();
    if (!q) return savedDecks;
    return savedDecks.filter(d => d.name.toLowerCase().includes(q));
  }, [savedDecks, aiDeckFilter]);

  /**
   * Sanitize game ID to only allow alphanumeric, underscore, and hyphen
   */
  const sanitizeGameId = (input: string): string => {
    return input.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50);
  };

  /**
   * Save the imported deck to the server
   */
  const handleSaveImportedDeck = async () => {
    if (!aiDeckText.trim() || !aiDeckName.trim()) return;
    
    setSavingDeck(true);
    setSaveMessage(null);
    
    try {
      const response = await fetch('/api/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: aiDeckName.trim(),
          text: aiDeckText.trim(),
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setSaveMessage('✓ Deck saved successfully');
        // Refresh the deck list and wait a bit for it to complete
        if (onRefreshDecks) {
          onRefreshDecks();
        }
        // Switch to select mode and select the new deck after a short delay
        // to allow the deck list to refresh
        if (data.deckId) {
          setTimeout(() => {
            setAiDeckId(data.deckId);
            setAiDeckMode('select');
          }, 100);
        }
      } else {
        setSaveMessage('✗ Failed to save deck');
      }
    } catch (e) {
      setSaveMessage('✗ Failed to save deck');
    } finally {
      setSavingDeck(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Sanitize and validate game ID
    const sanitizedGameId = sanitizeGameId(gameId.trim()) || `game_${Date.now().toString(36)}`;
    
    const config: GameCreationConfig = {
      gameId: sanitizedGameId,
      playerName: playerName.trim() || 'Player',
      format,
      startingLife,
      includeAI,
      aiName: includeAI ? aiName.trim() || 'AI Opponent' : undefined,
      aiStrategy: includeAI ? aiStrategy : undefined,
      aiDeckId: includeAI && aiDeckMode === 'select' && aiDeckId ? aiDeckId : undefined,
      aiDeckText: includeAI && aiDeckMode === 'import' && aiDeckText.trim() ? aiDeckText.trim() : undefined,
      aiDeckName: includeAI && aiDeckMode === 'import' && aiDeckName.trim() ? aiDeckName.trim() : undefined,
    };

    onCreateGame(config);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: 8,
          padding: 24,
          maxWidth: 500,
          width: '90%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Create New Game</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: '#666',
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Game ID */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 14 }}>
              Game ID
            </label>
            <input
              type="text"
              value={gameId}
              onChange={(e) => setGameId(sanitizeGameId(e.target.value))}
              placeholder="Enter game ID"
              maxLength={50}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 4,
                border: '1px solid #ddd',
                fontSize: 14,
                boxSizing: 'border-box',
              }}
            />
            <div style={{ marginTop: 4, fontSize: 11, color: '#888' }}>
              Only letters, numbers, underscores, and hyphens allowed
            </div>
          </div>

          {/* Player Name */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 14 }}>
              Your Name
            </label>
            <input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your name"
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 4,
                border: '1px solid #ddd',
                fontSize: 14,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Format Selection */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 14 }}>
              Game Format
            </label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as GameFormat)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 4,
                border: '1px solid #ddd',
                fontSize: 14,
                boxSizing: 'border-box',
                backgroundColor: '#fff',
              }}
            >
              {Object.entries(FORMAT_NAMES).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
            {format === 'commander' && (
              <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
                ⚔️ Commander rules: 100 cards, singleton, color identity restrictions
              </div>
            )}
          </div>

          {/* Starting Life */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 14 }}>
              Starting Life
            </label>
            <input
              type="number"
              value={startingLife}
              onChange={(e) => setStartingLife(parseInt(e.target.value) || 20)}
              min={1}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 4,
                border: '1px solid #ddd',
                fontSize: 14,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* AI Opponent Section */}
          <div
            style={{
              marginBottom: 16,
              padding: 16,
              backgroundColor: includeAI ? '#f0f7ff' : '#f9f9f9',
              borderRadius: 6,
              border: includeAI ? '1px solid #3b82f6' : '1px solid #eee',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: 14,
              }}
            >
              <input
                type="checkbox"
                checked={includeAI}
                onChange={(e) => setIncludeAI(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              <span>🤖 Add AI Opponent</span>
            </label>

            {includeAI && (
              <div style={{ marginTop: 16 }}>
                {/* AI Name */}
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#444' }}>
                    AI Name
                  </label>
                  <input
                    type="text"
                    value={aiName}
                    onChange={(e) => setAiName(e.target.value)}
                    placeholder="AI Opponent"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 4,
                      border: '1px solid #ddd',
                      fontSize: 14,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* AI Strategy */}
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#444' }}>
                    AI Strategy
                  </label>
                  <select
                    value={aiStrategy}
                    onChange={(e) => setAiStrategy(e.target.value as AIStrategy)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 4,
                      border: '1px solid #ddd',
                      fontSize: 14,
                      boxSizing: 'border-box',
                      backgroundColor: '#fff',
                    }}
                  >
                    {Object.entries(AI_STRATEGY_INFO).map(([key, info]) => (
                      <option key={key} value={key}>
                        {info.name}
                      </option>
                    ))}
                  </select>
                  <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
                    {AI_STRATEGY_INFO[aiStrategy].description}
                  </div>
                </div>

                {/* AI Deck Selection */}
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: '#444' }}>
                    AI Deck
                  </label>
                  
                  {/* Mode Toggle */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <button
                      type="button"
                      onClick={() => setAiDeckMode('select')}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 4,
                        border: aiDeckMode === 'select' ? '2px solid #3b82f6' : '1px solid #ddd',
                        backgroundColor: aiDeckMode === 'select' ? '#eff6ff' : '#fff',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: aiDeckMode === 'select' ? 500 : 400,
                      }}
                    >
                      📁 Select Saved Deck
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiDeckMode('import')}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 4,
                        border: aiDeckMode === 'import' ? '2px solid #3b82f6' : '1px solid #ddd',
                        backgroundColor: aiDeckMode === 'import' ? '#eff6ff' : '#fff',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: aiDeckMode === 'import' ? 500 : 400,
                      }}
                    >
                      📝 Import Deck
                    </button>
                  </div>

                  {/* Select Saved Deck Mode */}
                  {aiDeckMode === 'select' && (
                    <div>
                      <input
                        type="text"
                        value={aiDeckFilter}
                        onChange={(e) => setAiDeckFilter(e.target.value)}
                        placeholder="Filter decks..."
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          borderRadius: 4,
                          border: '1px solid #ddd',
                          fontSize: 12,
                          boxSizing: 'border-box',
                          marginBottom: 6,
                        }}
                      />
                      <select
                        value={aiDeckId}
                        onChange={(e) => setAiDeckId(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          borderRadius: 4,
                          border: '1px solid #ddd',
                          fontSize: 14,
                          boxSizing: 'border-box',
                          backgroundColor: '#fff',
                        }}
                      >
                        <option value="">-- Select a saved deck --</option>
                        {filteredDecks.map((deck) => (
                          <option key={deck.id} value={deck.id}>
                            {deck.name} ({deck.card_count} cards)
                          </option>
                        ))}
                      </select>
                      {savedDecks.length === 0 && (
                        <div style={{ marginTop: 4, fontSize: 12, color: '#f59e0b' }}>
                          ⚠️ No saved decks available. Use "Import Deck" to add one.
                        </div>
                      )}
                      {savedDecks.length > 0 && filteredDecks.length === 0 && aiDeckFilter && (
                        <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
                          No decks match your filter.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Import Deck Mode */}
                  {aiDeckMode === 'import' && (
                    <div>
                      <input
                        type="text"
                        value={aiDeckName}
                        onChange={(e) => setAiDeckName(e.target.value)}
                        placeholder="Deck name"
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          borderRadius: 4,
                          border: '1px solid #ddd',
                          fontSize: 14,
                          boxSizing: 'border-box',
                          marginBottom: 6,
                        }}
                      />
                      <textarea
                        value={aiDeckText}
                        onChange={(e) => setAiDeckText(e.target.value)}
                        placeholder="Paste decklist here (e.g., '4 Lightning Bolt', '1 Sol Ring')"
                        style={{
                          width: '100%',
                          height: 120,
                          padding: '8px 12px',
                          borderRadius: 4,
                          border: '1px solid #ddd',
                          fontSize: 12,
                          boxSizing: 'border-box',
                          resize: 'vertical',
                          fontFamily: 'monospace',
                        }}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                        <input
                          type="file"
                          accept=".txt,text/plain"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const content = await file.text();
                            setAiDeckText(content);
                            // Use filename as deck name if not set
                            if (!aiDeckName) {
                              setAiDeckName(file.name.replace(/\.txt$/i, ''));
                            }
                          }}
                          style={{ fontSize: 11 }}
                        />
                        <button
                          type="button"
                          onClick={handleSaveImportedDeck}
                          disabled={!aiDeckText.trim() || !aiDeckName.trim() || savingDeck}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 4,
                            border: 'none',
                            backgroundColor: (!aiDeckText.trim() || !aiDeckName.trim() || savingDeck) ? '#ccc' : '#10b981',
                            color: '#fff',
                            cursor: (!aiDeckText.trim() || !aiDeckName.trim() || savingDeck) ? 'not-allowed' : 'pointer',
                            fontSize: 12,
                          }}
                        >
                          {savingDeck ? 'Saving...' : 'Save to Server'}
                        </button>
                      </div>
                      {saveMessage && (
                        <div style={{ marginTop: 4, fontSize: 12, color: saveMessage.startsWith('✓') ? '#10b981' : '#ef4444' }}>
                          {saveMessage}
                        </div>
                      )}
                      {aiDeckText.trim() && (
                        <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
                          📋 Deck will be imported when the game starts
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Submit Buttons */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 24 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '10px 20px',
                borderRadius: 4,
                border: '1px solid #ddd',
                backgroundColor: '#fff',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                padding: '10px 20px',
                borderRadius: 4,
                border: 'none',
                backgroundColor: '#3b82f6',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              Create Game
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateGameModal;
