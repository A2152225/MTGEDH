// Origin parent: client/src/components/CreateGameModal.tsx
// Cluster moved: nested AI opponents section (~663-1100).
// Public entry symbols: CreateGameModalAiOpponentsSection.
// Leaf must not import CreateGameModal.tsx or CreateGameModal-handlers/index.ts.

import type { Dispatch, SetStateAction } from 'react';
import type { SavedAIOpponentPreset } from '../../utils/aiOpponentPresets';

export type CreateGameModalAiOpponentDraft = {
  id: string;
  name: string;
  difficulty: number;
  deckId: string;
  deckMode: 'select' | 'import';
  deckText: string;
  deckName: string;
  expanded: boolean;
  saveAsPreset: boolean;
  presetLabel: string;
};

export type CreateGameModalSavedDeckSummary = {
  id: string;
  name: string;
  card_count: number;
  created_by_name?: string;
};

export type CreateGameModalAiOpponentsSectionProps = {
  aiOpponents: CreateGameModalAiOpponentDraft[];
  savedAiPresets: SavedAIOpponentPreset[];
  selectedPresetId: string;
  setSelectedPresetId: Dispatch<SetStateAction<string>>;
  isAtMaxAiCapacity: boolean;
  addAiOpponent: () => void;
  addAiOpponentFromPreset: (presetId: string) => void;
  handleDeleteSelectedPreset: () => void;
  aiHasDeck: (ai: CreateGameModalAiOpponentDraft) => boolean;
  updateAiOpponent: (id: string, updates: Partial<CreateGameModalAiOpponentDraft>) => void;
  removeAiOpponent: (id: string) => void;
  filteredDecks: CreateGameModalSavedDeckSummary[];
  savedDecks: CreateGameModalSavedDeckSummary[];
  handleSaveAiDeck: (aiId: string) => void;
  savingDeck: boolean;
  saveMessage: string | null;
  MAX_AI_OPPONENTS: number;
  MAX_TOTAL_SEATS: number;
};

export function CreateGameModalAiOpponentsSection({
  aiOpponents,
  savedAiPresets,
  selectedPresetId,
  setSelectedPresetId,
  isAtMaxAiCapacity,
  addAiOpponent,
  addAiOpponentFromPreset,
  handleDeleteSelectedPreset,
  aiHasDeck,
  updateAiOpponent,
  removeAiOpponent,
  filteredDecks,
  savedDecks,
  handleSaveAiDeck,
  savingDeck,
  saveMessage,
  MAX_AI_OPPONENTS,
  MAX_TOTAL_SEATS,
}: CreateGameModalAiOpponentsSectionProps) {
  return (
    <>
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

            {savedAiPresets.length > 0 && (
              <div
                style={{
                  marginTop: aiOpponents.length > 0 ? 0 : 8,
                  marginBottom: 12,
                  padding: 10,
                  backgroundColor: '#fff',
                  borderRadius: 6,
                  border: '1px solid #dbeafe',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 500, color: '#444', marginBottom: 6 }}>
                  Saved AI Presets
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select
                    value={selectedPresetId}
                    onChange={(e) => setSelectedPresetId(e.target.value)}
                    style={{
                      flex: '1 1 180px',
                      minWidth: 140,
                      padding: '6px 10px',
                      borderRadius: 4,
                      border: '1px solid #ddd',
                      fontSize: 12,
                      backgroundColor: '#fff',
                    }}
                  >
                    <option value="">-- Select a saved preset --</option>
                    {savedAiPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => addAiOpponentFromPreset(selectedPresetId)}
                    disabled={!selectedPresetId || isAtMaxAiCapacity}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 4,
                      border: 'none',
                      backgroundColor: (!selectedPresetId || isAtMaxAiCapacity) ? '#9ca3af' : '#10b981',
                      color: '#fff',
                      cursor: (!selectedPresetId || isAtMaxAiCapacity) ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                      fontWeight: 500,
                    }}
                  >
                    Add from Preset
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteSelectedPreset}
                    disabled={!selectedPresetId}
                    title="Delete selected preset"
                    style={{
                      padding: '6px 10px',
                      borderRadius: 4,
                      border: '1px solid #fca5a5',
                      backgroundColor: '#fff',
                      color: '#b91c1c',
                      cursor: !selectedPresetId ? 'not-allowed' : 'pointer',
                      fontSize: 12,
                    }}
                  >
                    Delete
                  </button>
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: '#666' }}>
                  Quickly add opponents with saved name, deck, and difficulty. Playstyle is inferred from the deck.
                </div>
              </div>
            )}

            {aiOpponents.length === 0 && (
              <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
                Click "Add AI Opponent" to add AI players to your game. You can add up to {MAX_AI_OPPONENTS} AI opponents for a {MAX_TOTAL_SEATS}-seat table including you.
                {savedAiPresets.length === 0 && (
                  <> Check &quot;Save as preset&quot; on an opponent when creating a game to reuse settings later.</>
                )}
              </div>
            )}

            {isAtMaxAiCapacity && (
              <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 8 }}>
                Maximum of {MAX_AI_OPPONENTS} AI opponents reached ({MAX_TOTAL_SEATS} total seats including you).
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
                      (deck-aware AI)
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
                        onChange={(e) => {
                          const name = e.target.value;
                          updateAiOpponent(ai.id, {
                            name,
                            presetLabel: ai.saveAsPreset && !ai.presetLabel.trim()
                              ? name
                              : ai.presetLabel,
                          });
                        }}
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

                    {/* AI Difficulty Slider */}
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: '#444' }}>
                        Difficulty: {
                          ai.difficulty <= 0.33 ? 'Easy' :
                          ai.difficulty <= 0.66 ? 'Medium' :
                          'Hard'
                        } ({Math.round(ai.difficulty * 100)}%)
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={ai.difficulty}
                        onChange={(e) => updateAiOpponent(ai.id, { difficulty: parseFloat(e.target.value) })}
                        style={{
                          width: '100%',
                          accentColor: '#3b82f6',
                        }}
                      />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888', marginTop: 2 }}>
                        <span>Easy</span>
                        <span>Medium</span>
                        <span>Hard</span>
                      </div>
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

                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #e5e7eb' }}>
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 8,
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={ai.saveAsPreset}
                          onChange={(e) => {
                            const saveAsPreset = e.target.checked;
                            updateAiOpponent(ai.id, {
                              saveAsPreset,
                              presetLabel: saveAsPreset
                                ? (ai.presetLabel.trim() || ai.name.trim() || `AI Opponent ${index + 1}`)
                                : ai.presetLabel,
                            });
                          }}
                          style={{ width: 16, height: 16, marginTop: 2 }}
                        />
                        <span>Save as preset when creating this game</span>
                      </label>
                      {ai.saveAsPreset && (
                        <div style={{ marginTop: 8, marginLeft: 24 }}>
                          <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: '#666' }}>
                            Preset name (shown in the preset list)
                          </label>
                          <input
                            type="text"
                            value={ai.presetLabel}
                            onChange={(e) => updateAiOpponent(ai.id, { presetLabel: e.target.value })}
                            placeholder={ai.name.trim() || `AI Opponent ${index + 1}`}
                            style={{
                              width: '100%',
                              padding: '6px 10px',
                              borderRadius: 4,
                              border: '1px solid #ddd',
                              fontSize: 12,
                              boxSizing: 'border-box',
                            }}
                          />
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

    </>
  );
}
