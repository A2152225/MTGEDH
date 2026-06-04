import { describe, expect, it } from 'vitest';

import {
  AI_OPPONENT_PRESETS_STORAGE_KEY,
  createAiOpponentFromPreset,
  deleteSavedAIOpponentPreset,
  loadSavedAIOpponentPresets,
  presetInputFromAiOpponent,
  upsertSavedAIOpponentPreset,
} from '../src/utils/aiOpponentPresets';

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  } as Storage;
}

describe('aiOpponentPresets', () => {
  it('upserts and loads presets from storage', () => {
    const storage = makeStorage();
    upsertSavedAIOpponentPreset(
      {
        label: 'Test Bot',
        name: 'Test Bot',
        strategy: 'aggressive',
        difficulty: 0.8,
        deckMode: 'select',
        deckId: 'deck-1',
        deckText: '',
        deckName: '',
      },
      storage
    );

    const loaded = loadSavedAIOpponentPresets(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].label).toBe('Test Bot');
    expect(loaded[0].strategy).toBe('aggressive');
    expect(loaded[0].difficulty).toBe(0.8);
    expect(loaded[0].deckId).toBe('deck-1');
    expect(storage.getItem(AI_OPPONENT_PRESETS_STORAGE_KEY)).toBeTruthy();
  });

  it('deletes a preset by id', () => {
    const storage = makeStorage();
    const saved = upsertSavedAIOpponentPreset(
      {
        label: 'Remove Me',
        name: 'Remove Me',
        strategy: 'basic',
        difficulty: 0.5,
        deckMode: 'import',
        deckId: '',
        deckText: '1 Forest',
        deckName: 'Forest Deck',
      },
      storage
    );

    expect(deleteSavedAIOpponentPreset(saved.id, storage)).toBe(true);
    expect(loadSavedAIOpponentPresets(storage)).toHaveLength(0);
  });

  it('maps preset to opponent form state', () => {
    const storage = makeStorage();
    const preset = upsertSavedAIOpponentPreset(
      {
        label: 'Control Shell',
        name: 'Blue Control',
        strategy: 'control',
        difficulty: 0.25,
        deckMode: 'select',
        deckId: 'deck-9',
        deckText: '',
        deckName: '',
      },
      storage
    );

    const opponent = createAiOpponentFromPreset(preset);
    expect(opponent.name).toBe('Blue Control');
    expect(opponent.strategy).toBe('control');
    expect(opponent.deckId).toBe('deck-9');
    expect(opponent.saveAsPreset).toBe(false);
  });

  it('builds preset input from ai opponent form fields', () => {
    const input = presetInputFromAiOpponent({
      name: 'Combo Bot',
      strategy: 'combo',
      difficulty: 1,
      deckMode: 'import',
      deckId: '',
      deckText: '1 Sol Ring',
      deckName: 'Combo',
      presetLabel: 'My Combo Preset',
    });

    expect(input.label).toBe('My Combo Preset');
    expect(input.deckText).toBe('1 Sol Ring');
    expect(input.strategy).toBe('combo');
  });
});
