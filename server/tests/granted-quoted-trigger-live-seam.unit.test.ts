import { describe, expect, it } from 'vitest';

import {
  detectAttackTriggers,
  detectCombatDamageTriggers,
  detectDealtDamageTriggers,
  detectDeathTriggers,
  detectETBTriggers,
  detectLTBTriggers,
  detectTargetedTriggers,
  detectTapTriggers,
  detectSpellCastTriggers,
  detectBlockTriggers,
  getDeathTriggers,
  getSpellCastTriggers,
} from '../src/state/modules/triggered-abilities.js';
import { getDamageReceivedTrigger } from '../src/state/modules/triggers/damage-received.js';
import { detectCounterPlacedTriggers } from '../src/state/modules/triggers/counters.js';
import { getTapTriggers } from '../src/state/modules/triggers/tap-untap.js';
import { getBlockTriggersForCreatures, getBlockedTriggersForCreatures } from '../src/state/modules/triggers/combat.js';
import { detectUpkeepTriggers, getUpkeepTriggersForPlayer } from '../src/state/modules/upkeep-triggers.js';
import { processLTBTriggers } from '../src/state/modules/triggerEmissionFamilyUtils.js';

/** Oracle from mtg_data.db (is_token = 0). */
const LAVABELLY =
  'Sliver creatures you control have "When this creature enters, it deals 1 damage to target player or planeswalker and you gain 1 life."';
const CONSTRICTING =
  'Sliver creatures you control have "When this creature enters, you may exile target creature an opponent controls until this creature leaves the battlefield."';
const THORNCASTER =
  'Sliver creatures you control have "Whenever this creature attacks, it deals 1 damage to any target."';
const TEMPERED =
  'Sliver creatures you control have "Whenever this creature deals combat damage to a player, put a +1/+1 counter on it."';
const CAPRICIOUS =
  'Sliver creatures you control have "Whenever this creature deals combat damage to a player, exile the top card of your library. You may play that card this turn."';
const SPITEFUL =
  'Sliver creatures you control have "Whenever this creature is dealt damage, it deals that much damage to target player or planeswalker."';

function sliverLord(id: string, name: string, oracle: string) {
  return {
    id,
    controller: 'p1',
    card: {
      id: `${id}_card`,
      name,
      type_line: 'Creature — Sliver',
      oracle_text: oracle,
    },
  };
}

function blankSliver(id = 'recip_1') {
  return {
    id,
    controller: 'p1',
    card: {
      id: `${id}_card`,
      name: 'Seam Recipient',
      type_line: 'Creature — Sliver',
      oracle_text: '',
    },
  };
}

