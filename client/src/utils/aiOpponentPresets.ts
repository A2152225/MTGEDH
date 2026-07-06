export const AI_OPPONENT_PRESETS_STORAGE_KEY = 'mtgedh:aiOpponentPresets';

export type AIOpponentDeckMode = 'select' | 'import';

export type SavedAIOpponentPreset = {
  id: string;
  /** Display label in the preset picker (defaults to opponent name). */
  label: string;
  name: string;
  difficulty: number;
  deckMode: AIOpponentDeckMode;
  deckId: string;
  deckText: string;
  deckName: string;
  savedAt: number;
};

export type AIOpponentPresetInput = Omit<SavedAIOpponentPreset, 'id' | 'savedAt'> & {
  id?: string;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clampDifficulty(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

function parsePreset(raw: unknown): SavedAIOpponentPreset | null {
  if (!isPlainObject(raw)) return null;

  const deckMode = raw.deckMode === 'import' ? 'import' : 'select';
  const name = String(raw.name || '').trim() || 'AI Opponent';
  const label = String(raw.label || raw.name || '').trim() || name;

  return {
    id: String(raw.id || '').trim() || `ai_preset_${Date.now().toString(36)}`,
    label,
    name,
    difficulty: clampDifficulty(raw.difficulty),
    deckMode,
    deckId: String(raw.deckId || ''),
    deckText: String(raw.deckText || ''),
    deckName: String(raw.deckName || ''),
    savedAt: typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : Date.now(),
  };
}

function readPresetList(storage: StorageLike): SavedAIOpponentPreset[] {
  try {
    const raw = storage.getItem(AI_OPPONENT_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parsePreset)
      .filter((p): p is SavedAIOpponentPreset => p !== null)
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  } catch {
    return [];
  }
}

function writePresetList(storage: StorageLike, presets: SavedAIOpponentPreset[]): void {
  try {
    storage.setItem(AI_OPPONENT_PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Ignore storage failures.
  }
}

export function loadSavedAIOpponentPresets(storage: StorageLike = localStorage): SavedAIOpponentPreset[] {
  return readPresetList(storage);
}

export function upsertSavedAIOpponentPreset(
  input: AIOpponentPresetInput,
  storage: StorageLike = localStorage
): SavedAIOpponentPreset {
  const presets = readPresetList(storage);
  const now = Date.now();
  const name = input.name.trim() || 'AI Opponent';
  const label = input.label.trim() || name;
  const next: SavedAIOpponentPreset = {
    id: input.id?.trim() || `ai_preset_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    label,
    name,
    difficulty: clampDifficulty(input.difficulty),
    deckMode: input.deckMode === 'import' ? 'import' : 'select',
    deckId: input.deckId || '',
    deckText: input.deckText || '',
    deckName: input.deckName || '',
    savedAt: now,
  };

  const existingIndex = presets.findIndex((p) => p.id === next.id);
  if (existingIndex >= 0) {
    presets[existingIndex] = next;
  } else {
    presets.push(next);
  }

  presets.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  writePresetList(storage, presets);
  return next;
}

export function deleteSavedAIOpponentPreset(
  id: string,
  storage: StorageLike = localStorage
): boolean {
  const presets = readPresetList(storage);
  const next = presets.filter((p) => p.id !== id);
  if (next.length === presets.length) return false;
  writePresetList(storage, next);
  return true;
}

export type AIOpponentFormState = {
  id: string;
  name: string;
  difficulty: number;
  deckId: string;
  deckMode: AIOpponentDeckMode;
  deckText: string;
  deckName: string;
  expanded: boolean;
  saveAsPreset: boolean;
  presetLabel: string;
};

export function createAiOpponentFromPreset(preset: SavedAIOpponentPreset): AIOpponentFormState {
  const newId = `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  return {
    id: newId,
    name: preset.name,
    difficulty: preset.difficulty,
    deckId: preset.deckId,
    deckMode: preset.deckMode,
    deckText: preset.deckText,
    deckName: preset.deckName,
    expanded: true,
    saveAsPreset: false,
    presetLabel: preset.label,
  };
}

export function presetInputFromAiOpponent(
  ai: Pick<
    AIOpponentFormState,
    'name' | 'difficulty' | 'deckId' | 'deckMode' | 'deckText' | 'deckName' | 'presetLabel'
  >
): AIOpponentPresetInput {
  const name = ai.name.trim() || 'AI Opponent';
  return {
    label: ai.presetLabel.trim() || name,
    name,
    difficulty: ai.difficulty,
    deckMode: ai.deckMode,
    deckId: ai.deckId,
    deckText: ai.deckText,
    deckName: ai.deckName,
  };
}
