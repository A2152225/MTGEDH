import { describe, expect, it } from 'vitest';
import { applyTriggerDoublers, detectTriggerDoublers } from '../src/state/modules/triggers/trigger-doublers.js';

const BIFUR = 'Storied (If you control three or more artifacts, legendaries, and/or Sagas, you have an enduring story for the rest of the game.)\nAs long as you have an enduring story, if a triggered ability of a Dwarf you control triggers, that ability triggers an additional time.';
const CHIEF = 'If a triggered ability of another Wolf or battle you control triggers, that ability triggers an additional time.';
const perm = (id: string, controller: string, name: string, type_line: string, oracle_text = '') => ({ id, controller, owner: controller, card: { name, type_line, oracle_text } });
const trig = (permanentId: string) => [{ permanentId, cardName: permanentId, description: 'draw a card', controller: 'p1' } as any];
const run = (doublers: any[], source: any, bf: any[], gameState?: any) => applyTriggerDoublers(trig(source.id), doublers, 'any', source, bf, gameState ? { gameState } as any : undefined).length;

describe('tribal / card-type source trigger doublers', () => {
  const bifur = perm('bifur', 'p1', 'Bifur, Melodic Rider', 'Legendary Creature — Dwarf Bard', BIFUR);
  const dwarf = perm('d1', 'p1', 'Dwarf Miner', 'Creature — Dwarf Citizen');
  const elf = perm('e1', 'p1', 'Elf', 'Creature — Elf');
  const art1 = perm('a1', 'p1', 'Rock', 'Artifact');
  const art2 = perm('a2', 'p1', 'Rock 2', 'Artifact');

  it('Bifur is supported, not an unsupported fallback', () => {
    const d = detectTriggerDoublers([bifur], 'p1');
    expect(d).toHaveLength(1);
    expect(d[0].unsupportedReason).toBeFalsy();
  });

  it('Bifur doubles Dwarf triggers only with an enduring story (3+ artifacts/legendaries/Sagas)', () => {
    const bf = [bifur, dwarf, elf];
    const d = detectTriggerDoublers(bf, 'p1');
    // Bifur alone is one legendary: no story yet.
    expect(run(d, dwarf, bf)).toBe(1);
    const storied = [...bf, art1, art2];
    expect(run(detectTriggerDoublers(storied, 'p1'), dwarf, storied)).toBe(2);
    // Bifur itself is a Dwarf (not "another") and doubles too; an Elf never does.
    expect(run(detectTriggerDoublers(storied, 'p1'), bifur, storied)).toBe(2);
    expect(run(detectTriggerDoublers(storied, 'p1'), elf, storied)).toBe(1);
    // The recorded designation persists after the permanents leave.
    expect(run(d, dwarf, bf, { enduringStory: { p1: true }, battlefield: bf })).toBe(2);
  });

  it('Chief of the Wilds doubles another Wolf or battle, never itself or other types', () => {
    const chief = perm('chief', 'p1', 'Chief of the Wilds', 'Creature — Wolf Warrior', CHIEF);
    const wolf = perm('w1', 'p1', 'Wolf', 'Creature — Wolf');
    const battle = perm('b1', 'p1', 'Invasion', 'Battle — Siege');
    const bear = perm('br', 'p1', 'Bear', 'Creature — Bear');
    const bf = [chief, wolf, battle, bear];
    const d = detectTriggerDoublers(bf, 'p1');
    expect(d).toHaveLength(1);
    expect(d[0].unsupportedReason).toBeFalsy();
    expect(run(d, wolf, bf)).toBe(2);
    expect(run(d, battle, bf)).toBe(2);
    expect(run(d, chief, bf)).toBe(1);
    expect(run(d, bear, bf)).toBe(1);
  });
});