import { describe, it, expect } from 'vitest';
import type { GameState } from '../../shared/src/types.js';
import { enterUntappedOverrideSourceName } from '../src/state/modules/landsEnterUntappedOverride.js';
import { checkPermanentEntersTapped } from '../src/state/modules/triggerPermanentEntersTapped.js';
import { computeRevealedInformation, refreshRevealedInformationFlags } from '../src/state/modules/revealedInformationFlags.js';

const perm = (controller: string, name: string, oracle: string, type = 'Enchantment') => ({ id: name, controller, owner: controller, card: { name, type_line: type, oracle_text: oracle } });
const SPELUNK = 'When this enchantment enters, draw a card, then you may put a land card from your hand onto the battlefield.\nLands you control enter untapped.';
const tapland = { name: 'Guildgate', type_line: 'Land - Gate', oracle_text: 'This land enters tapped.\n{T}: Add {W} or {U}.' };
const creatureTapped = { name: 'Tapper', type_line: 'Creature - Elf', oracle_text: 'This creature enters tapped.' };

describe('batch22 lands enter untapped override', () => {
  it('Spelunking overrides lands for its controller only', () => {
    const bf = [perm('p1', 'Spelunking', SPELUNK)];
    expect(enterUntappedOverrideSourceName(bf, 'p1', tapland)).toBe('Spelunking');
    expect(enterUntappedOverrideSourceName(bf, 'p2', tapland)).toBeNull();
    expect(enterUntappedOverrideSourceName(bf, 'p1', creatureTapped)).toBeNull();
  });
  it('checkPermanentEntersTapped honours the override', () => {
    expect(checkPermanentEntersTapped([], 'p1', tapland)).toBe(true);
    expect(checkPermanentEntersTapped([perm('p1', 'Spelunking', SPELUNK)], 'p1', tapland)).toBe(false);
  });
  it('creatures-subject override', () => {
    const bf = [perm('p1', 'Minstrel-like', 'Creatures you control enter untapped.')];
    expect(enterUntappedOverrideSourceName(bf, 'p1', creatureTapped)).toBe('Minstrel-like');
    expect(enterUntappedOverrideSourceName(bf, 'p1', tapland)).toBeNull();
  });
});

const gs = (bf: unknown[]): GameState => ({ players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], battlefield: bf }) as unknown as GameState;

describe('batch22 revealed information flags', () => {
  it('Revelation reveals all hands', () => {
    const r = computeRevealedInformation(gs([perm('p1', 'Revelation', 'Players play with their hands revealed.')]));
    expect(r.handsRevealed).toEqual(['p1', 'p2', 'p3']);
    expect(r.sources).toEqual(['Revelation']);
  });
  it('Telepathy reveals opponents only', () => {
    expect(computeRevealedInformation(gs([perm('p1', 'Telepathy', 'Your opponents play with their hands revealed.')])).handsRevealed).toEqual(['p2', 'p3']);
  });
  it('library top: controller-only vs all players', () => {
    expect(computeRevealedInformation(gs([perm('p2', 'Future Sight', 'Play with the top card of your library revealed.\nYou may play lands and cast spells from the top of your library.')])).libraryTopRevealed).toEqual(['p2']);
    expect(computeRevealedInformation(gs([perm('p1', 'Field of Dreams', 'Players play with the top card of their libraries revealed.')])).libraryTopRevealed).toEqual(['p1', 'p2', 'p3']);
  });
  it('refresh sets, keeps, and clears the flag', () => {
    const s = gs([perm('p1', 'Revelation', 'Players play with their hands revealed.')]);
    expect(refreshRevealedInformationFlags(s)).toBe(true);
    expect(refreshRevealedInformationFlags(s)).toBe(false);
    s.battlefield = [];
    expect(refreshRevealedInformationFlags(s)).toBe(true);
    expect(s.revealedInformation).toBeUndefined();
  });
});
