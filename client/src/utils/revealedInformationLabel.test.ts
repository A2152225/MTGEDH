import { describe, it, expect } from 'vitest';
import { revealedByLabel, isLibraryTopRevealedToAll } from './revealedInformationLabel';
describe('revealedInformationLabel', () => {
  it('formats source names', () => {
    expect(revealedByLabel(['Telepathy'])).toBe('Revealed by Telepathy');
    expect(revealedByLabel(['Telepathy', 'Revelation'])).toBe('Revealed by Telepathy, Revelation');
    expect(revealedByLabel([])).toBeNull();
    expect(revealedByLabel(undefined)).toBeNull();
  });
  it('detects revealed-to-all library top', () => {
    expect(isLibraryTopRevealedToAll({ id: 'x', revealedToAll: true })).toBe(true);
    expect(isLibraryTopRevealedToAll({ id: 'x' })).toBe(false);
    expect(isLibraryTopRevealedToAll(undefined)).toBe(false);
  });
});
