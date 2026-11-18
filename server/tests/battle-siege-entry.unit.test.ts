import { describe, expect, it } from 'vitest';
import {
  applyBattleDefenseCountersOnEntry,
  getBattleProtectorAsEntersRequirement,
  isSiegeCard,
  readPrintedBattleDefense,
} from '../src/state/modules/battleSiegeEntry.js';
import { getAsEntersChoiceRequirements } from '../src/state/modules/asEntersChoiceRequirements.js';

const invasion = {
  id: 'invasion_1',
  name: 'Invasion of Zendikar // Awakened Skyclave',
  layout: 'transform',
  type_line: 'Battle — Siege // Creature — Elemental',
  oracle_text: 'When this Siege enters, search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.',
  card_faces: [
    {
      name: 'Invasion of Zendikar',
      mana_cost: '{3}{G}',
      type_line: 'Battle — Siege',
      oracle_text:
        "(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it's defeated, exile it, then cast it transformed.)\nWhen this Siege enters, search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.",
      defense: '3',
    },
    {
      name: 'Awakened Skyclave',
      mana_cost: '',
      type_line: 'Creature — Elemental',
      oracle_text: 'Vigilance, haste\nAs long as this creature is on the battlefield, it\'s a land in addition to its other types.',
      power: '4',
      toughness: '4',
    },
  ],
};

describe('battle / siege entry', () => {
  it('reads printed defense and stamps defense counters', () => {
    expect(isSiegeCard(invasion)).toBe(true);
    expect(readPrintedBattleDefense(invasion)).toBe(3);
    const permanent: any = { id: 'b1', card: { ...invasion }, counters: {} };
    expect(applyBattleDefenseCountersOnEntry(permanent, invasion)).toBe(3);
    expect(permanent.counters.defense).toBe(3);
    expect(permanent.defense).toBe(3);
  });

  it('requires an opponent protector choice even when reminder text would be scrubbed', () => {
    expect(getBattleProtectorAsEntersRequirement(invasion)?.kind).toBe('opponent');
    const reqs = getAsEntersChoiceRequirements(invasion);
    expect(reqs.some((req) => req.kind === 'opponent')).toBe(true);
    expect(reqs.find((req) => req.kind === 'opponent')?.reason).toMatch(/protect/i);
  });
});
