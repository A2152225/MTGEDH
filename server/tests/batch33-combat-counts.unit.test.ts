import { describe, it, expect } from 'vitest';
import { controlCountAttackRestrictionReason, moreCreaturesBlockRestrictionReason } from '../src/socket/combat-handlers/combatBatch33AttackRestrictions.js';

const mk = (id: string, controller: string, type_line: string, oracle_text = '') => ({ id, controller, card: { name: id, type_line, oracle_text } });

describe('B33 combat count gates', () => {
  it('Steelclad Serpent needs another artifact', () => {
    const serpent = mk('s', 'p1', 'Artifact Creature \u2014 Serpent', "Steelclad Serpent can't attack unless you control another artifact.".replace('Steelclad Serpent', 'this'));
    expect(controlCountAttackRestrictionReason(serpent, 'p2', [serpent])).toMatch(/another artifact/);
    expect(controlCountAttackRestrictionReason(serpent, 'p2', [serpent, mk('r', 'p1', 'Artifact')])).toBeNull();
  });
  it('Mogg Toady attack and block counts', () => {
    const toady = mk('t', 'p1', 'Creature \u2014 Goblin', "This creature can't attack unless you control more creatures than defending player.\nThis creature can't block unless you control more creatures than attacking player.");
    const foe = mk('f', 'p2', 'Creature \u2014 Bear');
    expect(controlCountAttackRestrictionReason(toady, 'p2', [toady, foe])).toMatch(/more creatures/);
    expect(controlCountAttackRestrictionReason(toady, 'p2', [toady, foe, mk('x', 'p1', 'Creature')])).toBeNull();
    expect(moreCreaturesBlockRestrictionReason(toady, foe, [toady, foe])).toMatch(/more creatures/);
    expect(moreCreaturesBlockRestrictionReason(toady, foe, [toady, foe, mk('x', 'p1', 'Creature')])).toBeNull();
  });
});