describe('granted quoted trigger live seam', () => {
  it('detects granted ETB on a blank Sliver when Lavabelly is on the battlefield', () => {
    const lord = sliverLord('lava_1', 'Lavabelly Sliver', LAVABELLY);
    const recipient = blankSliver();
    const state = { battlefield: [lord, recipient] };

    expect(detectETBTriggers(recipient.card, recipient).length).toBe(0);
    const withState = detectETBTriggers(recipient.card, recipient, state);
    expect(withState.some((trigger) => (
      trigger.triggerType === 'etb'
      || /deals 1 damage/i.test(String(trigger.effect || trigger.description || ''))
    ))).toBe(true);
  });

  it('detects granted ETB from Constricting Sliver on a blank recipient', () => {
    const lord = sliverLord('cons_1', 'Constricting Sliver', CONSTRICTING);
    const recipient = blankSliver();
    const state = { battlefield: [lord, recipient] };
    const withState = detectETBTriggers(recipient.card, recipient, state);
    expect(withState.some((trigger) => /exile target creature/i.test(String(trigger.effect || trigger.description || '')))).toBe(true);
  });

  it('detects granted attack triggers from Thorncaster on a blank recipient', () => {
    const lord = sliverLord('thorn_1', 'Thorncaster Sliver', THORNCASTER);
    const recipient = blankSliver();
    const state = { battlefield: [lord, recipient] };
    const withState = detectAttackTriggers(recipient.card, recipient, state);
    expect(withState.some((trigger) => /deals 1 damage/i.test(String(trigger.effect || trigger.description || '')))).toBe(true);
  });

  it('detects granted combat-damage triggers from Tempered and Capricious', () => {
    const tempered = sliverLord('temp_1', 'Tempered Sliver', TEMPERED);
    const recipient = blankSliver();
    const temperedState = { battlefield: [tempered, recipient] };
    const temperedHits = detectCombatDamageTriggers(recipient.card, recipient, temperedState);
    expect(temperedHits.some((trigger) => /\+1\/\+1 counter/i.test(String(trigger.effect || trigger.description || '')))).toBe(true);

    const capricious = sliverLord('cap_1', 'Capricious Sliver', CAPRICIOUS);
    const capRecipient = blankSliver('recip_cap');
    const capHits = detectCombatDamageTriggers(capRecipient.card, capRecipient, {
      battlefield: [capricious, capRecipient],
    });
    expect(capHits.some((trigger) => /exile the top card/i.test(String(trigger.effect || trigger.description || '')))).toBe(true);
  });

  it('detects granted dealt-damage and live redirect on Spiteful recipients', () => {
    const lord = sliverLord('spite_1', 'Spiteful Sliver', SPITEFUL);
    const recipient = blankSliver();
    const state = { battlefield: [lord, recipient] };
    const detected = detectDealtDamageTriggers(recipient.card, recipient, state);
    expect(detected.some((trigger) => trigger.triggerType === 'dealt_damage')).toBe(true);

    const redirect = getDamageReceivedTrigger(recipient, state);
    expect(redirect).toMatchObject({
      controllerId: 'p1',
      targetType: 'any',
    });
    expect(String(redirect?.effect || '')).toMatch(/that much damage/i);
  });

  it('detects All-Slivers and commander-you-own quoted grants on matching recipients', () => {
    const harmonic = sliverLord(
      'harmonic_1',
      'Harmonic Sliver',
      'All Slivers have "When this permanent enters, destroy target artifact or enchantment."',
    );
    const recipient = blankSliver();
    const etb = detectETBTriggers(recipient.card, recipient, { battlefield: [harmonic, recipient] });
    expect(etb.some((trigger) => /destroy target artifact/i.test(String(trigger.effect || trigger.description || '')))).toBe(true);

    const background = {
      id: 'noble_1',
      controller: 'p1',
      card: {
        id: 'noble_1_card',
        name: 'Noble Heritage',
        type_line: 'Legendary Enchantment — Background',
        oracle_text: 'Commander creatures you own have "When this creature enters and at the beginning of your upkeep, each player may put two +1/+1 counters on a creature they control."',
      },
    };
    const commander = {
      id: 'cmd_1',
      controller: 'p1',
      owner: 'p1',
      isCommander: true,
      card: {
        id: 'cmd_1_card',
        name: 'Seam Commander',
        type_line: 'Creature — Human',
        oracle_text: '',
      },
    };
    const cmdEtb = detectETBTriggers(commander.card, commander, { battlefield: [background, commander] });
    expect(cmdEtb.length).toBeGreaterThan(0);
  });

  it('detects granted becomes-the-target on a blank Kira recipient', () => {
    const lord = {
      id: 'kira_1',
      controller: 'p1',
      card: {
        id: 'kira_1_card',
        name: 'Kira, Great Glass-Spinner',
        type_line: 'Legendary Creature — Spirit',
        oracle_text: 'Flying\nCreatures you control have "Whenever this creature becomes the target of a spell or ability for the first time each turn, counter that spell or ability."',
      },
    };
    const recipient = blankSliver();
    const state = { battlefield: [lord, recipient] };
    expect(detectTargetedTriggers(recipient.card, recipient).length).toBe(0);
    const hits = detectTargetedTriggers(recipient.card, recipient, state);
    expect(hits.some((trigger) => /counter that spell or ability/i.test(String(trigger.effect || '')))).toBe(true);
    expect(hits.some((trigger) => trigger.oncePerTurn === true)).toBe(true);
    expect(hits.some((trigger) => /^or ability/i.test(String(trigger.effect || '')))).toBe(false);
  });

  it('detects granted counters-put-on-this from Danny Pink', () => {
    const lord = {
      id: 'danny_1',
      controller: 'p1',
      card: {
        id: 'danny_1_card',
        name: 'Danny Pink',
        type_line: 'Legendary Creature — Human Soldier Advisor',
        oracle_text: 'Mentor (Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power.)\nCreatures you control have "Whenever one or more counters are put on this creature for the first time each turn, draw a card."',
      },
    };
    const recipient = blankSliver();
    const hits = detectCounterPlacedTriggers(recipient.card, recipient, { battlefield: [lord, recipient] });
    expect(hits.some((trigger) => (
      trigger.triggerType === 'counters_put_on_self'
      && /draw a card/i.test(trigger.effect)
      && trigger.oncePerTurn === true
    ))).toBe(true);
  });

  it('detects granted becomes-tapped from Tale of Katara and Toph only on your turn', () => {
    const lord = {
      id: 'katara_1',
      controller: 'p1',
      card: {
        id: 'katara_1_card',
        name: 'Tale of Katara and Toph',
        type_line: 'Enchantment',
        oracle_text: 'Creatures you control have "Whenever this creature becomes tapped for the first time during each of your turns, put a +1/+1 counter on it."',
      },
    };
    const recipient = {
      id: 'recip_1',
      controller: 'p1',
      card: {
        id: 'recip_1_card',
        name: 'Seam Recipient',
        type_line: 'Creature — Bear',
        oracle_text: '',
      },
    };
    const state = { battlefield: [lord, recipient], turnPlayer: 'p1' };
    const detected = detectTapTriggers(recipient.card, recipient, state);
    expect(detected.some((trigger) => (
      trigger.affectedType === 'self'
      && /\+1\/\+1 counter/i.test(trigger.effect)
      && trigger.oncePerTurn === true
      && trigger.onlyOnControllerTurn === true
    ))).toBe(true);

    expect(getTapTriggers({ state } as any, recipient, 'p1').some((trigger) => trigger.affectedType === 'self')).toBe(true);
    expect(getTapTriggers({ state: { ...state, turnPlayer: 'p2' } } as any, recipient, 'p1')).toEqual([]);
  });

  it('detects granted becomes-tapped from Dionus on an Elf recipient', () => {
    const lord = {
      id: 'dionus_1',
      controller: 'p1',
      card: {
        id: 'dionus_1_card',
        name: 'Dionus, Elvish Archdruid',
        type_line: 'Legendary Creature — Elf Druid',
        oracle_text: 'Elves you control have "Whenever this creature becomes tapped during your turn, untap it and put a +1/+1 counter on it. This ability triggers only once each turn."',
      },
    };
    const recipient = {
      id: 'elf_1',
      controller: 'p1',
      card: {
        id: 'elf_1_card',
        name: 'Seam Elf',
        type_line: 'Creature — Elf',
        oracle_text: '',
      },
    };
    const state = { battlefield: [lord, recipient], turnPlayer: 'p1' };
    expect(detectTapTriggers(recipient.card, recipient).length).toBe(0);
    const detected = detectTapTriggers(recipient.card, recipient, state);
    expect(detected.some((trigger) => (
      trigger.affectedType === 'self'
      && /untap it/i.test(trigger.effect)
      && !/^during your turn/i.test(trigger.effect)
      && trigger.oncePerTurn === true
      && trigger.onlyOnControllerTurn === true
    ))).toBe(true);
    expect(getTapTriggers({ state: { ...state, turnPlayer: 'p2' } } as any, recipient, 'p1')).toEqual([]);
  });

  it('detects granted counters-put-on-this from Cursed Wombat', () => {
    const lord = {
      id: 'wombat_1',
      controller: 'p1',
      card: {
        id: 'wombat_1_card',
        name: 'Cursed Wombat',
        type_line: 'Creature — Nightmare Wombat',
        oracle_text: '{2}{B}{G}: Adapt 2. (If this creature has no +1/+1 counters on it, put two +1/+1 counters on it.)\nPermanents you control have "Whenever one or more +1/+1 counters are put on this permanent, put an additional +1/+1 counter on it. This ability triggers only once each turn."',
      },
    };
    const recipient = blankSliver();
    const hits = detectCounterPlacedTriggers(recipient.card, recipient, { battlefield: [lord, recipient] });
    expect(hits.some((trigger) => (
      trigger.triggerType === 'counters_put_on_self'
      && /additional \+1\/\+1 counter/i.test(trigger.effect)
      && trigger.oncePerTurn === true
    ))).toBe(true);
  });

  it('detects granted spell-cast from Folk Hero and Passionate Archaeologist on a commander', () => {
    const folk = {
      id: 'folk_1',
      controller: 'p1',
      card: {
        id: 'folk_1_card',
        name: 'Folk Hero',
        type_line: 'Legendary Enchantment — Background',
        oracle_text: 'Commander creatures you own have "Whenever you cast a spell that shares a creature type with this creature, draw a card. This ability triggers only once each turn."',
      },
    };
    const archaeologist = {
      id: 'arch_1',
      controller: 'p1',
      card: {
        id: 'arch_1_card',
        name: 'Passionate Archaeologist',
        type_line: 'Legendary Enchantment — Background',
        oracle_text: 'Commander creatures you own have "Whenever you cast a spell from exile, this creature deals damage equal to that spell\'s mana value to target opponent."',
      },
    };
    const commander = {
      id: 'cmd_1',
      controller: 'p1',
      owner: 'p1',
      isCommander: true,
      card: {
        id: 'cmd_1_card',
        name: 'Seam Commander',
        type_line: 'Creature — Human Wizard',
        oracle_text: '',
      },
    };
    const folkState = { battlefield: [folk, commander] };
    expect(detectSpellCastTriggers(commander.card, commander).length).toBe(0);
    const folkHits = detectSpellCastTriggers(commander.card, commander, folkState);
    expect(folkHits.some((trigger) => (
      trigger.requiresSharedCreatureTypeWithSource === true
      && /draw a card/i.test(trigger.effect)
      && !/^that shares/i.test(trigger.effect)
      && trigger.oncePerTurn === true
    ))).toBe(true);
    expect(getSpellCastTriggers({ state: folkState } as any, 'p1', { type_line: 'Creature — Elf' })).toEqual([]);
    expect(getSpellCastTriggers({ state: folkState } as any, 'p1', { type_line: 'Creature — Human' }).some((trigger) => (
      trigger.requiresSharedCreatureTypeWithSource === true
    ))).toBe(true);

    const exileHits = detectSpellCastTriggers(commander.card, commander, { battlefield: [archaeologist, commander] });
    expect(exileHits.some((trigger) => (
      trigger.sourceZoneRequirement === 'exile'
      && /deals damage equal to that spell/i.test(trigger.effect)
    ))).toBe(true);
  });

  it('detects granted becomes-blocked from Retaliation on a blank recipient', () => {
    const lord = {
      id: 'ret_1',
      controller: 'p1',
      card: {
        id: 'ret_1_card',
        name: 'Retaliation',
        type_line: 'Enchantment',
        oracle_text: 'Creatures you control have "Whenever this creature becomes blocked by a creature, this creature gets +1/+1 until end of turn."',
      },
    };
    const recipient = {
      id: 'recip_1',
      controller: 'p1',
      card: {
        id: 'recip_1_card',
        name: 'Seam Recipient',
        type_line: 'Creature — Bear',
        oracle_text: '',
      },
      attacking: 'p2',
      blockedBy: ['blocker_1'],
    };
    const state = { battlefield: [lord, recipient] };
    expect(detectBlockTriggers(recipient.card, recipient).length).toBe(0);
    const hits = detectBlockTriggers(recipient.card, recipient, state);
    expect(hits.some((trigger) => (
      trigger.triggerType === 'self_becomes_blocked'
      && /\+1\/\+1/i.test(String(trigger.effect || ''))
    ))).toBe(true);

    const ctx = { state } as any;
    expect(getBlockTriggersForCreatures(ctx, [recipient], 'p1')).toEqual([]);
    expect(getBlockedTriggersForCreatures(ctx, [recipient], 'p2').some((trigger) => (
      trigger.triggerType === 'blocked'
      && /\+1\/\+1/i.test(String(trigger.effect || ''))
    ))).toBe(true);
  });

  it('detects granted enters-or-leaves LTB from Candlekeep Sage on a commander', () => {
    const sage = {
      id: 'sage_1',
      controller: 'p1',
      card: {
        id: 'sage_1_card',
        name: 'Candlekeep Sage',
        type_line: 'Legendary Enchantment — Background',
        oracle_text: 'Commander creatures you own have "When this creature enters or leaves the battlefield, draw a card."',
      },
    };
    const commander = {
      id: 'cmd_1',
      controller: 'p1',
      owner: 'p1',
      isCommander: true,
      card: {
        id: 'cmd_1_card',
        name: 'Seam Commander',
        type_line: 'Creature — Human Wizard',
        oracle_text: '',
      },
    };
    const state = { seq: 1, stack: [], battlefield: [sage] };
    expect(detectLTBTriggers(commander.card, commander).length).toBe(0);
    const hits = detectLTBTriggers(commander.card, commander, { battlefield: [sage, commander] });
    expect(hits.some((trigger) => (
      trigger.triggerType === 'self_enters_or_leaves'
      && /draw a card/i.test(String(trigger.effect || ''))
    ))).toBe(true);

    const queued = processLTBTriggers({ state, bumpSeq() { state.seq += 1; }, isReplaying: false } as any, commander, { cause: 'leave' });
    expect(queued.some((item) => (
      String(item?.triggerType || '') === 'self_enters_or_leaves'
      && /draw a card/i.test(String(item?.effect || item?.description || ''))
    ))).toBe(true);
  });

  it('detects granted upkeep from Tavern Brawler and Plague Sliver on recipients', () => {
    const brawler = {
      id: 'brawler_1',
      controller: 'p1',
      card: {
        id: 'brawler_1_card',
        name: 'Tavern Brawler',
        type_line: 'Legendary Enchantment — Background',
        oracle_text: 'Commander creatures you own have "At the beginning of your upkeep, exile the top card of your library. This creature gets +X/+0 until end of turn, where X is that card\'s mana value. You may play that card this turn."',
      },
    };
    const plague = {
      id: 'plague_1',
      controller: 'p1',
      card: {
        id: 'plague_1_card',
        name: 'Plague Sliver',
        type_line: 'Creature — Sliver',
        oracle_text: 'All Slivers have "At the beginning of your upkeep, this permanent deals 1 damage to you."',
      },
    };
    const commander = {
      id: 'cmd_1',
      controller: 'p1',
      owner: 'p1',
      isCommander: true,
      card: {
        id: 'cmd_1_card',
        name: 'Seam Commander',
        type_line: 'Creature — Human Wizard',
        oracle_text: '',
      },
    };
    const sliver = blankSliver();
    expect(detectUpkeepTriggers(commander.card, commander).length).toBe(0);
    const brawlerHits = detectUpkeepTriggers(commander.card, commander, { battlefield: [brawler, commander] });
    expect(brawlerHits.some((trigger) => /exile the top card/i.test(String(trigger.effect || trigger.description || '')))).toBe(true);
    expect(getUpkeepTriggersForPlayer({
      state: { battlefield: [brawler, commander] },
    } as any, 'p1').some((trigger) => /exile the top card/i.test(String(trigger.effect || trigger.description || '')))).toBe(true);

    const plagueHits = detectUpkeepTriggers(sliver.card, sliver, { battlefield: [plague, sliver] });
    expect(plagueHits.some((trigger) => /deals 1 damage to you/i.test(String(trigger.effect || trigger.description || '')))).toBe(true);
  });

  it('detects granted graveyard-from-battlefield from Agent of the Iron Throne on a commander', () => {
    const agent = {
      id: 'iron_1',
      controller: 'p1',
      card: {
        id: 'iron_1_card',
        name: 'Agent of the Iron Throne',
        type_line: 'Legendary Enchantment — Background',
        oracle_text: 'Commander creatures you own have "Whenever an artifact or creature you control is put into a graveyard from the battlefield, each opponent loses 1 life."',
      },
    };
    const commander = {
      id: 'cmd_1',
      controller: 'p1',
      owner: 'p1',
      isCommander: true,
      card: {
        id: 'cmd_1_card',
        name: 'Seam Commander',
        type_line: 'Creature — Human Wizard',
        oracle_text: '',
      },
    };
    const other = {
      id: 'bear_1',
      controller: 'p1',
      owner: 'p1',
      card: {
        id: 'bear_1_card',
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
      },
    };
    expect(detectDeathTriggers(commander.card, commander).length).toBe(0);
    const hits = detectDeathTriggers(commander.card, commander, { battlefield: [agent, commander] });
    expect(hits.some((trigger) => (
      trigger.triggerType === 'put_into_graveyard_from_battlefield'
      && /each opponent loses 1 life/i.test(String(trigger.effect || ''))
    ))).toBe(true);

    const otherDies = getDeathTriggers({
      state: { battlefield: [agent, commander], seq: 1, stack: [], players: [{ id: 'p1' }, { id: 'p2' }] },
      bumpSeq() {},
      isReplaying: false,
    } as any, other, 'p1');
    expect(otherDies.some((trigger) => (
      String(trigger.source?.permanentId || '') === 'cmd_1'
      && /each opponent loses 1 life/i.test(String(trigger.effect || ''))
    ))).toBe(true);

    const selfDies = getDeathTriggers({
      state: { battlefield: [agent], seq: 1, stack: [], players: [{ id: 'p1' }, { id: 'p2' }] },
      bumpSeq() {},
      isReplaying: false,
    } as any, commander, 'p1');
    expect(selfDies.some((trigger) => (
      String(trigger.source?.permanentId || '') === 'cmd_1'
      && /each opponent loses 1 life/i.test(String(trigger.effect || ''))
    ))).toBe(true);
  });
});
