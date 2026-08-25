import React, { useState, useEffect, useMemo, useRef } from 'react';
import { socket } from '../socket';
import {
  createAiOpponentFromPreset,
  deleteSavedAIOpponentPreset,
  loadSavedAIOpponentPresets,
  presetInputFromAiOpponent,
  upsertSavedAIOpponentPreset,
  type SavedAIOpponentPreset,
} from '../utils/aiOpponentPresets';
import { CreateGameModalAiOpponentsSection } from './CreateGameModal-handlers/createGameModalAiOpponentsSection';

/**
 * Game formats supported by the application
 */
export type GameFormat = 'commander' | 'standard' | 'modern' | 'legacy' | 'vintage' | 'pauper';

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
  /** Concede and leave remove a player's battlefield immediately */
  immediateConcede: boolean;
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
  difficulty?: number; // AI skill level: 0 = easy, 0.5 = medium, 1 = hard (default: 0.5)
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
  seed?: number;
  // AI opponent settings - support multiple AI opponents
  includeAI: boolean;
  aiOpponents?: AIOpponentConfig[];
  // Legacy single AI opponent fields (for backward compatibility)
  aiName?: string;
  aiDifficulty?: number;
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
const MAX_AI_OPPONENTS = 9;
const MAX_TOTAL_SEATS = MAX_AI_OPPONENTS + 1;

/**
 * Modal for creating a new game with format, AI opponent, and deck selection
 */
