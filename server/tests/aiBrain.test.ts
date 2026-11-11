/**
 * P1-5 brain switch tests.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyBrain,
  getSeatBrain,
  takeShadow,
} from '../src/socket/ai-handlers/aiBrain.js';
import type { AIActionCandidate } from '../src/socket/ai-handlers/aiActionCandidateTypes.js';
import * as buildObservationMod from '../../rules-engine/src/ai/buildObservation.js';
import { clearCardAIProfileCache } from '../src/socket/ai-handlers/aiCardProfile.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function spell(name: string, priority: number): AIActionCandidate {
  return {
    kind: 'cast_spell',
    priority,
    spell: {
      card: { name, type_line: 'Sorcery' },
      castCard: { name, type_line: 'Sorcery' },
      sourceZone: 'hand',
      cost: {},
      cmc: 2,
      typeLine: 'Sorcery',
      priority: 10,
    },
  };
}

function minimalGame(seatBrain?: string) {
  return {
    state: {
      turnNumber: 3,
      phase: 'main',
      step: 'MAIN1',
      turnPlayer: 'p1',
      activePlayer: 'p1',
      priority: 'p1',
      life: { p1: 40, p2: 40 },
      players: [
        { id: 'p1', life: 40, ...(seatBrain ? { aiBrain: seatBrain } : {}) },
        { id: 'p2', life: 40 },
      ],
      manaPool: {
        p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      commanderDamage: {},
      zones: {
        p1: { hand: [{ id: 'h1', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.' }], graveyard: [], exile: [], libraryCount: 90 },
        p2: { hand: [], graveyard: [], exile: [], libraryCount: 90 },
      },
      battlefield: [],
      stack: [],
    },
  };
}

describe('aiBrain', () => {
  afterEach(() => {
    delete process.env.AI_BRAIN;
    clearCardAIProfileCache();
    vi.restoreAllMocks();
  });

  it('getSeatBrain: seat aiBrain beats AI_BRAIN env', () => {
    process.env.AI_BRAIN = 'v1';
    expect(getSeatBrain(minimalGame('shadow'), 'p1')).toBe('shadow');
    expect(getSeatBrain(minimalGame(), 'p1')).toBe('v1');
  });

  it('v0 returns the same array and does not call buildObservation', () => {
    const spy = vi.spyOn(buildObservationMod, 'buildObservation');
    const sorted = [spell('A', 10), spell('B', 5)];
    const out = applyBrain(minimalGame('v0'), 'p1', { mode: 'main' }, sorted);
    expect(out).toBe(sorted);
    expect(spy).not.toHaveBeenCalled();
    expect(takeShadow(out)).toBeUndefined();
  });

  it('shadow returns the same array and takeShadow yields a record', () => {
    const sorted = [spell('Sol Ring', 80), spell('Unknown', 40)];
    const out = applyBrain(minimalGame('shadow'), 'p1', { mode: 'main' }, sorted);
    expect(out).toBe(sorted);
    const shadow = takeShadow(out);
    expect(shadow?.brain).toBe('shadow');
    expect(shadow?.scores.length).toBe(2);
    expect(takeShadow(out)).toBeUndefined();
  });

  it('v1 reorders and can drop gated candidates', () => {
    const tmp = path.join(os.tmpdir(), `ai-brain-profiles-${Date.now()}.json`);
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        version: 1,
        count: 1,
        profiles: [
          {
            oracleId: '1',
            name: 'Wrath of God',
            roles: ['sweeper'],
            timing: 'sorcery_speed',
            needs: [],
            source: 'ir',
          },
        ],
      }),
    );
    clearCardAIProfileCache({ reloadFrom: tmp });

    // Ahead on board → sweeper gated/dropped; Unknown keeps v0 relative presence.
    const game = minimalGame('v1');
    game.state.battlefield = [
      {
        id: 'c1',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        summoningSickness: false,
        counters: {},
        effectivePower: 6,
        effectiveToughness: 6,
        card: { id: 'c1', name: 'Big', type_line: 'Creature — Beast', oracle_text: '', power: '6', toughness: '6' },
      },
      {
        id: 'c2',
        controller: 'p1',
        owner: 'p1',
        tapped: false,
        summoningSickness: false,
        counters: {},
        effectivePower: 5,
        effectiveToughness: 5,
        card: { id: 'c2', name: 'Big2', type_line: 'Creature — Beast', oracle_text: '', power: '5', toughness: '5' },
      },
    ];
    const sorted = [spell('Wrath of God', 999), spell('Unknown', 10)];
    const out = applyBrain(game, 'p1', { mode: 'main' }, sorted);
    expect(out.map((c) => (c.kind === 'cast_spell' ? c.spell.castCard.name : ''))).toEqual([
      'Unknown',
    ]);
    const shadow = takeShadow(out);
    expect(shadow?.brain).toBe('v1');
    fs.unlinkSync(tmp);
    clearCardAIProfileCache();
  });

  it('still runs when Math.random throws', () => {
    const orig = Math.random;
    Math.random = () => {
      throw new Error('rng');
    };
    try {
      for (const brain of ['v0', 'shadow', 'v1'] as const) {
        const sorted = [spell('Sol Ring', 50)];
        expect(() => applyBrain(minimalGame(brain), 'p1', { mode: 'main' }, sorted)).not.toThrow();
      }
    } finally {
      Math.random = orig;
    }
  });
});
