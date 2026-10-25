import { describe, expect, it } from 'vitest';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/attack-triggers-for-creatures.js';
import { getETBTriggersForPermanent } from '../src/state/modules/triggers/etb-detection.js';
import { getDeathTriggers } from '../src/state/modules/triggered-abilities.js';
import {
  permanentHasTriggeredAbilities,
  syncTriggeredAbilityLossStamps,
} from '../src/state/modules/triggers/triggeredAbilitySuppression.js';

function perm(id: string, controller: string, card: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id, controller, owner: controller, tapped: false, counters: {}, card: { id: `${id}_card`, ...card }, ...extra };
}

function ctxFor(battlefield: any[]) {
  const state: any = {
    seq: 1, stack: [], battlefield, turnPlayer: 'p1', activePlayer: 'p1',
    players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }],
    zones: {
      p1: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      p2: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    },
  };
  return { state, gameId: 'trigger_suppression', bumpSeq() { state.seq += 1; }, isReplaying: false } as any;
}

const humility = () => perm('humility', 'p2', {
  name: 'Humility', type_line: 'Enchantment',
  oracle_text: 'All creatures lose all abilities and have base power and toughness 1/1.',
});
const attacker = () => perm('raider', 'p1', {
  name: 'Sample Raider', type_line: 'Creature \u2014 Human Warrior', power: '2', toughness: '2',
  oracle_text: 'Whenever Sample Raider attacks, draw a card.',
});
const etbCreature = () => perm('elf', 'p1', {
  name: 'Sample Visionary', type_line: 'Creature \u2014 Elf', power: '1', toughness: '1',
  oracle_text: 'When Sample Visionary enters, draw a card.',
});
const diesCreature = (extra: Record<string, unknown> = {}) => perm('imp', 'p1', {
  name: 'Sample Imp', type_line: 'Creature \u2014 Imp', power: '1', toughness: '1',
  oracle_text: 'When Sample Imp dies, draw a card.',
}, extra);

describe('triggered-ability suppression (Humility / Turn to Frog / Torpor Orb)', () => {
  it('an unaffected creature still has its attack, ETB and dies triggers', () => {
    const raider = attacker();
    expect(getAttackTriggersForCreatures(ctxFor([raider]), [raider], 'p1', 'p2').length).toBeGreaterThan(0);
    const elf = etbCreature();
    expect(getETBTriggersForPermanent(elf.card, elf, ctxFor([elf]).state).length).toBeGreaterThan(0);
    const imp = diesCreature();
    expect(getDeathTriggers(ctxFor([]), imp, 'p1').length).toBeGreaterThan(0);
  });

  it('Humility stops an attack trigger', () => {
    const raider = attacker();
    expect(getAttackTriggersForCreatures(ctxFor([raider, humility()]), [raider], 'p1', 'p2')).toEqual([]);
  });

  it('Humility stops an ETB trigger', () => {
    const elf = etbCreature();
    expect(getETBTriggersForPermanent(elf.card, elf, ctxFor([elf, humility()]).state)).toEqual([]);
  });

  it('Turn to Frog stops a dies trigger (last-known state)', () => {
    const imp = diesCreature({
      temporaryEffects: [{ effect: 'Until end of turn, this creature loses all abilities and becomes a blue Frog with base power and toughness 1/1.' }],
    });
    expect(getDeathTriggers(ctxFor([]), imp, 'p1')).toEqual([]);
  });

  it('a creature that died alongside Humility keeps its LKI loss stamp', () => {
    const imp = diesCreature();
    const ctx = ctxFor([imp, humility()]);
    syncTriggeredAbilityLossStamps(ctx.state);
    ctx.state.battlefield = [];
    expect(getDeathTriggers(ctx, imp, 'p1')).toEqual([]);
  });

  it('Darksteel Mutation-style Aura removes the host abilities', () => {
    const raider = attacker();
    const aura = perm('mutation', 'p2', {
      name: 'Sample Mutation', type_line: 'Enchantment \u2014 Aura',
      oracle_text: 'Enchant creature\nEnchanted creature is an Insect artifact creature with base power and toughness 0/1 and has indestructible, and it loses all other abilities.',
    }, { attachedTo: 'raider' });
    (raider as any).attachments = ['mutation'];
    expect(permanentHasTriggeredAbilities(raider, ctxFor([raider, aura]).state)).toBe(false);
  });

  it('Torpor Orb stops creature-entering triggers but not noncreature ones', () => {
    const orb = perm('orb', 'p2', {
      name: 'Torpor Orb', type_line: 'Artifact',
      oracle_text: "Creatures entering the battlefield don't cause abilities to trigger.",
    });
    const elf = etbCreature();
    const state = ctxFor([elf, orb]).state;
    expect(permanentHasTriggeredAbilities(elf, state, { event: 'etb', eventSubject: elf })).toBe(false);
    expect(permanentHasTriggeredAbilities(orb, state, { event: 'etb', eventSubject: orb })).toBe(true);
    expect(permanentHasTriggeredAbilities(elf, state, { event: 'dies', eventSubject: elf })).toBe(true);
  });
});