import { describe, it, expect } from 'vitest';
import { parseActivatedAbilities } from './activatedAbilityParser-handlers/parseActivatedAbilities';
import { buildLibrarySearchModalStateFromStep } from './resolutionChoicePrimitives';

const equip = (oracle_text: string): any => ({ id: 'r1', name: 'Census Ripper', type_line: 'Artifact Creature \u2014 Equipment Robot', oracle_text });

describe('UI40 reconfigure cost forms', () => {
  it('classic "Reconfigure {2}"', () => {
    const abs = parseActivatedAbilities(equip('Reconfigure {2}'));
    expect(abs.map((a: any) => a.id)).toEqual(expect.arrayContaining([expect.stringMatching(/-reconfigure-attach-\d+$/), expect.stringMatching(/-reconfigure-unattach-\d+$/)]));
  });
  it('em-dash "Pay ... or ..." form (Razorfield Ripper style)', () => {
    const abs: any[] = parseActivatedAbilities(equip('Reconfigure\u2014Pay {2} or {E}{E}{E}.'));
    const attach = abs.find((a) => /-reconfigure-attach-/.test(a.id));
    expect(attach).toBeTruthy();
    expect(attach.cost).toBe('{2} or {E}{E}{E}');
    expect(abs.some((a) => /-reconfigure-unattach-/.test(a.id))).toBe(true);
  });
  it('em-dash single mana cost', () => {
    const abs: any[] = parseActivatedAbilities(equip('Reconfigure\u2014{1}{G}'));
    expect(abs.find((a) => /-reconfigure-attach-/.test(a.id))?.cost).toBe('{1}{G}');
  });
});

describe('UI40 linked-exile choice reuses the library-search modal', () => {
  it('titles exile picks and keeps card images', () => {
    const s = buildLibrarySearchModalStateFromStep({
      id: 's1', sourceName: 'Borg Cube', searchZone: 'exile', searchCriteria: 'assimilate a creature card exiled with it',
      availableCards: [{ id: 'e1', name: 'Bear', imageUrl: 'http://img/e1.jpg' }], minSelections: 1, maxSelections: 1, destination: 'battlefield',
    });
    expect(s.title).toBe('Borg Cube: Choose from exile');
    expect(s.cards[0].image_uris?.normal).toBe('http://img/e1.jpg');
  });
});