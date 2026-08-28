/**
 * Pre-game control to add or remove AI opponents after the table exists,
 * before all hands are kept. Emits `addAIToGame` / `removeAIFromGame`
 * (creator-only on the server). Change decks by removing and re-adding.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SavedDeckSummary } from '../../../shared/src/decks';
import { socket } from '../socket';
import { colors, fontSize, radii, spacing, touch, z } from '../theme';
import { loadSavedAIOpponentPresets, type SavedAIOpponentPreset } from '../utils/aiOpponentPresets';
import { loadLocalSavedDecks } from '../utils/localDeckStorage';
import type { SavedLocalDeckRef } from '../utils/randomDeckSelection';
import { fetchServerDeckSummaries } from '../utils/serverDeckApi';

/** Matches CreateGameModal: 9 AI seats + the host. */
export const MAX_TOTAL_AI_TABLE_SEATS = 10;

const ADD_AI_ERROR_CODES = new Set([
  'AI_ADD_FAILED',
  'AI_REMOVE_FAILED',
  'AI_NOT_AUTHORIZED',
  'AI_NOT_PREGAME',
  'AI_HANDS_LOCKED',
  'AI_TABLE_FULL',
  'AI_NOT_FOUND',
  'NOT_IN_GAME',
  'GAME_NOT_FOUND',
]);

type DeckChoice =
  | { kind: 'none' }
  | { kind: 'server'; deckId: string; name: string }
  | { kind: 'local'; name: string; text: string };

function parseDeckValue(value: string, serverDecks: SavedDeckSummary[], localDecks: SavedLocalDeckRef[]): DeckChoice {
  if (!value) return { kind: 'none' };
  if (value.startsWith('server:')) {
    const deckId = value.slice('server:'.length);
    const deck = serverDecks.find((d) => d.id === deckId);
    return deck ? { kind: 'server', deckId: deck.id, name: deck.name } : { kind: 'none' };
  }
  if (value.startsWith('local:')) {
    const id = value.slice('local:'.length);
    const deck = localDecks.find((d) => d.id === id);
    return deck?.text?.trim()
      ? { kind: 'local', name: deck.name, text: deck.text }
      : { kind: 'none' };
  }
  return { kind: 'none' };
}

function difficultyLabel(value: number): string {
  if (value <= 0.33) return 'Easy';
  if (value <= 0.66) return 'Medium';
  return 'Hard';
}

export type SeatedAIPlayer = {
  id: string;
  name: string;
  deckName?: string;
};

export type AddAIToGameControlProps = {
  gameId: string;
  seatedPlayerCount: number;
  seatedAIs?: SeatedAIPlayer[];
  /** Larger hit target for the mobile pre-game row. */
  compact?: boolean;
};

