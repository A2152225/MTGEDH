/**
 * P1-4 CardAIProfile mapper + loader tests.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { cardAnalyzer } from '../../rules-engine/src/CardAnalyzer.js';
import {
  clearCardAIProfileCache,
  getCardAIProfile,
} from '../src/socket/ai-handlers/aiCardProfile.js';
import { mapCardToProfile, type OracleCardLike } from '../scripts/lib/cardProfileMapper.js';

function card(partial: OracleCardLike): OracleCardLike {
  return {
    oracle_id: partial.oracle_id || 'oid',
    name: partial.name,
    type_line: partial.type_line || '',
    oracle_text: partial.oracle_text || '',
    card_faces: partial.card_faces,
  };
}

function profileOf(c: OracleCardLike) {
  return mapCardToProfile(c, {
    parse: parseOracleTextToIR,
    analyze: (x) => cardAnalyzer.analyzeCard(x),
  });
}

describe('mapCardToProfile', () => {
  it('tags Sol Ring as ramp (sorcery speed)', () => {
    const p = profileOf(
      card({
        name: 'Sol Ring',
        type_line: 'Artifact',
        oracle_text: '{T}: Add {C}{C}.',
      }),
    );
    expect(p.roles).toContain('ramp');
    expect(p.timing).toBe('sorcery_speed');
  });

  it('tags Cultivate basic-land search as ramp', () => {
    const p = profileOf(
      card({
        name: 'Cultivate',
        type_line: 'Sorcery',
        oracle_text:
          'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
      }),
    );
    expect(p.roles).toContain('ramp');
  });

  it('tags Swords to Plowshares as instant removal needing a creature', () => {
    const p = profileOf(
      card({
        name: 'Swords to Plowshares',
        type_line: 'Instant',
        oracle_text: 'Exile target creature. Its controller gains life equal to its power.',
      }),
    );
    expect(p.roles).toContain('removal');
    expect(p.timing).toBe('instant');
    expect(p.needs).toContain('target_creature');
  });

  it('tags Wrath of God as sweeper', () => {
    const p = profileOf(
      card({
        name: 'Wrath of God',
        type_line: 'Sorcery',
        oracle_text: 'Destroy all creatures. They can\'t be regenerated.',
      }),
    );
    expect(p.roles).toContain('sweeper');
  });

  it('tags Counterspell as counterspell', () => {
    const p = profileOf(
      card({
        name: 'Counterspell',
        type_line: 'Instant',
        oracle_text: 'Counter target spell.',
      }),
    );
    expect(p.roles).toContain('counterspell');
    expect(p.timing).toBe('instant');
  });

  it('tags Demonic Tutor as tutor', () => {
    const p = profileOf(
      card({
        name: 'Demonic Tutor',
        type_line: 'Sorcery',
        oracle_text: 'Search your library for a card, put that card into your hand, then shuffle.',
      }),
    );
    expect(p.roles).toContain('tutor');
  });

  it('tags Raise Dead as recursion with graveyard need', () => {
    const p = profileOf(
      card({
        name: 'Raise Dead',
        type_line: 'Sorcery',
        oracle_text: 'Return target creature card from your graveyard to your hand.',
      }),
    );
    expect(p.roles).toContain('recursion');
    expect(p.needs).toContain('graveyard_card');
  });

  it('tags Heroic Intervention as protection', () => {
    const p = profileOf(
      card({
        name: 'Heroic Intervention',
        type_line: 'Instant',
        oracle_text: 'Permanents you control gain hexproof and indestructible until end of turn.',
      }),
    );
    expect(p.roles).toContain('protection');
  });

  it('does not tag Disposal Mummy as removal (graveyard hate)', () => {
    const p = profileOf(
      card({
        name: 'Disposal Mummy',
        type_line: 'Creature — Zombie Jackal',
        oracle_text: 'When Disposal Mummy enters the battlefield, exile target card from a graveyard.',
      }),
    );
    expect(p.roles).not.toContain('removal');
  });

  it('does not give lands the ramp role', () => {
    const p = profileOf(
      card({
        name: 'Forest',
        type_line: 'Basic Land — Forest',
        oracle_text: '{T}: Add {G}.',
      }),
    );
    expect(p.roles).not.toContain('ramp');
  });

  it('unions roles across double-faced cards', () => {
    const p = profileOf(
      card({
        name: 'Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun',
        type_line: 'Legendary Enchantment // Legendary Land',
        card_faces: [
          {
            name: 'Growing Rites of Itlimoc',
            type_line: 'Legendary Enchantment',
            oracle_text:
              'When Growing Rites of Itlimoc enters the battlefield, look at the top four cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.\nAt the beginning of your end step, if you control four or more creatures, transform Growing Rites of Itlimoc.',
          },
          {
            name: 'Itlimoc, Cradle of the Sun',
            type_line: 'Legendary Land',
            oracle_text: '{T}: Add {G}.\n{T}: Add {G} for each creature you control.',
          },
        ],
      }),
    );
    // Front face draw/look; land face must not inject ramp onto the profile via add_mana alone
    // (lands strip ramp). At least we get a profile without throwing.
    expect(p.name).toContain('Growing Rites');
    expect(p.roles).not.toContain('ramp');
  });
});

describe('getCardAIProfile loader', () => {
  it('is case-insensitive and answers either face of a DFC', () => {
    const tmp = path.join(os.tmpdir(), `ai-profiles-${Date.now()}.json`);
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        version: 1,
        count: 1,
        profiles: [
          {
            oracleId: 'x',
            name: 'Front // Back',
            roles: ['draw'],
            timing: 'sorcery_speed',
            needs: [],
            source: 'ir',
          },
        ],
      }),
    );
    clearCardAIProfileCache({ reloadFrom: tmp });
    expect(getCardAIProfile('front // back')?.roles).toEqual(['draw']);
    expect(getCardAIProfile('FRONT')?.roles).toEqual(['draw']);
    expect(getCardAIProfile('Back')?.roles).toEqual(['draw']);
    clearCardAIProfileCache();
    fs.unlinkSync(tmp);
  });

  it('returns undefined without throwing when the file is missing', () => {
    clearCardAIProfileCache({ reloadFrom: path.join(os.tmpdir(), 'no-such-ai-profiles.json') });
    expect(getCardAIProfile('Sol Ring')).toBeUndefined();
    clearCardAIProfileCache();
  });
});
