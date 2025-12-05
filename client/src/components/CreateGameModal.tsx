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
 * House rules configuration for optional game variants.
 * Multiple rules can be enabled simultaneously (default: all off).
 * 
 * Note: Free first mulligan is now BASELINE for multiplayer games (3+ players)
 * as per official Commander rules (rule 103.5a). It is no longer a house rule option.
 */
export interface HouseRulesConfig {
  /** @deprecated Free first mulligan is now baseline for multiplayer. This flag is kept for backward compatibility. */
  freeFirstMulligan: boolean;
  /** Free mulligan if opening hand has no lands or all lands */
  freeMulliganNoLandsOrAllLands: boolean;
  /** Any commander damage counts (not just combat damage) */
  anyCommanderDamageCountsAsCommanderDamage: boolean;
  /** If all human players mulligan, decrease mulligan count by 1 for each */
  groupMulliganDiscount: boolean;
  /** Enable Archenemy variant (NYI) */
  enableArchenemy: boolean;
  /** Enable Planechase variant (NYI) */
  enablePlanechase: boolean;
  /** Custom rule suggestion text for review */
  customRuleSuggestion: string;
}

/**
 * Configuration for a single AI opponent
 */
export interface AIOpponentConfig {
  name: string;
  strategy: AIStrategy;
  deckId?: string;
  deckText?: string;
  deckName?: string;
}

/**
 * Configuration for creating a new game
 */
export interface GameCreationConfig {
  gameId: string;
  playerName: string;
  format: GameFormat;
  startingLife: number;
  // AI opponent settings - support multiple AI opponents
  includeAI: boolean;
  aiOpponents?: AIOpponentConfig[];
  // Legacy single AI opponent fields (for backward compatibility)
  aiName?: string;
  aiStrategy?: AIStrategy;
  aiDeckId?: string;
  aiDeckText?: string;
  aiDeckName?: string;
  // House rules configuration
  houseRules?: Partial<HouseRulesConfig>;
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
 * Maximum number of AI opponents allowed
 */
const MAX_AI_OPPONENTS = 8;

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
  // Load player name from localStorage for persistence across sessions
  const [playerName, setPlayerName] = useState(() => {
    try {
      return localStorage.getItem('mtgedh:playerName') || 'Player';
    } catch {
      return 'Player';
    }
  });
  const [format, setFormat] = useState<GameFormat>('commander');
  const [startingLife, setStartingLife] = useState(40);
  
  // AI opponent settings - now supports multiple AI opponents
  const [aiOpponents, setAiOpponents] = useState<Array<{
    id: string;
    name: string;
    strategy: AIStrategy;
    deckId: string;
    deckMode: 'select' | 'import';
    deckText: string;
    deckName: string;
    expanded: boolean;
  }>>([]);
  
  // Deck filter for AI deck selection
  const [aiDeckFilter, setAiDeckFilter] = useState('');
  const [savingDeck, setSavingDeck] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // House rules state (freeFirstMulligan removed - now baseline for multiplayer)
  const [showHouseRules, setShowHouseRules] = useState(false);
  const [freeMulliganNoLandsOrAllLands, setFreeMulliganNoLandsOrAllLands] = useState(false);
  const [anyCommanderDamageCountsAsCommanderDamage, setAnyCommanderDamageCountsAsCommanderDamage] = useState(false);
  const [groupMulliganDiscount, setGroupMulliganDiscount] = useState(false);
  const [enableArchenemy, setEnableArchenemy] = useState(false);
  const [enablePlanechase, setEnablePlanechase] = useState(false);
  const [customRuleSuggestion, setCustomRuleSuggestion] = useState('');
  const [submittingCustomRule, setSubmittingCustomRule] = useState(false);
  const [customRuleMessage, setCustomRuleMessage] = useState<string | null>(null);