export function AddAIToGameControl({
  gameId,
  seatedPlayerCount,
  seatedAIs = [],
  compact = false,
}: AddAIToGameControlProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('AI Opponent');
  const [difficulty, setDifficulty] = useState(0.5);
  const [deckValue, setDeckValue] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [serverDecks, setServerDecks] = useState<SavedDeckSummary[]>([]);
  const [localDecks, setLocalDecks] = useState<SavedLocalDeckRef[]>([]);
  const [presets, setPresets] = useState<SavedAIOpponentPreset[]>([]);
  const [loadingDecks, setLoadingDecks] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tableFull = seatedPlayerCount >= MAX_TOTAL_AI_TABLE_SEATS;
  const hasSeatedAIs = seatedAIs.length > 0;
  const busy = submitting || Boolean(removingId);
  const nextSeatNumber = Math.max(1, seatedPlayerCount);
  const choice = useMemo(
    () => parseDeckValue(deckValue, serverDecks, localDecks),
    [deckValue, serverDecks, localDecks],
  );
  const canSubmit = !busy && !tableFull && choice.kind !== 'none';

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
    setRemovingId(null);
    setName(`AI Opponent ${nextSeatNumber}`);
    setDifficulty(0.5);
    setDeckValue('');
    setSelectedPresetId('');
    setPresets(loadSavedAIOpponentPresets());
    setLocalDecks(loadLocalSavedDecks().filter((d) => d.text?.trim()));
    let cancelled = false;
    setLoadingDecks(true);
    fetchServerDeckSummaries()
      .then((decks) => {
        if (!cancelled) setServerDecks(decks);
      })
      .catch(() => {
        if (!cancelled) setServerDecks([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDecks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, nextSeatNumber]);

  useEffect(() => {
    if (!open) return;
    const onCreated = (payload?: { gameId?: string }) => {
      if (payload?.gameId && payload.gameId !== gameId) return;
      setSubmitting(false);
      setError(null);
      setDeckValue('');
      setSelectedPresetId('');
      setName(`AI Opponent ${nextSeatNumber + 1}`);
    };
    const onRemoved = (payload?: { gameId?: string }) => {
      if (payload?.gameId && payload.gameId !== gameId) return;
      setRemovingId(null);
      setError(null);
    };
    const onError = (payload?: { code?: string; message?: string }) => {
      if (!payload?.code || !ADD_AI_ERROR_CODES.has(payload.code)) return;
      setSubmitting(false);
      setRemovingId(null);
      setError(payload.message || 'Failed to update AI opponents');
    };
    socket.on('aiPlayerCreated', onCreated);
    socket.on('aiPlayerRemoved', onRemoved);
    socket.on('error', onError);
    return () => {
      socket.off('aiPlayerCreated', onCreated);
      socket.off('aiPlayerRemoved', onRemoved);
      socket.off('error', onError);
    };
  }, [open, gameId, nextSeatNumber]);

  const applyPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    setName(preset.name || 'AI Opponent');
    setDifficulty(preset.difficulty);
    if (preset.deckMode === 'select' && preset.deckId) {
      setDeckValue(`server:${preset.deckId}`);
      return;
    }
    if (preset.deckText?.trim()) {
      const localMatch = localDecks.find((d) => d.text.trim() === preset.deckText.trim());
      if (localMatch) {
        setDeckValue(`local:${localMatch.id}`);
        return;
      }
      setLocalDecks((prev) => {
        if (prev.some((d) => d.id === `preset_${preset.id}`)) return prev;
        return [
          ...prev,
          {
            id: `preset_${preset.id}`,
            name: preset.deckName || preset.label || preset.name,
            text: preset.deckText,
            savedAt: preset.savedAt,
          },
        ];
      });
      setDeckValue(`local:preset_${preset.id}`);
    }
  };

  const pickRandomDeck = () => {
    const options: string[] = [
      ...serverDecks.map((d) => `server:${d.id}`),
      ...localDecks.map((d) => `local:${d.id}`),
    ];
    if (options.length === 0) {
      setError('No saved decks available. Save a deck first, or import one for yourself.');
      return;
    }
    const pick = options[Math.floor(Math.random() * options.length)];
    setDeckValue(pick);
    setError(null);
  };

  const submit = () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const payload: Record<string, unknown> = {
      gameId,
      aiName: name.trim() || 'AI Opponent',
      aiDifficulty: difficulty,
    };
    if (choice.kind === 'server') {
      payload.aiDeckId = choice.deckId;
    } else if (choice.kind === 'local') {
      payload.aiDeckText = choice.text;
      payload.aiDeckName = choice.name;
    }
    socket.emit('addAIToGame' as any, payload);
  };

  const removeAI = (aiPlayerId: string) => {
    if (busy) return;
    setRemovingId(aiPlayerId);
    setError(null);
    socket.emit('removeAIFromGame' as any, { gameId, aiPlayerId });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={tableFull && !hasSeatedAIs}
        style={{
          padding: compact ? '8px 16px' : '4px 10px',
          minHeight: compact ? touch.minHitTarget : undefined,
          fontSize: compact ? 13 : 12,
          fontWeight: 600,
          background: 'rgba(59, 130, 246, 0.22)',
          border: '1px solid rgba(96, 165, 250, 0.45)',
          borderRadius: compact ? 8 : 4,
          color: '#fff',
          cursor: tableFull && !hasSeatedAIs ? 'not-allowed' : 'pointer',
          opacity: tableFull && !hasSeatedAIs ? 0.55 : 1,
          whiteSpace: 'nowrap',
        }}
        title={
          tableFull && !hasSeatedAIs
            ? `Table is full (${MAX_TOTAL_AI_TABLE_SEATS} seats)`
            : hasSeatedAIs
              ? 'Add, remove, or replace AI opponents before everyone keeps their hand'
              : 'Add an AI opponent before everyone keeps their hand'
        }
      >
        {hasSeatedAIs ? `🤖 Manage AI (${seatedAIs.length})` : '🤖 Add AI'}
      </button>

      {open && createPortal(
        <div
          role="presentation"
          onClick={() => {
            if (!busy) setOpen(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: z.modalBackdrop,
            padding: spacing.md,
          }}
        >
          <div
            role="dialog"
            aria-labelledby="add-ai-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(420px, 100%)',
              background: '#1e1e2e',
              border: '1px solid rgba(167, 139, 250, 0.45)',
              borderRadius: radii.lg,
              padding: 16,
              color: '#eee',
              boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
              zIndex: z.modal,
            }}
          >
            <h3 id="add-ai-title" style={{ margin: '0 0 6px', fontSize: 16 }}>
              {hasSeatedAIs ? 'Manage AI opponents' : 'Add AI opponent'}
            </h3>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: '#c4b5fd', lineHeight: 1.4 }}>
              Seats {seatedPlayerCount}/{MAX_TOTAL_AI_TABLE_SEATS}. Remove an AI to change its deck, then add it again. Only the game creator can manage opponents.
            </p>

            {hasSeatedAIs && (
              <div
                style={{
                  marginBottom: 14,
                  padding: 8,
                  borderRadius: radii.sm,
                  border: '1px solid rgba(96, 165, 250, 0.35)',
                  background: 'rgba(30, 58, 138, 0.28)',
                }}
              >
                {seatedAIs.map((ai) => (
                  <div
                    key={ai.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '6px 4px',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e7ff' }}>{ai.name}</div>
                      <div style={{ fontSize: 11, color: '#93c5fd' }}>
                        {ai.deckName ? `Deck: ${ai.deckName}` : 'No deck name'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAI(ai.id)}
                      disabled={busy}
                      style={{
                        flexShrink: 0,
                        padding: '6px 10px',
                        minHeight: touch.minHitTarget,
                        borderRadius: radii.sm,
                        border: '1px solid rgba(248, 113, 113, 0.55)',
                        background: 'rgba(127, 29, 29, 0.35)',
                        color: '#fecaca',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {removingId === ai.id ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {presets.length > 0 && (
              <label style={{ display: 'block', marginBottom: 10, fontSize: 12 }}>
                Saved preset
                <select
                  value={selectedPresetId}
                  onChange={(e) => applyPreset(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">— Optional —</option>
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label style={{ display: 'block', marginBottom: 10, fontSize: 12 }}>
              Name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={inputStyle}
              />
            </label>

            <label style={{ display: 'block', marginBottom: 10, fontSize: 12 }}>
              Difficulty: {difficultyLabel(difficulty)} ({Math.round(difficulty * 100)}%)
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={difficulty}
                onChange={(e) => setDifficulty(parseFloat(e.target.value))}
                style={{ width: '100%', marginTop: 4, accentColor: colors.accent }}
              />
            </label>

            <label style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
              Deck
              <select
                value={deckValue}
                onChange={(e) => {
                  setDeckValue(e.target.value);
                  setError(null);
                }}
                style={selectStyle}
              >
                <option value="">{loadingDecks ? 'Loading decks…' : '— Select a deck —'}</option>
                {serverDecks.length > 0 && (
                  <optgroup label="Server decks">
                    {serverDecks.map((deck) => (
                      <option key={deck.id} value={`server:${deck.id}`}>
                        {deck.name} ({deck.card_count} cards)
                      </option>
                    ))}
                  </optgroup>
                )}
                {localDecks.length > 0 && (
                  <optgroup label="Local decks">
                    {localDecks.map((deck) => (
                      <option key={deck.id} value={`local:${deck.id}`}>
                        {deck.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>

            <button
              type="button"
              onClick={pickRandomDeck}
              disabled={loadingDecks || (serverDecks.length === 0 && localDecks.length === 0)}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                background: 'rgba(139, 92, 246, 0.2)',
                border: '1px solid rgba(167, 139, 250, 0.4)',
                borderRadius: radii.sm,
                color: '#ddd6fe',
                cursor: 'pointer',
                marginBottom: 12,
              }}
            >
              🎲 Random saved deck
            </button>

            {error && (
              <div style={{ fontSize: 12, color: '#fca5a5', marginBottom: 10 }}>{error}</div>
            )}
            {serverDecks.length === 0 && localDecks.length === 0 && !loadingDecks && (
              <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 10 }}>
                No saved decks yet. Import or save a deck first, then add an AI.
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                style={{
                  padding: '8px 12px',
                  minHeight: touch.minHitTarget,
                  borderRadius: radii.sm,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'transparent',
                  color: '#e5e7eb',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  fontSize: fontSize.sm,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                style={{
                  padding: '8px 14px',
                  minHeight: touch.minHitTarget,
                  borderRadius: radii.sm,
                  border: 'none',
                  background: canSubmit ? '#3b82f6' : '#4b5563',
                  color: '#fff',
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  fontWeight: 600,
                  fontSize: fontSize.sm,
                }}
              >
                {submitting ? 'Adding…' : 'Add AI'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  padding: '8px 10px',
  borderRadius: radii.sm,
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(0,0,0,0.35)',
  color: '#eee',
  fontSize: 13,
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
};
