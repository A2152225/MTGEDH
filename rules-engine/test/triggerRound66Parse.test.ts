import { describe, expect, it } from 'vitest';
import { parseTriggerClause, triggerConditionMatches } from '../src/triggerCondition/index';

const src = { id: 'src', controllerId: 'p1' };
const perm = (over: Record<string, unknown> = {}) => ({
  id: 'x',
  typeLine: 'Creature - Bear',
  controllerId: 'p1',
  ...over,
});

describe('trigger IR round 66 leftovers', () => {
  it('parses a land entering under an opponent as that opponent controlling it', () => {
    const parsed = parseTriggerClause("Whenever a land enters under an opponent's control, draw a card.", 'X');
    expect(parsed?.condition.event).toBe('enters');
    expect(parsed?.effect).toMatch(/draw a card/i);
    expect(parsed?.condition.alternatives[0].controller).toBe('not_you');
    expect(triggerConditionMatches(parsed!.condition, perm({ typeLine: 'Land', controllerId: 'p2' }), src)).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, perm({ typeLine: 'Land', controllerId: 'p1' }), src)).toBe(false);
  });

  it('parses instant or sorcery casts as both spell types', () => {
    const parsed = parseTriggerClause('Whenever you cast an instant or sorcery spell, draw a card.', 'Muddle the Mixture');
    expect(parsed?.condition.event).toBe('spell_cast');
    expect(parsed?.condition.alternatives.length).toBe(2);
    expect(triggerConditionMatches(parsed!.condition, perm({ typeLine: 'Instant' }), src)).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, perm({ typeLine: 'Sorcery' }), src)).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, perm({ typeLine: 'Creature' }), src)).toBe(false);
    const withReminder = parseTriggerClause(
      'Whenever you cast an instant or sorcery spell, Muddle becomes a copy of that spell until end of turn, except it has myriad. (Whenever it attacks, for each opponent, create a copy.)',
      'Muddle the Mixture',
    );
    expect(withReminder?.condition.event).toBe('spell_cast');
    expect(withReminder?.condition.alternatives.length).toBe(2);
    expect(withReminder?.effect).not.toMatch(/whenever it attacks/i);
  });

  it('parses Merfolk attacks and Hero damage with the printed creature type', () => {
    const merfolk = parseTriggerClause('Whenever one or more Merfolk you control attack a player, draw a card.', 'X');
    expect(merfolk?.condition.event).toBe('attacks');
    expect(triggerConditionMatches(merfolk!.condition, perm({ typeLine: 'Creature - Merfolk' }), src)).toBe(true);
    expect(triggerConditionMatches(merfolk!.condition, perm({ typeLine: 'Creature - Bear' }), src)).toBe(false);
    const toys = parseTriggerClause('Whenever one or more non-Toy creatures you control attack a player, create a token.', 'X');
    expect(toys?.condition.event).toBe('attacks');
    expect(triggerConditionMatches(toys!.condition, perm({ typeLine: 'Creature - Bear' }), src)).toBe(true);
    expect(triggerConditionMatches(toys!.condition, perm({ typeLine: 'Artifact Creature - Toy' }), src)).toBe(false);

    const heroes = parseTriggerClause('Whenever one or more Heroes you control deal damage to a player, draw a card.', 'X');
    expect(heroes?.condition.event).toBe('deals_damage');
    expect(heroes?.condition.quantity).toBe('one_or_more');
    expect(triggerConditionMatches(heroes!.condition, perm({ typeLine: 'Creature - Hero' }), src, {
      damageRecipientPlayerId: 'p2',
    })).toBe(true);
    expect(triggerConditionMatches(heroes!.condition, perm({ typeLine: 'Creature - Bear' }), src, {
      damageRecipientPlayerId: 'p2',
    })).toBe(false);
  });

  it('parses deathtouch damage to a planeswalker only when the recipient is a planeswalker', () => {
    const parsed = parseTriggerClause(
      'Whenever a creature you control with deathtouch deals damage to a planeswalker, draw a card.',
      'X',
    );
    expect(parsed?.condition.damageRecipient).toBe('planeswalker');
    const killer = perm({ keywords: ['deathtouch'] });
    expect(triggerConditionMatches(parsed!.condition, killer, src, { damagedTypeLine: 'Planeswalker' })).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, killer, src, { damagedTypeLine: 'Creature' })).toBe(false);
    expect(triggerConditionMatches(parsed!.condition, perm(), src, { damagedTypeLine: 'Planeswalker' })).toBe(false);
  });

  it('parses a same-name land tapped for mana', () => {
    const parsed = parseTriggerClause(
      'Whenever a land with the same name as the exiled card is tapped for mana, its controller adds one mana.',
      'Extraplanar Lens',
    );
    expect(parsed?.condition.event).toBe('tapped_for_mana');
    expect(parsed?.condition.sameNameAsExiledWithSource).toBe(true);
    expect(parsed?.effect).toMatch(/adds one mana/i);
  });

  it('keeps this-way riders on the parent effect', () => {
    const removed = parseTriggerClause('When you remove a counter this way, draw a card.', 'X');
    expect(removed?.condition.event).toBe('counter_removed');
    expect(removed?.condition.thisWay).toBe(true);
    expect(removed?.condition.delayedRider).toBe(true);
    expect(removed?.effect).toMatch(/draw a card/i);

    const enters = parseTriggerClause('When an exiled card enters under your control this way, draw a card.', 'Lagrella');
    expect(enters?.condition.event).toBe('enters');
    expect(enters?.condition.fromZone).toBe('exile');
    expect(enters?.condition.thisWay).toBe(true);
  });

  it('reads a multi-word legendary first name as the source', () => {
    const parsed = parseTriggerClause(
      'Whenever Ezio deals combat damage to a player, you may pay {W}.',
      'Ezio Auditore da Firenze',
    );
    expect(parsed?.condition.event).toBe('deals_combat_damage_to_player');
    expect(parsed?.condition.alternatives[0].source).toBe('self');
    expect(triggerConditionMatches(parsed!.condition, perm({ id: 'src' }), src)).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, perm({ id: 'other' }), src)).toBe(false);
  });

  it('parses an enchanted creature attacking an opponent', () => {
    const parsed = parseTriggerClause(
      'Whenever an enchanted creature attacks one of your opponents, it gets +2/+0.',
      'Mazzy, Truesword Paladin',
    );
    expect(parsed?.condition.event).toBe('attacks');
    expect(parsed?.condition.attackedPlayer).toBe('opponent');
    expect(parsed?.condition.alternatives[0].source).toBe('enchanted');
    const attacker = perm({ id: 'ench' });
    expect(triggerConditionMatches(parsed!.condition, attacker, { ...src, attachedToId: 'ench' }, {
      attackedPlayerId: 'p2',
    })).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, attacker, { ...src, attachedToId: 'other' }, {
      attackedPlayerId: 'p2',
    })).toBe(false);
    expect(triggerConditionMatches(parsed!.condition, attacker, { ...src, attachedToId: 'ench' }, {
      attackedPlayerId: 'p1',
    })).toBe(false);
  });

  it('parses blocking a black or red creature against the blocked creature color', () => {
    const parsed = parseTriggerClause(
      'Whenever a creature blocks a black or red creature, the blocking creature gets +1/+1 until end of turn.',
      'Righteous Indignation',
    );
    expect(parsed?.condition.event).toBe('blocks');
    const blocker = perm();
    const blocked = (colors: string[]) => perm({ id: 'atk', typeLine: 'Creature', colors });
    expect(triggerConditionMatches(parsed!.condition, blocker, src, { blockPartner: blocked(['b']) })).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, blocker, src, { blockPartner: blocked(['r']) })).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, blocker, src, { blockPartner: blocked(['g']) })).toBe(false);
  });

  it('parses desert sacrifice or a desert card leaving hand or library', () => {
    const parsed = parseTriggerClause(
      'Whenever you sacrifice a Desert and whenever a Desert card is put into your graveyard from your hand or library, return it.',
      'Desert Warfare',
    );
    expect(parsed?.condition.event).toBe('sacrifices');
    expect(parsed?.condition.pairedEvent).toBe('put_into_graveyard');
    expect((parsed?.condition as { pairedCondition?: { fromZone?: string } }).pairedCondition?.fromZone).toBe('hand_or_library');
    const desert = perm({ typeLine: 'Land - Desert' });
    expect(triggerConditionMatches(parsed!.condition, desert, src)).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, perm({ typeLine: 'Land - Forest' }), src)).toBe(false);
    const paired = (parsed!.condition as { pairedCondition: typeof parsed.condition }).pairedCondition;
    expect(triggerConditionMatches(paired, desert, src, { fromZone: 'library', zoneOwnerId: 'p1' })).toBe(true);
    expect(triggerConditionMatches(paired, desert, src, { fromZone: 'battlefield', zoneOwnerId: 'p1' })).toBe(false);
  });

  it('parses an enchantment entering or an opponent losing the game', () => {
    const parsed = parseTriggerClause(
      'When this enchantment enters and whenever an opponent loses the game, exile the top card of each player\'s library.',
      'Share the Spoils',
    );
    expect(parsed?.condition.event).toBe('enters');
    expect(parsed?.condition.pairedEvent).toBe('performs');
    const paired = (parsed!.condition as { pairedCondition?: { action?: string; losesGame?: string } }).pairedCondition;
    expect(paired?.action).toBe('lose_game');
    expect(paired?.losesGame).toBe('not_you');
  });

  it('parses controlling no permanents with a named counter', () => {
    const parsed = parseTriggerClause(
      'When you control no permanents with phylactery counters on them, sacrifice this creature.',
      'Phylactery Lich',
    );
    expect(parsed?.condition.event).toBe('controls_none');
    const withCounter = perm({ counters: { phylactery: 1 } });
    expect(triggerConditionMatches(parsed!.condition, withCounter, src)).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, perm(), src)).toBe(false);
    expect(triggerConditionMatches(parsed!.condition, perm({ counters: { phylactery: 1 }, controllerId: 'p2' }), src)).toBe(false);
  });

  it('parses an eerie enter or a fully unlocked room', () => {
    const parsed = parseTriggerClause(
      'Eerie — Whenever this creature or another enchantment you control enters and whenever you fully unlock a Room, tap up to one target creature.',
      'Fear of Sleep Paralysis',
    );
    expect(parsed?.condition.event).toBe('enters');
    expect(parsed?.condition.alternatives.length).toBe(2);
    expect(parsed?.condition.pairedEvent).toBe('room_fully_unlocked');
    expect(triggerConditionMatches(parsed!.condition, perm({ id: 'src' }), src)).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, perm({ id: 'ench', typeLine: 'Enchantment', controllerId: 'p1' }), src)).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, perm({ id: 'bear' }), src)).toBe(false);
    const paired = (parsed!.condition as { pairedCondition: typeof parsed.condition }).pairedCondition;
    expect(triggerConditionMatches(paired, perm({ id: 'room', typeLine: 'Enchantment — Room' }), src)).toBe(true);
    expect(triggerConditionMatches(paired, perm({ id: 'room', controllerId: 'p2' }), src)).toBe(false);
  });

  it('parses another creature entering or a power-up ability', () => {
    const parsed = parseTriggerClause(
      'Whenever another creature you control enters and whenever you activate a power-up ability, put a +1/+1 counter on Marvel Boy.',
      'Marvel Boy',
    );
    expect(parsed?.condition.event).toBe('performs');
    expect(parsed?.condition.action).toBe('activate_ability');
    expect(parsed?.condition.abilityWord).toBe('power-up');
    expect(parsed?.condition.pairedEvent).toBe('enters');
    expect(triggerConditionMatches(parsed!.condition, perm(), src, { abilityWord: 'power-up' })).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, perm(), src, { abilityWord: 'boast' })).toBe(false);
    const paired = (parsed!.condition as { pairedCondition: typeof parsed.condition }).pairedCondition;
    expect(triggerConditionMatches(paired, perm({ id: 'other' }), src)).toBe(true);
    expect(triggerConditionMatches(paired, perm({ id: 'src' }), src)).toBe(false);
  });

  it('parses an enchanted artifact becoming tapped or activated without a tap cost', () => {
    const parsed = parseTriggerClause(
      "Whenever enchanted artifact becomes tapped or a player activates an ability of enchanted artifact without {T} in its activation cost, this Aura deals 2 damage.",
      'Artifact Possession',
    );
    expect(parsed?.condition.event).toBe('performs');
    expect(parsed?.condition.action).toBe('activate_ability');
    expect(parsed?.condition.notTapCost).toBe(true);
    expect(parsed?.condition.pairedEvent).toBe('becomes_tapped');
    const aura = { ...src, attachedToId: 'art' };
    const artifact = perm({ id: 'art', typeLine: 'Artifact' });
    expect(triggerConditionMatches(parsed!.condition, artifact, aura, { notTapCost: true })).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, artifact, aura, { notTapCost: false })).toBe(false);
    expect(triggerConditionMatches(parsed!.condition, artifact, src, { notTapCost: true })).toBe(false);
    const paired = (parsed!.condition as { pairedCondition: typeof parsed.condition }).pairedCondition;
    expect(triggerConditionMatches(paired, artifact, aura)).toBe(true);
  });

  it('parses an opponent artifact becoming tapped or an opponent activating one', () => {
    const parsed = parseTriggerClause(
      "Whenever an artifact an opponent controls becomes tapped or an opponent activates an artifact's ability without {T} in its activation cost, you gain 1 life.",
      'Powerleech',
    );
    expect(parsed?.condition.event).toBe('performs');
    expect(parsed?.condition.notTapCost).toBe(true);
    const artifact = perm({ id: 'art', typeLine: 'Artifact', controllerId: 'p2' });
    expect(triggerConditionMatches(parsed!.condition, artifact, src, { notTapCost: true })).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, perm({ typeLine: 'Artifact' }), src, { notTapCost: true })).toBe(false);
    const paired = (parsed!.condition as { pairedCondition: typeof parsed.condition }).pairedCondition;
    expect(paired.event).toBe('becomes_tapped');
    expect(triggerConditionMatches(paired, artifact, src)).toBe(true);
    expect(triggerConditionMatches(paired, perm({ typeLine: 'Artifact' }), src)).toBe(false);
  });

  it('parses a spell whose mana value equals the doom counters on the source', () => {
    const parsed = parseTriggerClause(
      'Whenever you cast a spell with mana value equal to the number of doom counters on this enchantment, this enchantment deals that much damage to any target.',
      'Imminent Doom',
    );
    expect(parsed?.condition.event).toBe('spell_cast');
    expect(parsed?.condition.manaValueEqualsSourceCounter).toBe('doom');
    const spell = perm({ typeLine: 'Instant' });
    expect(triggerConditionMatches(parsed!.condition, spell, src, { spellManaValue: 2, sourceCounters: { doom: 2 } })).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, spell, src, { spellManaValue: 2, sourceCounters: { doom: 1 } })).toBe(false);
    expect(triggerConditionMatches(parsed!.condition, spell, src, { spellManaValue: 0 })).toBe(false);
  });

  it('parses a spell cast using teamwork only when that cost was paid', () => {
    const parsed = parseTriggerClause(
      'Whenever you cast a spell using teamwork, create a 1/1 colorless Robot Hero artifact creature token with flying.',
      'Virtual Assistant',
    );
    expect(parsed?.condition.event).toBe('spell_cast');
    expect(parsed?.condition.teamworkCast).toBe(true);
    const spell = perm({ typeLine: 'Sorcery' });
    expect(triggerConditionMatches(parsed!.condition, spell, src, { teamworkWasPaid: true })).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, spell, src)).toBe(false);
  });

  it('parses attacking the enchanted opponent or that opponent attacking you', () => {
    const parsed = parseTriggerClause(
      'When you attack enchanted opponent or a planeswalker they control or when they attack you or a planeswalker you control, sacrifice this Aura.',
      'Tenuous Truce',
    );
    expect(parsed?.condition.event).toBe('attacks');
    expect(parsed?.condition.attackedPlayer).toBe('enchanted');
    expect(parsed?.condition.quantity).toBe('one_or_more');
    expect(parsed?.condition.pairedEvent).toBe('attacks');
    const yours = perm({ id: 'atk', typeLine: 'Creature' });
    expect(triggerConditionMatches(parsed!.condition, yours, src, { attackedPlayerId: 'p2', enchantedPlayerId: 'p2' })).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, yours, src, { attackedPlayerId: 'p3', enchantedPlayerId: 'p2' })).toBe(false);
    const paired = (parsed!.condition as { pairedCondition: typeof parsed.condition }).pairedCondition;
    expect(paired.attackedPlayer).toBe('you');
    expect(paired.alternatives[0].controller).toBe('enchanted_player');
    const theirs = perm({ id: 'theirs', typeLine: 'Creature', controllerId: 'p2' });
    expect(triggerConditionMatches(paired, theirs, src, { attackedPlayerId: 'p1', enchantedPlayerId: 'p2' })).toBe(true);
    expect(triggerConditionMatches(paired, perm({ id: 'other', typeLine: 'Creature', controllerId: 'p3' }), src, { attackedPlayerId: 'p1', enchantedPlayerId: 'p2' })).toBe(false);
  });

  it('parses noncombat damage equal to the damaged creature toughness', () => {
    const parsed = parseTriggerClause(
      "Whenever a source you control deals noncombat damage to a creature equal to that creature's toughness, draw a card.",
      'Taii Wakeen, Perfect Shot',
    );
    expect(parsed?.condition.event).toBe('deals_damage');
    expect(parsed?.condition.damageKind).toBe('noncombat');
    expect(parsed?.condition.damageRecipient).toBe('creature');
    expect(parsed?.condition.damageEqualsRecipientToughness).toBe(true);
    const sourceYou = perm({ typeLine: 'Creature - Human', controllerId: 'p1' });
    const ctx = { damageKind: 'noncombat', damageRecipientIsCreature: true, damageAmount: 4, damagedToughness: 4 };
    expect(triggerConditionMatches(parsed!.condition, sourceYou, src, ctx)).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, sourceYou, src, { ...ctx, damagedToughness: 3 })).toBe(false);
    expect(triggerConditionMatches(parsed!.condition, sourceYou, src, { ...ctx, damageKind: 'combat' })).toBe(false);
    expect(triggerConditionMatches(parsed!.condition, perm({ controllerId: 'p2' }), src, ctx)).toBe(false);
  });

  it('parses an equipped creature mentoring', () => {
    const parsed = parseTriggerClause(
      'Whenever equipped creature mentors a creature, put a shield counter on that creature.',
      'Aegis of the Legion',
    );
    expect(parsed?.condition.event).toBe('performs');
    expect(parsed?.condition.action).toBe('mentor');
    const equipment = { ...src, attachedToId: 'cre' };
    const creature = perm({ id: 'cre', typeLine: 'Creature - Soldier' });
    expect(triggerConditionMatches(parsed!.condition, creature, equipment)).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, creature, src)).toBe(false);
    expect(triggerConditionMatches(parsed!.condition, perm({ id: 'cre', typeLine: 'Artifact' }), equipment)).toBe(false);
  });

  it('parses putting cards on the bottom while scrying', () => {
    const parsed = parseTriggerClause(
      'Whenever you choose to put one or more cards on the bottom of your library while scrying, exile that many cards from the bottom of your library.',
      'The Temporal Anchor',
    );
    expect(parsed?.condition.event).toBe('performs');
    expect(parsed?.condition.action).toBe('scry');
    expect(parsed?.condition.scryToBottom).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, perm(), src, { scryBottomCount: 2 })).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, perm(), src, { scryBottomCount: 0 })).toBe(false);
    expect(triggerConditionMatches(parsed!.condition, perm(), src)).toBe(false);
  });

  it('parses a spell dealing damage to this creature', () => {
    const parsed = parseTriggerClause(
      'Whenever a spell deals damage to this creature, this creature deals that much damage to that spell\'s controller.',
      'Tephraderm',
    );
    expect(parsed?.condition.event).toBe('deals_damage');
    expect(parsed?.condition.damageRecipient).toBe('source');
    expect(parsed?.condition.damageSourceIsSpell).toBe(true);
    const spell = perm({ id: 'bolt', typeLine: 'Instant', controllerId: 'p2' });
    expect(triggerConditionMatches(parsed!.condition, spell, src, { damageSourceIsSpell: true, damageRecipientIsSource: true })).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, spell, src, { damageSourceIsSpell: false, damageRecipientIsSource: true })).toBe(false);
    expect(triggerConditionMatches(parsed!.condition, spell, src, { damageSourceIsSpell: true, damageRecipientIsSource: false })).toBe(false);
  });

  it('parses the chosen player drawing the chosen card', () => {
    const parsed = parseTriggerClause(
      'When the chosen player draws a card with the chosen name, sacrifice this artifact.',
      'Booby Trap',
    );
    expect(parsed?.condition.event).toBe('draws_card');
    expect(parsed?.condition.chosenPlayer).toBe(true);
    expect(parsed?.condition.requiresChosenDrawnName).toBe(true);
    const trap = { ...src, chosenCardName: 'Lightning Bolt' };
    const drawer = perm({ controllerId: 'p2' });
    expect(triggerConditionMatches(parsed!.condition, drawer, trap, { chosenPlayerId: 'p2', drawnCardName: 'Lightning Bolt' })).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, drawer, trap, { chosenPlayerId: 'p2', drawnCardName: 'Shock' })).toBe(false);
    expect(triggerConditionMatches(parsed!.condition, drawer, trap, { chosenPlayerId: 'p1', drawnCardName: 'Lightning Bolt' })).toBe(false);
  });

  it('parses combat damage to a player who has no contract counter', () => {
    const parsed = parseTriggerClause(
      "Whenever Miss Highwater deals combat damage to a player who doesn't have a contract counter, they may discard their hand.",
      'Miss Highwater',
    );
    expect(parsed?.condition.event).toBe('deals_combat_damage_to_player');
    expect(parsed?.condition.damagedPlayerMissingCounter).toBe('contract');
    const self = perm({ id: 'src' });
    expect(triggerConditionMatches(parsed!.condition, self, src, { damagedPlayerCounters: { contract: 0 } })).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, self, src, { damagedPlayerCounters: {} })).toBe(true);
    expect(triggerConditionMatches(parsed!.condition, self, src, { damagedPlayerCounters: { contract: 1 } })).toBe(false);
    expect(triggerConditionMatches(parsed!.condition, self, src)).toBe(false);
    expect(triggerConditionMatches(parsed!.condition, perm({ id: 'other' }), src, { damagedPlayerCounters: {} })).toBe(false);
  });

  it('treats a delayed-only graveyard trigger as having its end-step effect', () => {
    const parsed = parseTriggerClause(
      'When this creature is put into your graveyard from the battlefield, at the beginning of the next end step, you lose 1 life and return this card to your hand.',
      'Brood of Cockroaches',
    );
    expect(parsed?.condition.event).toBe('put_into_graveyard');
    expect(parsed?.effect).toBe('');
    expect(parsed?.delayed?.effect).toMatch(/lose 1 life/i);
  });
});
