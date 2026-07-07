import type { SavedLocalDeckRef } from './randomDeckSelection';

const STORAGE_KEY = 'mtgedh:savedDecksLocal';

export function loadLocalSavedDecks(): SavedLocalDeckRef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SavedLocalDeckRef[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveLocalSavedDecks(list: SavedLocalDeckRef[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function createLocalDeckId(prefix = 'd'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export { STORAGE_KEY as LOCAL_DECK_STORAGE_KEY };