  /**
   * Add a new AI opponent to the list (up to MAX_AI_OPPONENTS)
   */
  const addAiOpponent = () => {
    if (aiOpponents.length >= MAX_AI_OPPONENTS) {
      return; // Limit reached
    }
    const newId = `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const opponentNumber = aiOpponents.length + 1;
    setAiOpponents([...aiOpponents, {
      id: newId,
      name: `AI Opponent ${opponentNumber}`,
      strategy: 'basic' as AIStrategy,
      deckId: '',
      deckMode: 'select',
      deckText: '',
      deckName: '',
      expanded: true, // Start expanded for new opponents
    }]);
  };

  /**
   * Remove an AI opponent from the list
   */
  const removeAiOpponent = (id: string) => {
    setAiOpponents(aiOpponents.filter(ai => ai.id !== id));
  };

  /**
   * Update a specific AI opponent's configuration
   */
  const updateAiOpponent = (id: string, updates: Partial<typeof aiOpponents[0]>) => {
    setAiOpponents(aiOpponents.map(ai => 
      ai.id === id ? { ...ai, ...updates } : ai
    ));
  };

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

  // Check if we've reached the maximum number of AI opponents
  const isAtMaxAiCapacity = aiOpponents.length >= MAX_AI_OPPONENTS;

  /**
   * Check if an AI opponent has a valid deck configured
   */
  const aiHasDeck = (ai: typeof aiOpponents[0]): boolean => {
    if (ai.deckMode === 'select' && ai.deckId) return true;
    if (ai.deckMode === 'import' && ai.deckText.trim()) return true;
    return false;
  };

  /**
   * Sanitize game ID to only allow alphanumeric, underscore, and hyphen
   */
  const sanitizeGameId = (input: string): string => {
    return input.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50);
  };

  /**
   * Save an AI opponent's imported deck to the server
   */
  const handleSaveAiDeck = async (aiId: string) => {
    const ai = aiOpponents.find(a => a.id === aiId);
    if (!ai || !ai.deckText.trim() || !ai.deckName.trim()) return;
    
    setSavingDeck(true);
    setSaveMessage(null);
    
    try {
      const response = await fetch('/api/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: ai.deckName.trim(),
          text: ai.deckText.trim(),
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setSaveMessage('✓ Deck saved successfully');
        if (onRefreshDecks) {
          onRefreshDecks();
        }
        // Update this AI to use the saved deck
        if (data.deckId) {
          setTimeout(() => {
            updateAiOpponent(aiId, { 
              deckId: data.deckId, 
              deckMode: 'select' 
            });
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

  /**
   * Submit a custom house rule suggestion to the server for review
   */
  const handleSubmitCustomRule = async () => {
    if (!customRuleSuggestion.trim()) return;
    
    setSubmittingCustomRule(true);
    setCustomRuleMessage(null);
    
    try {
      const response = await fetch('/api/house-rule-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggestion: customRuleSuggestion.trim(),
          submittedAt: new Date().toISOString(),
        }),
      });
      
      if (response.ok) {
        setCustomRuleMessage('✓ Suggestion submitted for review. Thank you!');
        setCustomRuleSuggestion('');
      } else {
        setCustomRuleMessage('✗ Failed to submit suggestion');
      }
    } catch (e) {
      setCustomRuleMessage('✗ Failed to submit suggestion');
    } finally {
      setSubmittingCustomRule(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate AI opponents have decks
    const aiOpponentsWithoutDecks = aiOpponents.filter(ai => {
      const hasSelectedDeck = ai.deckMode === 'select' && ai.deckId;
      const hasImportedDeck = ai.deckMode === 'import' && ai.deckText.trim();
      return !hasSelectedDeck && !hasImportedDeck;
    });
    
    if (aiOpponentsWithoutDecks.length > 0) {
      const missingNames = aiOpponentsWithoutDecks.map(ai => ai.name || 'AI Opponent').join(', ');
      alert(`Cannot create game: The following AI opponent(s) need a deck: ${missingNames}\n\nPlease select or import a deck for each AI opponent.`);
      return;
    }
    
    // Sanitize and validate game ID
    const sanitizedGameId = sanitizeGameId(gameId.trim()) || `game_${Date.now().toString(36)}`;
    
    // Save player name to localStorage for future sessions
    const finalPlayerName = playerName.trim() || 'Player';
    try {
      localStorage.setItem('mtgedh:playerName', finalPlayerName);
    } catch {
      // Ignore storage errors
    }

    // Build house rules config (only include enabled rules)
    // Note: freeFirstMulligan is now baseline for multiplayer, so we don't include it here
    const houseRules: Partial<HouseRulesConfig> = {};
    if (freeMulliganNoLandsOrAllLands) houseRules.freeMulliganNoLandsOrAllLands = true;
    if (anyCommanderDamageCountsAsCommanderDamage) houseRules.anyCommanderDamageCountsAsCommanderDamage = true;
    if (groupMulliganDiscount) houseRules.groupMulliganDiscount = true;
    if (enableArchenemy) houseRules.enableArchenemy = true;
    if (enablePlanechase) houseRules.enablePlanechase = true;
    
    // Build AI opponents configuration
    const aiOpponentsConfig: AIOpponentConfig[] = aiOpponents.map(ai => ({
      name: ai.name.trim() || 'AI Opponent',
      strategy: ai.strategy,
      deckId: ai.deckMode === 'select' && ai.deckId ? ai.deckId : undefined,
      deckText: ai.deckMode === 'import' && ai.deckText.trim() ? ai.deckText.trim() : undefined,
      deckName: ai.deckMode === 'import' && ai.deckName.trim() ? ai.deckName.trim() : undefined,
    }));
    
    const hasAI = aiOpponents.length > 0;
    
    // For backward compatibility, also include legacy single AI fields if only one AI
    const config: GameCreationConfig = {
      gameId: sanitizedGameId,
      playerName: finalPlayerName,
      format,
      startingLife,
      includeAI: hasAI,
      aiOpponents: hasAI ? aiOpponentsConfig : undefined,
      // Legacy fields for backward compatibility with single AI
      aiName: hasAI && aiOpponents.length === 1 ? aiOpponentsConfig[0].name : undefined,
      aiStrategy: hasAI && aiOpponents.length === 1 ? aiOpponentsConfig[0].strategy : undefined,
      aiDeckId: hasAI && aiOpponents.length === 1 ? aiOpponentsConfig[0].deckId : undefined,
      aiDeckText: hasAI && aiOpponents.length === 1 ? aiOpponentsConfig[0].deckText : undefined,
      aiDeckName: hasAI && aiOpponents.length === 1 ? aiOpponentsConfig[0].deckName : undefined,
      // Include house rules only if any are enabled
      houseRules: Object.keys(houseRules).length > 0 ? houseRules : undefined,
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

          {/* AI Opponents Section */}
          <div
            style={{
              marginBottom: 16,
              padding: 16,
              backgroundColor: aiOpponents.length > 0 ? '#f0f7ff' : '#f9f9f9',
              borderRadius: 6,
              border: aiOpponents.length > 0 ? '1px solid #3b82f6' : '1px solid #eee',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: aiOpponents.length > 0 ? 16 : 0,
              }}
            >
              <div style={{ fontWeight: 500, fontSize: 14 }}>
                🤖 AI Opponents ({aiOpponents.length}/{MAX_AI_OPPONENTS})
              </div>
              <button
                type="button"
                onClick={addAiOpponent}
                disabled={isAtMaxAiCapacity}
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: 'none',
                  backgroundColor: isAtMaxAiCapacity ? '#9ca3af' : '#3b82f6',
                  color: '#fff',
                  cursor: isAtMaxAiCapacity ? 'not-allowed' : 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                + Add AI Opponent
              </button>
            </div>

            {aiOpponents.length === 0 && (
              <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
                Click "Add AI Opponent" to add AI players to your game. You can add up to {MAX_AI_OPPONENTS} AI opponents.
              </div>
            )}

            {isAtMaxAiCapacity && (
              <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 8 }}>
                Maximum of {MAX_AI_OPPONENTS} AI opponents reached.
              </div>
            )}

            {aiOpponents.map((ai, index) => {
              const hasDeck = aiHasDeck(ai);
              return (
              <div
                key={ai.id}
                style={{
                  marginBottom: index < aiOpponents.length - 1 ? 12 : 0,
                  padding: 12,
                  backgroundColor: hasDeck ? '#fff' : '#fef2f2',
                  borderRadius: 6,
                  border: hasDeck ? '1px solid #e5e7eb' : '2px solid #ef4444',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                  }}
                  onClick={() => updateAiOpponent(ai.id, { expanded: !ai.expanded })}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      {ai.expanded ? '▼' : '▶'} {ai.name || `AI Opponent ${index + 1}`}
                    </span>
                    <span style={{ fontSize: 11, color: '#888' }}>
                      ({AI_STRATEGY_INFO[ai.strategy].name})
                    </span>
                    {!hasDeck && (
                      <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 500 }}>
                        ⚠️ No deck
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAiOpponent(ai.id);
                    }}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 4,
                      border: 'none',
                      backgroundColor: '#ef4444',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: 11,
                    }}
                  >
                    Remove
                  </button>
                </div>

                {ai.expanded && (
                  <div style={{ marginTop: 12 }}>
                    {/* AI Name */}
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#444' }}>
                        Name
                      </label>
                      <input
                        type="text"
                        value={ai.name}
                        onChange={(e) => updateAiOpponent(ai.id, { name: e.target.value })}
                        placeholder={`AI Opponent ${index + 1}`}
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          borderRadius: 4,
                          border: '1px solid #ddd',
                          fontSize: 13,
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>

                    {/* AI Strategy */}
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#444' }}>
                        Strategy
                      </label>
                      <select
                        value={ai.strategy}
                        onChange={(e) => updateAiOpponent(ai.id, { strategy: e.target.value as AIStrategy })}
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          borderRadius: 4,
                          border: '1px solid #ddd',
                          fontSize: 13,
                          boxSizing: 'border-box',
                          backgroundColor: '#fff',
                        }}
                      >
                        {Object.entries(AI_STRATEGY_INFO).map(([key, info]) => (
                          <option key={key} value={key}>
                            {info.name} - {info.description}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* AI Deck Selection */}
                    <div>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#444' }}>
                        Deck
                      </label>
                      
                      {/* Mode Toggle */}
                      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <button
                          type="button"
                          onClick={() => updateAiOpponent(ai.id, { deckMode: 'select' })}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 4,
                            border: ai.deckMode === 'select' ? '2px solid #3b82f6' : '1px solid #ddd',
                            backgroundColor: ai.deckMode === 'select' ? '#eff6ff' : '#fff',
                            cursor: 'pointer',
                            fontSize: 11,
                            fontWeight: ai.deckMode === 'select' ? 500 : 400,
                          }}
                        >
                          📁 Select Saved
                        </button>
                        <button
                          type="button"
                          onClick={() => updateAiOpponent(ai.id, { deckMode: 'import' })}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 4,
                            border: ai.deckMode === 'import' ? '2px solid #3b82f6' : '1px solid #ddd',
                            backgroundColor: ai.deckMode === 'import' ? '#eff6ff' : '#fff',
                            cursor: 'pointer',
                            fontSize: 11,
                            fontWeight: ai.deckMode === 'import' ? 500 : 400,
                          }}
                        >
                          📝 Import
                        </button>
                      </div>

                      {/* Select Saved Deck Mode */}
                      {ai.deckMode === 'select' && (
                        <div>
                          <select
                            value={ai.deckId}
                            onChange={(e) => updateAiOpponent(ai.id, { deckId: e.target.value })}
                            style={{
                              width: '100%',
                              padding: '6px 10px',
                              borderRadius: 4,
                              border: '1px solid #ddd',
                              fontSize: 12,
                              boxSizing: 'border-box',
                              backgroundColor: '#fff',
                            }}
                          >
                            <option value="">-- Select a deck --</option>
                            {filteredDecks.map((deck) => (
                              <option key={deck.id} value={deck.id}>
                                {deck.name} ({deck.card_count} cards)
                              </option>
                            ))}
                          </select>
                          {savedDecks.length === 0 && (
                            <div style={{ marginTop: 4, fontSize: 11, color: '#f59e0b' }}>
                              No saved decks. Use "Import" to add one.
                            </div>
                          )}
                        </div>
                      )}

                      {/* Import Deck Mode */}
                      {ai.deckMode === 'import' && (
                        <div>
                          <input
                            type="text"
                            value={ai.deckName}
                            onChange={(e) => updateAiOpponent(ai.id, { deckName: e.target.value })}
                            placeholder="Deck name"
                            style={{
                              width: '100%',
                              padding: '6px 10px',
                              borderRadius: 4,
                              border: '1px solid #ddd',
                              fontSize: 12,
                              boxSizing: 'border-box',
                              marginBottom: 4,
                            }}
                          />
                          <textarea
                            value={ai.deckText}
                            onChange={(e) => updateAiOpponent(ai.id, { deckText: e.target.value })}
                            placeholder="Paste decklist here..."
                            style={{
                              width: '100%',
                              height: 80,
                              padding: '6px 10px',
                              borderRadius: 4,
                              border: '1px solid #ddd',
                              fontSize: 11,
                              boxSizing: 'border-box',
                              resize: 'vertical',
                              fontFamily: 'monospace',
                            }}
                          />
                          <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleSaveAiDeck(ai.id)}
                              disabled={!ai.deckText.trim() || !ai.deckName.trim() || savingDeck}
                              style={{
                                padding: '4px 10px',
                                borderRadius: 4,
                                border: 'none',
                                backgroundColor: (!ai.deckText.trim() || !ai.deckName.trim() || savingDeck) ? '#ccc' : '#10b981',
                                color: '#fff',
                                cursor: (!ai.deckText.trim() || !ai.deckName.trim() || savingDeck) ? 'not-allowed' : 'pointer',
                                fontSize: 11,
                              }}
                            >
                              {savingDeck ? 'Saving...' : 'Save'}
                            </button>
                            {ai.deckText.trim() && (
                              <span style={{ fontSize: 10, color: '#666' }}>
                                Will import on game start
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
            })}
            
            {saveMessage && (
              <div style={{ marginTop: 8, fontSize: 12, color: saveMessage.startsWith('✓') ? '#10b981' : '#ef4444' }}>
                {saveMessage}
              </div>
            )}
          </div>

          {/* House Rules Section */}
          <div
            style={{
              marginBottom: 16,
              padding: 16,
              backgroundColor: showHouseRules ? '#fef3c7' : '#f9f9f9',
              borderRadius: 6,
              border: showHouseRules ? '1px solid #f59e0b' : '1px solid #eee',
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
                checked={showHouseRules}
                onChange={(e) => setShowHouseRules(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              <span>🏠 House Rules (Optional)</span>
            </label>
            <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
              Enable optional game variants (all default to off)
            </div>

            {showHouseRules && (
              <div style={{ marginTop: 16 }}>
                {/* Mulligan Rules */}
                <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#444', marginBottom: 8 }}>
                    Mulligan Rules
                  </div>
                  
                  {/* Free First Mulligan - Now Baseline */}
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'flex-start', 
                    gap: 8, 
                    marginBottom: 8,
                    padding: 8,
                    backgroundColor: '#d1fae5',
                    borderRadius: 4,
                    border: '1px solid #10b981',
                  }}>
                    <span style={{ fontSize: 14 }}>✓</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#065f46' }}>Free First Mulligan (Always Enabled)</div>
                      <div style={{ fontSize: 11, color: '#047857' }}>
                        First mulligan in multiplayer games (3+ players) is always free per official Commander rule 103.5a
                      </div>
                    </div>
                  </div>
                  
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 8 }}>
                    <input
                      type="checkbox"
                      checked={freeMulliganNoLandsOrAllLands}
                      onChange={(e) => setFreeMulliganNoLandsOrAllLands(e.target.checked)}
                      style={{ width: 16, height: 16, marginTop: 2 }}
                    />
                    <div>
                      <div style={{ fontSize: 13 }}>Free Mulligan: No Lands / All Lands</div>
                      <div style={{ fontSize: 11, color: '#666' }}>
                        Free mulligan if opening hand has no lands or all lands
                      </div>
                    </div>
                  </label>
                  
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={groupMulliganDiscount}
                      onChange={(e) => setGroupMulliganDiscount(e.target.checked)}
                      style={{ width: 16, height: 16, marginTop: 2 }}
                    />
                    <div>
                      <div style={{ fontSize: 13 }}>Group Mulligan Discount</div>
                      <div style={{ fontSize: 11, color: '#666' }}>
                        If all human players mulligan, decrease mulligan count by 1 for each
                      </div>
                    </div>
                  </label>
                </div>
                
                {/* Commander Damage Rule */}
                <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#444', marginBottom: 8 }}>
                    Commander Damage
                  </div>
                  
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={anyCommanderDamageCountsAsCommanderDamage}
                      onChange={(e) => setAnyCommanderDamageCountsAsCommanderDamage(e.target.checked)}
                      style={{ width: 16, height: 16, marginTop: 2 }}
                    />
                    <div>
                      <div style={{ fontSize: 13 }}>Any Commander Damage Counts</div>
                      <div style={{ fontSize: 11, color: '#666' }}>
                        All damage from commanders counts as commander damage (not just combat)
                      </div>
                    </div>
                  </label>
                </div>
                
                {/* Variant Formats (NYI) */}
                <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#444', marginBottom: 8 }}>
                    Variant Formats <span style={{ fontSize: 10, color: '#f59e0b' }}>(Not Yet Implemented)</span>
                  </div>
                  
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 8, opacity: 0.6 }}>
                    <input
                      type="checkbox"
                      checked={enableArchenemy}
                      onChange={(e) => setEnableArchenemy(e.target.checked)}
                      style={{ width: 16, height: 16, marginTop: 2 }}
                    />
                    <div>
                      <div style={{ fontSize: 13 }}>Enable Archenemy</div>
                      <div style={{ fontSize: 11, color: '#666' }}>
                        Add scheme cards to the match (requires scheme deck)
                      </div>
                    </div>
                  </label>
                  
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', opacity: 0.6 }}>
                    <input
                      type="checkbox"
                      checked={enablePlanechase}
                      onChange={(e) => setEnablePlanechase(e.target.checked)}
                      style={{ width: 16, height: 16, marginTop: 2 }}
                    />
                    <div>
                      <div style={{ fontSize: 13 }}>Enable Planechase</div>
                      <div style={{ fontSize: 11, color: '#666' }}>
                        Add planar cards to the match (requires planar deck)
                      </div>
                    </div>
                  </label>
                </div>
                
                {/* Custom Rule Suggestion */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#444', marginBottom: 8 }}>
                    Suggest a House Rule
                  </div>
                  <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
                    Have an idea for a house rule? Submit it for review and potential future implementation.
                  </div>
                  <textarea
                    value={customRuleSuggestion}
                    onChange={(e) => setCustomRuleSuggestion(e.target.value)}
                    placeholder="Describe your house rule idea..."
                    style={{
                      width: '100%',
                      height: 60,
                      padding: '8px 12px',
                      borderRadius: 4,
                      border: '1px solid #ddd',
                      fontSize: 12,
                      boxSizing: 'border-box',
                      resize: 'vertical',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={handleSubmitCustomRule}
                      disabled={!customRuleSuggestion.trim() || submittingCustomRule}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 4,
                        border: 'none',
                        backgroundColor: (!customRuleSuggestion.trim() || submittingCustomRule) ? '#ccc' : '#f59e0b',
                        color: '#fff',
                        cursor: (!customRuleSuggestion.trim() || submittingCustomRule) ? 'not-allowed' : 'pointer',
                        fontSize: 12,
                      }}
                    >
                      {submittingCustomRule ? 'Submitting...' : 'Submit Suggestion'}
                    </button>
                    {customRuleMessage && (
                      <span style={{ fontSize: 12, color: customRuleMessage.startsWith('✓') ? '#10b981' : '#ef4444' }}>
                        {customRuleMessage}
                      </span>
                    )}
                  </div>
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
