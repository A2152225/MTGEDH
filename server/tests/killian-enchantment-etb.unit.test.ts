import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState';
import { detectETBTriggers } from '../src/state/modules/triggered-abilities.js';
import { queueSelfETBTriggersForPermanent } from '../src/state/modules/triggerEtbEntryEffects.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { queuePermanentEntersBattlefieldTriggerStackItems } from '../src/state/modules/stackResolvePermanentEtbTriggerUtils.js';
import { getAttackTriggersForCreatures } from '../src/state/modules/triggers/combat.js';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { TriggerEvent } from '../../rules-engine/src/triggeredAbilitiesTypes.js';
import { checkTrigger } from '../../rules-engine/src/triggeredAbilitiesMatching.js';

// Oracle from oracle-cards.jsonl (Killian, Decisive Mentor)
const KILLIAN_ORACLE =
  'Whenever an enchantment you control enters, tap up to one target creature and goad it. (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)\nWhenever one or more creatures that are enchanted by an Aura you control attack, draw a card.';

function killianPermanent(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: {
      id: `${id}_card`,
      name: 'Killian, Decisive Mentor',
      type_line: 'Legendary Creature — Human Warlock',
      oracle_text: KILLIAN_ORACLE,
      power: '2',
      toughness: '3',
    },
  };
}

function auraPermanent(id: string, controller: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    card: {
      id: `${id}_card`,
      name: 'Pacifism',
      type_line: 'Enchantment — Aura',
      oracle_text: 'Enchant creature\nEnchanted creature can\'t attack or block.',
    },
  };
}

describe('Killian, Decisive Mentor enchantment ETB', () => {
  it('detects enchantment_etb (you control) and not a self-ETB', () => {
    const triggers = detectETBTriggers(
      {
        name: 'Killian, Decisive Mentor',
        type_line: 'Legendary Creature — Human Warlock',
        oracle_text: KILLIAN_ORACLE,
      },
      { id: 'killian_1', controller: 'p1' },
    );

    expect(triggers.some((t) => t.triggerType === 'etb')).toBe(false);
    const enchantmentEtb = triggers.find((t) => t.triggerType === 'enchantment_etb');
    expect(enchantmentEtb).toBeDefined();
    expect(enchantmentEtb?.controlledOnly).toBe(true);
    expect(String(enchantmentEtb?.effect || '')).toMatch(/tap up to one target creature and goad it/i);
  });

  it('does not fire when Killian himself enters', () => {
    const g = createInitialGameState('t_killian_self_etb');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const killian = killianPermanent('killian_1', p1);
    (g.state.battlefield as any).push(killian);

    queueSelfETBTriggersForPermanent(g as any, killian, p1);
    expect(
      ((g.state.stack || []) as any[]).some(
        (s) => s?.sourceName === 'Killian, Decisive Mentor' && s?.triggerType === 'enchantment_etb',
      ),
    ).toBe(false);

    queuePermanentEntersBattlefieldTriggerStackItems(g as any, {
      controller: p1,
      card: killian.card,
      effectiveCard: killian.card,
      newPermanent: killian,
      newPermId: killian.id,
      isCreature: true,
    });
    expect(
      ((g.state.stack || []) as any[]).some(
        (s) => s?.sourceName === 'Killian, Decisive Mentor' && s?.triggerType === 'enchantment_etb',
      ),
    ).toBe(false);

    triggerETBEffectsForPermanent(g as any, killian, p1);
    expect(
      ((g.state.stack || []) as any[]).some(
        (s) => s?.sourceName === 'Killian, Decisive Mentor' && s?.triggerType === 'enchantment_etb',
      ),
    ).toBe(false);
  });

  it('fires when an enchantment you control enters, but not an opponent\'s', () => {
    const g = createInitialGameState('t_killian_enchantment_etb');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const killian = killianPermanent('killian_1', p1);
    (g.state.battlefield as any).push(killian);

    const ownAura = auraPermanent('aura_own', p1);
    (g.state.battlefield as any).push(ownAura);
    triggerETBEffectsForPermanent(g as any, ownAura, p1);

    const ownTrigger = ((g.state.stack || []) as any[]).find(
      (s) => s?.sourceName === 'Killian, Decisive Mentor' && s?.triggerType === 'enchantment_etb',
    );
    expect(ownTrigger).toBeTruthy();
    expect(ownTrigger?.source).toBe(killian.id);
    expect(ownTrigger?.requiresTarget || ownTrigger?.needsTargetSelection).toBeTruthy();

    g.state.stack = [] as any;
    const oppAura = auraPermanent('aura_opp', p2);
    (g.state.battlefield as any).push(oppAura);
    triggerETBEffectsForPermanent(g as any, oppAura, p2);
    expect(
      ((g.state.stack || []) as any[]).some(
        (s) => s?.sourceName === 'Killian, Decisive Mentor' && s?.triggerType === 'enchantment_etb',
      ),
    ).toBe(false);
  });

  it('parses the trigger as a filtered enchantment enter, not a self-ETB', () => {
    const abilities = parseTriggeredAbilitiesFromText(
      KILLIAN_ORACLE,
      'killian_1',
      'p1',
      'Killian, Decisive Mentor',
    );
    const etb = abilities.find((a) => a.event === TriggerEvent.ENTERS_BATTLEFIELD);
    expect(etb).toBeDefined();
    expect(String(etb?.triggerFilter || etb?.condition || '').toLowerCase()).toMatch(
      /an enchantment you control enters/,
    );
    expect(String(etb?.triggerFilter || etb?.condition || '').toLowerCase()).not.toMatch(
      /^this (?:creature|permanent) enters/,
    );

    const killianBf = { id: 'killian_1', controllerId: 'p1', types: ['creature'] };
    const auraBf = { id: 'aura_1', controllerId: 'p1', types: ['enchantment'] };
    expect(
      checkTrigger(etb!, TriggerEvent.ENTERS_BATTLEFIELD, {
        sourceId: 'killian_1',
        targetPermanentId: 'killian_1',
        sourceControllerId: 'p1',
        battlefield: [killianBf],
      }),
    ).toBe(false);
    expect(
      checkTrigger(etb!, TriggerEvent.ENTERS_BATTLEFIELD, {
        sourceId: 'aura_1',
        targetPermanentId: 'aura_1',
        sourceControllerId: 'p1',
        battlefield: [killianBf, auraBf],
      }),
    ).toBe(true);
  });
});

