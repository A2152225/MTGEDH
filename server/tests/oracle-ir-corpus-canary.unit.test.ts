import { describe, expect, it } from 'vitest';

import {
  MUST_COVER_CARD_NAMES,
  assessCard,
  assessNamedCards,
  classifyCanaryItem,
  holeItems,
  ownedUnexecutedItems,
} from '../scripts/oracle-ir-corpus-canary.ts';

describe('oracle IR corpus canary', () => {
  it('classifies a wired draw as covered and unknown text as a parse hole', () => {
    const draw = classifyCanaryItem('Test Draw', 'trigger_effect', 'Draw a card.');
    expect(draw.hole).toBe('covered');
    expect(draw.status).toBe('fully_applied');
    expect(draw.wired).toBe(true);

    const unknown = classifyCanaryItem(
      'Test Unknown',
      'trigger_effect',
      'Fblthp the nameless clause does a unique unparsed thing.',
    );
    expect(unknown.hole).not.toBe('owned_unexecuted');
    expect(['parse_unknown', 'unwired']).toContain(unknown.hole);
  });

  it('keeps must-cover cards out of owned-unexecuted (IR apply, not just ownership)', () => {
    const items = assessNamedCards(MUST_COVER_CARD_NAMES);
    const named = new Set(items.map((item) => item.name));
    expect([...MUST_COVER_CARD_NAMES].filter((name) => !named.has(name))).toEqual([]);
    const missing = items.filter((item) => item.effect.startsWith('(missing') || item.effect.startsWith('(no parsed'));
    expect(missing, missing.map((item) => `${item.name} ${item.effect}`).join(', ')).toEqual([]);

    const silentSkips = ownedUnexecutedItems(items);
    expect(
      silentSkips,
      silentSkips.map((item) => `${item.name} [${item.status}] ${item.effect}`).join('\n'),
    ).toEqual([]);

    const holes = holeItems(items).filter((item) => item.hole === 'parse_unknown');
    expect(
      holes,
      holes.map((item) => `${item.name} ${item.effect}`).join('\n'),
    ).toEqual([]);
  });

  it('covers Disposal Mummy exile and Green Sun Twilight among-them choice', () => {
    const items = assessNamedCards(['Disposal Mummy', "Green Sun's Twilight"]);
    expect(
      items.map((item) => `${item.name} ${item.hole} ${item.status}`),
    ).not.toEqual([]);
    const silentSkips = ownedUnexecutedItems(items);
    expect(
      silentSkips,
      silentSkips.map((item) => `${item.name} [${item.status}] ${item.effect}`).join('\n'),
    ).toEqual([]);
    expect(items.every((item) => item.hole === 'covered')).toBe(true);
    expect(['fully_applied', 'choice_required']).toContain(
      items.find((item) => item.name === 'Disposal Mummy')?.status,
    );
    expect(['fully_applied', 'choice_required']).toContain(
      items.find((item) => item.name === "Green Sun's Twilight")?.status,
    );
  });

  it('assesses prepare-layout faces separately instead of concatenating oracle', () => {
    const concatenated = classifyCanaryItem(
      'Maelstrom Artisan // Rocket Volley',
      'spell',
      "Haste This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.) Destroy target nonbasic land.",
      'Creature — Minotaur Sorcerer // Sorcery',
    );
    expect(concatenated.hole).toBe('parse_unknown');

    const items = assessCard({
      name: 'Maelstrom Artisan // Rocket Volley',
      type_line: 'Creature — Minotaur Sorcerer // Sorcery',
      card_faces: [
        {
          name: 'Maelstrom Artisan',
          type_line: 'Creature — Minotaur Sorcerer',
          oracle_text:
            "Haste\nThis creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
        },
        {
          name: 'Rocket Volley',
          type_line: 'Sorcery',
          oracle_text: 'Destroy target nonbasic land.',
        },
      ],
    });
    expect(items.some((item) => /Haste.*Destroy target/i.test(item.effect))).toBe(false);
    expect(items.filter((item) => item.hole === 'parse_unknown')).toEqual([]);
    const volley = items.find((item) => item.name === 'Rocket Volley');
    expect(volley?.scope).toBe('spell');
    expect(volley?.hole).toBe('covered');
  });

  it('covers Glimpse of Tomorrow shuffle after Suspend prefix', () => {
    const items = assessNamedCards(['Glimpse of Tomorrow']);
    expect(items.length).toBeGreaterThan(0);
    expect(ownedUnexecutedItems(items)).toEqual([]);
    expect(items.every((item) => item.hole === 'covered')).toBe(true);
    expect(items.some((item) => item.dryRunSteps > 0)).toBe(true);
  });

  it('covers remaining corpus-canary apply holes (phase-out, choice, copy, delayed destroy)', () => {
    const names = [
      'Political Triumph',
      "Teferi's Protection",
      'The Eagles Are Coming!',
      'Nemesis Trap',
      'Entrapment Maneuver',
      'Hex Magic',
      "Siren's Call",
    ] as const;
    const items = assessNamedCards(names);
    expect([...new Set(items.map((item) => item.name))].sort()).toEqual([...names].sort());
    const silentSkips = ownedUnexecutedItems(items);
    expect(
      silentSkips,
      silentSkips.map((item) => `${item.name} [${item.status}] ${item.effect}`).join('\n'),
    ).toEqual([]);
    expect(items.filter((item) => item.hole === 'parse_unknown')).toEqual([]);
    expect(items.every((item) => item.hole === 'covered')).toBe(true);
  });

  it('splits Punishing Fire graveyard whenever off the spell', () => {
    const items = assessNamedCards(['Punishing Fire']);
    expect(items.some((item) => item.scope === 'spell')).toBe(true);
    expect(items.some((item) => item.scope === 'trigger_effect')).toBe(true);
    expect(items.filter((item) => item.hole === 'parse_unknown')).toEqual([]);
  });

  it('covers keyword-prefix and discard-all canary holes', () => {
    const names = [
      'Dead Drop',
      'Eagle Vision',
      'Seeds of Renewal',
      'Secrets of the Golden City',
      'Persecute',
      'Trapfinder\'s Trick',
      'Coastal Breach',
      'Temporal Trespass',
      'Fire Nation Attacks',
      'Skull Storm',
      'Pause for Reflection',
      'Radstorm',
      'Summer Bloom',
      'Parnesse, the Subtle Brush',
      'Indulgent Tormentor',
      'Complete the Circuit',
      'Temporal Cleansing',
      'Metamorphic Blast',
      "Gaea's Will",
      'Despair',
      'Winnowing',
      'Riches',
      'Curse of the Cabal',
      'Hypergenesis',
      "Lumaret's Favor",
      'Unnatural Moonrise',
      'Processor Assault',
      'Double Jump',
      'Raking Canopy',
      'Tempt with Mayhem',
      'Early Harvest',
      "Garruk's Harbinger",
      'Lathnu Hellion',
      'Helicarrier Strike',
      'Fettergeist',
      'Vines of Vastwood',
      "Urza's Rage",
    ] as const;
    const items = assessNamedCards(names);
    const holes = holeItems(items).filter((item) => item.hole === 'parse_unknown');
    expect(
      holes,
      holes.map((item) => `${item.name} ${item.effect}`).join('\n'),
    ).toEqual([]);
    const silentSkips = ownedUnexecutedItems(items);
    expect(
      silentSkips,
      silentSkips.map((item) => `${item.name} [${item.hole}] ${item.effect}`).join('\n'),
    ).toEqual([]);
    expect(items.filter((item) => item.hole === 'unwired')).toEqual([]);
    expect(items.filter((item) => item.name === 'Fire Nation Attacks' && item.scope === 'trigger_effect')).toEqual([]);
    expect(
      assessNamedCards(['Radstorm']).filter((item) => item.scope === 'trigger_effect'),
    ).toEqual([]);
  });

  it('covers remaining owned-unexecuted apply/choice clusters', () => {
    const names = [
      'Modify Memory',
      'Fowl Strike',
      'Power Pack',
      'Corrosive Ooze',
      'Bronze Bombshell',
      'Slingbow Trap',
      'Defiant Vanguard',
      'Blasphemous Edict',
      'Death Mutation',
      'Marchesa, Resolute Monarch',
      "Kytheon's Tactics",
      'Time and Tide',
      'Crumble to Dust',
      'Battering Ram',
      'Concussive Bolt',
      'Essence Backlash',
      'Viv Vision, Teen Synthezoid',
      'Boreas Charger',
      'Repulsor Bots',
      'Living Laser',
      'Flame On!',
      'Truth or Consequences',
      'Demonlord Belzenlok',
      'Triumph of Saint Katherine',
      'Anticognition',
      'Hawkeye, Master Marksman',
      "Doom's Time Platform",
      'Negative Zone Portal',
      'Hazel of the Rootbloom',
      'Gather the Pack',
      'Cut Propulsion',
      'Winter Soldier, Reborn Avenger',
    ] as const;
    const items = assessNamedCards(names);
    const silentSkips = ownedUnexecutedItems(items);
    expect(
      silentSkips,
      silentSkips.map((item) => `${item.name} [${item.hole}] ${item.effect}`).join('\n'),
    ).toEqual([]);
  });

  it('covers two-target, bolster, and library top-or-bottom as choices or applies', () => {
    const names = [
      "Curtains' Call",
      'Hinder',
      'Not Forgotten',
      'Enduring Victory',
      'Pinion Feast',
      'Jeskai Revelation',
      'Last-Ditch Effort',
      'Gone Fishing',
      'Divergent Transformations',
      'Dwarven Mattock',
    ] as const;
    const items = assessNamedCards(names);
    const silentSkips = ownedUnexecutedItems(items);
    expect(
      silentSkips,
      silentSkips.map((item) => `${item.name} [${item.hole}] ${item.effect}`).join('\n'),
    ).toEqual([]);
  });
});