export function CreateGameModal({ open, onClose, onCreateGame, savedDecks = [], onRefreshDecks }: CreateGameModalProps) {
  const isLocalhost = typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === ''
  );

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
  const [seedInput, setSeedInput] = useState('');
  
  // AI opponent settings - now supports multiple AI opponents
  const [aiOpponents, setAiOpponents] = useState<Array<{
    id: string;
    name: string;
    difficulty: number; // 0 = easy, 0.5 = medium, 1 = hard
    deckId: string;
    deckMode: 'select' | 'import';
    deckText: string;
    deckName: string;
    expanded: boolean;
    saveAsPreset: boolean;
    presetLabel: string;
  }>>([]);

  const [savedAiPresets, setSavedAiPresets] = useState<SavedAIOpponentPreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  
  // Deck filter for AI deck selection
  const [aiDeckFilter, setAiDeckFilter] = useState('');
  const [savingDeck, setSavingDeck] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // House rules state (freeFirstMulligan removed - now baseline for multiplayer)
  const [showHouseRules, setShowHouseRules] = useState(false);
  const [freeMulliganNoLandsOrAllLands, setFreeMulliganNoLandsOrAllLands] = useState(false);
  const [anyCommanderDamageCountsAsCommanderDamage, setAnyCommanderDamageCountsAsCommanderDamage] = useState(false);
  const [groupMulliganDiscount, setGroupMulliganDiscount] = useState(false);
  const [immediateConcede, setImmediateConcede] = useState(false);
  const [enableArchenemy, setEnableArchenemy] = useState(false);
  const [enablePlanechase, setEnablePlanechase] = useState(false);
  const [customRuleSuggestion, setCustomRuleSuggestion] = useState('');
  const [submittingCustomRule, setSubmittingCustomRule] = useState(false);
  const [customRuleMessage, setCustomRuleMessage] = useState<string | null>(null);

  // Only close on backdrop click if the pointerdown started on the backdrop.
  // This prevents accidental close when dragging/selecting inside the modal and releasing outside.
  const backdropClickArmedRef = useRef(false);

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
      difficulty: 0.5, // Default to medium difficulty
      deckId: '',
      deckMode: 'select',
      deckText: '',
      deckName: '',
      expanded: true, // Start expanded for new opponents
      saveAsPreset: false,
      presetLabel: '',
    }]);
  };

  const addAiOpponentFromPreset = (presetId: string) => {
    if (aiOpponents.length >= MAX_AI_OPPONENTS) return;
    const preset = savedAiPresets.find((p) => p.id === presetId);
    if (!preset) return;
    setAiOpponents([...aiOpponents, createAiOpponentFromPreset(preset)]);
  };

  const handleDeleteSelectedPreset = () => {
    if (!selectedPresetId) return;
    if (!window.confirm('Delete this saved AI opponent preset?')) return;
    deleteSavedAIOpponentPreset(selectedPresetId);
    setSavedAiPresets(loadSavedAIOpponentPresets());
    setSelectedPresetId('');
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
      setSeedInput('');
      // Reset save message when modal opens
      setSaveMessage(null);
      setSavedAiPresets(loadSavedAIOpponentPresets());
      setSelectedPresetId('');
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
    
    // Validate AI opponents have decks (using the aiHasDeck helper)
    const aiOpponentsWithoutDecks = aiOpponents.filter(ai => !aiHasDeck(ai));
    
    if (aiOpponentsWithoutDecks.length > 0) {
      const missingNames = aiOpponentsWithoutDecks.map(ai => ai.name || 'AI Opponent').join(', ');
      alert(`Cannot create game: The following AI opponent(s) need a deck: ${missingNames}\n\nPlease select or import a deck for each AI opponent.`);
      return;
    }
    
    // Sanitize and validate game ID
    const sanitizedGameId = sanitizeGameId(gameId.trim()) || `game_${Date.now().toString(36)}`;
    const normalizedSeedInput = seedInput.trim();

    let selectedSeed: number | undefined;
    if (isLocalhost && normalizedSeedInput) {
      const parsedSeed = Number(normalizedSeedInput);
      if (!Number.isInteger(parsedSeed) || parsedSeed <= 0 || parsedSeed > 0xFFFFFFFF) {
        alert('Seed must be an integer between 1 and 4294967295.');
        return;
      }
      selectedSeed = parsedSeed >>> 0;
    }
    
    // Save player name to localStorage for future sessions
    const finalPlayerName = playerName.trim() || 'Player';
    try {
      localStorage.setItem('mtgedh:playerName', finalPlayerName);
    } catch {
      // Ignore storage errors
    }

    const presetsToSave = aiOpponents.filter((ai) => ai.saveAsPreset);
    if (presetsToSave.length > 0) {
      const existingPresets = loadSavedAIOpponentPresets();
      for (const ai of presetsToSave) {
        const input = presetInputFromAiOpponent(ai);
        const existing = existingPresets.find(
          (p) => p.label.toLowerCase() === input.label.toLowerCase()
        );
        upsertSavedAIOpponentPreset({ ...input, id: existing?.id });
      }
      setSavedAiPresets(loadSavedAIOpponentPresets());
    }

    // Build house rules config (only include enabled rules)
    // Note: freeFirstMulligan is now baseline for multiplayer, so we don't include it here
    const houseRules: Partial<HouseRulesConfig> = {};
    if (freeMulliganNoLandsOrAllLands) houseRules.freeMulliganNoLandsOrAllLands = true;
    if (anyCommanderDamageCountsAsCommanderDamage) houseRules.anyCommanderDamageCountsAsCommanderDamage = true;
    if (groupMulliganDiscount) houseRules.groupMulliganDiscount = true;
    if (immediateConcede) houseRules.immediateConcede = true;
    if (enableArchenemy) houseRules.enableArchenemy = true;
    if (enablePlanechase) houseRules.enablePlanechase = true;
    
    // Build AI opponents configuration
    const aiOpponentsConfig: AIOpponentConfig[] = aiOpponents.map(ai => ({
      name: ai.name.trim() || 'AI Opponent',
      difficulty: ai.difficulty,
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
      seed: selectedSeed,
      includeAI: hasAI,
      aiOpponents: hasAI ? aiOpponentsConfig : undefined,
      // Legacy fields for backward compatibility with single AI
      aiName: hasAI && aiOpponents.length === 1 ? aiOpponentsConfig[0].name : undefined,
      aiDifficulty: hasAI && aiOpponents.length === 1 ? aiOpponentsConfig[0].difficulty : undefined,
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
      onPointerDown={(e) => {
        backdropClickArmedRef.current = e.target === e.currentTarget;
      }}
      onPointerUp={() => {
        // Disarm in case click doesn't fire (e.g., pointer cancellation)
        // We'll also disarm in onClick after handling.
        setTimeout(() => {
          backdropClickArmedRef.current = false;
        }, 0);
      }}
      onPointerCancel={() => {
        backdropClickArmedRef.current = false;
      }}
      onClick={(e) => {
        const isBackdrop = e.target === e.currentTarget;
        const shouldClose = isBackdrop && backdropClickArmedRef.current;
        backdropClickArmedRef.current = false;
        if (shouldClose) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: 8,
          maxWidth: 500,
          width: '90%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 24px 0', flexShrink: 0 }}>
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

        <form
          onSubmit={handleSubmit}
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
          }}
        >
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px 24px',
            }}
          >
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

          {isLocalhost && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 14 }}>
                Seed
              </label>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={4294967295}
                step={1}
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                placeholder="Leave blank for random seed"
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
                Localhost only. Reuse the same seed to reproduce shuffles and other RNG-dependent behavior.
              </div>
            </div>
          )}

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

          <CreateGameModalAiOpponentsSection
            aiOpponents={aiOpponents}
            savedAiPresets={savedAiPresets}
            selectedPresetId={selectedPresetId}
            setSelectedPresetId={setSelectedPresetId}
            isAtMaxAiCapacity={isAtMaxAiCapacity}
            addAiOpponent={addAiOpponent}
            addAiOpponentFromPreset={addAiOpponentFromPreset}
            handleDeleteSelectedPreset={handleDeleteSelectedPreset}
            aiHasDeck={aiHasDeck}
            updateAiOpponent={updateAiOpponent}
            removeAiOpponent={removeAiOpponent}
            filteredDecks={filteredDecks}
            savedDecks={savedDecks}
            handleSaveAiDeck={handleSaveAiDeck}
            savingDeck={savingDeck}
            saveMessage={saveMessage}
            MAX_AI_OPPONENTS={MAX_AI_OPPONENTS}
            MAX_TOTAL_SEATS={MAX_TOTAL_SEATS}
          />

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

                <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#444', marginBottom: 8 }}>
                    Concede / Leave
                  </div>

                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={immediateConcede}
                      onChange={(e) => setImmediateConcede(e.target.checked)}
                      style={{ width: 16, height: 16, marginTop: 2 }}
                    />
                    <div>
                      <div style={{ fontSize: 13 }}>Immediate Concede</div>
                      <div style={{ fontSize: 11, color: '#666' }}>
                        Concede and Leave remove a player's battlefield immediately instead of waiting until their next turn
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

          </div>

          {/* Submit Buttons — pinned footer */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
              padding: '16px 24px',
              borderTop: '1px solid #eee',
              backgroundColor: '#fff',
              flexShrink: 0,
            }}
          >
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