describe('Killian, Decisive Mentor attack-draw', () => {
  function creaturePermanent(id: string, controller: string, name = 'Grizzly Bears') {
    return {
      id,
      controller,
      owner: controller,
      tapped: true,
      counters: {},
      card: {
        id: `${id}_card`,
        name,
        type_line: 'Creature — Bear',
        oracle_text: '',
        power: '2',
        toughness: '2',
      },
    };
  }

  it('preserves the Aura-enchanted attack filter', () => {
    const abilities = parseTriggeredAbilitiesFromText(
      KILLIAN_ORACLE,
      'killian_1',
      'p1',
      'Killian, Decisive Mentor',
    );
    const attack = abilities.find((a) => a.event === TriggerEvent.ATTACKS);
    expect(attack).toBeDefined();
    expect(String(attack?.triggerFilter || attack?.condition || '').toLowerCase()).toMatch(
      /enchanted by an aura you control/,
    );
    expect(String(attack?.effect || '').toLowerCase()).toMatch(/draw a card/);
  });

  it('fires once when an Aura-enchanted creature you control attacks', () => {
    const g = createInitialGameState('t_killian_attack_draw');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const killian = killianPermanent('killian_1', p1);
    const attacker = creaturePermanent('bear_1', p1);
    const extra = creaturePermanent('bear_2', p1, 'Runeclaw Bear');
    const aura = {
      ...auraPermanent('aura_own', p1),
      attachedTo: 'bear_1',
    };
    (g.state.battlefield as any).push(killian, attacker, extra, aura);

    const triggers = getAttackTriggersForCreatures(
      { state: g.state, bumpSeq: () => undefined } as any,
      [attacker, extra],
      p1,
      p2,
    );

    const killianDraw = triggers.filter(
      (t: any) => t.cardName === 'Killian, Decisive Mentor' && /draw a card/i.test(String(t.effect || t.description || '')),
    );
    expect(killianDraw).toHaveLength(1);
    expect(killianDraw[0]?.triggerType).toBe('one_or_more_enchanted_by_aura_you_control_attack');
  });

  it('does not fire when attacking creatures are not enchanted by an Aura you control', () => {
    const g = createInitialGameState('t_killian_attack_no_aura');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    g.applyEvent({ type: 'join', playerId: p1, name: 'P1' });
    g.applyEvent({ type: 'join', playerId: p2, name: 'P2' });

    const killian = killianPermanent('killian_1', p1);
    const attacker = creaturePermanent('bear_1', p1);
    (g.state.battlefield as any).push(killian, attacker);

    const triggers = getAttackTriggersForCreatures(
      { state: g.state, bumpSeq: () => undefined } as any,
      [attacker],
      p1,
      p2,
    );

    expect(
      triggers.some(
        (t: any) => t.cardName === 'Killian, Decisive Mentor' && /draw a card/i.test(String(t.effect || t.description || '')),
      ),
    ).toBe(false);
  });
});
