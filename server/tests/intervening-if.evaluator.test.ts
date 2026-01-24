import { describe, it, expect } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { isInterveningIfSatisfied } from '../src/state/modules/triggers/intervening-if';
import { triggerETBEffectsForPermanent } from '../src/state/modules/stack';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('Intervening-if evaluator (expanded templates)', () => {
  it('supports cast-origin templates: "if you cast it" / "if you cast it from your hand"', () => {
    const g = createInitialGameState('t_intervening_if_eval_cast_origin');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const descCastIt = 'When this creature enters the battlefield, if you cast it, draw a card.';
    const descCastFromHand = 'When this creature enters the battlefield, if you cast it from your hand, draw a card.';

    expect(isInterveningIfSatisfied(g as any, String(p1), descCastIt, { enteredFromCast: true })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), descCastIt, { enteredFromCast: false })).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p1), descCastFromHand, { castFromHand: true })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), descCastFromHand, { castFromHand: false })).toBe(false);
  });

  it('supports "this <type> is tapped" templates', () => {
    const g = createInitialGameState('t_intervening_if_eval_this_tapped');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'When this creature enters the battlefield, if this creature is tapped, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { tapped: true })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { tapped: false })).toBe(false);
  });

  it('supports explicit "untapped" wording (e.g., "if this artifact is untapped")', () => {
    const g = createInitialGameState('t_intervening_if_eval_this_untapped');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'When this artifact enters the battlefield, if this artifact is untapped, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { tapped: false })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { tapped: true })).toBe(false);
  });

  it('supports "this permanent is an enchantment" templates', () => {
    const g = createInitialGameState('t_intervening_if_eval_this_is_type');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'When this permanent enters the battlefield, if this permanent is an enchantment, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { type_line: 'Enchantment Creature' } })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { type_line: 'Artifact Creature' } })).toBe(false);
  });

  it('supports permanent-card graveyard thresholds', () => {
    const g = createInitialGameState('t_intervening_if_eval_gy_permanent_cards');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: {
        graveyard: [
          { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
          { name: 'Forest', type_line: 'Basic Land — Forest' },
          { name: 'Pacifism', type_line: 'Enchantment — Aura' },
          { name: 'Shock', type_line: 'Instant' },
        ],
        graveyardCount: 4,
      },
    };

    const desc = 'At the beginning of your upkeep, if there are three or more permanent cards in your graveyard, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);
  });

  it('supports alternate Revolt phrasing: "under your control"', () => {
    const g = createInitialGameState('t_intervening_if_eval_revolt_under_control');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).permanentLeftBattlefieldThisTurn = { [p1]: true };
    const desc = 'When this creature enters the battlefield, if a permanent left the battlefield under your control this turn, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).permanentLeftBattlefieldThisTurn = { [p1]: false };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports opponent-controlled creature death/ETB templates', () => {
    const g = createInitialGameState('t_intervening_if_eval_opp_creature_events');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const descDied = "At the beginning of your upkeep, if a creature died under an opponent's control this turn, draw a card.";
    (g.state as any).creaturesDiedThisTurnByController = { [p2]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), descDied)).toBe(true);
    (g.state as any).creaturesDiedThisTurnByController = { [p2]: 0 };
    expect(isInterveningIfSatisfied(g as any, String(p1), descDied)).toBe(false);

    const descEtb = "At the beginning of your upkeep, if a creature entered the battlefield under an opponent's control this turn, draw a card.";
    (g.state as any).creaturesEnteredBattlefieldThisTurnByController = { [p2]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), descEtb)).toBe(true);
    (g.state as any).creaturesEnteredBattlefieldThisTurnByController = { [p2]: 0 };
    expect(isInterveningIfSatisfied(g as any, String(p1), descEtb)).toBe(false);
  });

  it('supports creature death/ETB templates under your control (and global death counts)', () => {
    const g = createInitialGameState('t_intervening_if_eval_you_control_creature_events');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const descDiedUnder = 'At the beginning of your upkeep, if a creature died under your control this turn, draw a card.';
    (g.state as any).creaturesDiedThisTurnByController = { [p1]: 1, [p2]: 0 };
    expect(isInterveningIfSatisfied(g as any, String(p1), descDiedUnder)).toBe(true);
    (g.state as any).creaturesDiedThisTurnByController = { [p1]: 0, [p2]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), descDiedUnder)).toBe(false);

    const descDiedGlobal2 = 'At the beginning of your upkeep, if two or more creatures died this turn, draw a card.';
    (g.state as any).creaturesDiedThisTurnByController = { [p1]: 1, [p2]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), descDiedGlobal2)).toBe(true);
    (g.state as any).creaturesDiedThisTurnByController = { [p1]: 1, [p2]: 0 };
    expect(isInterveningIfSatisfied(g as any, String(p1), descDiedGlobal2)).toBe(false);

    const descDiedUnder2 = 'At the beginning of your upkeep, if two or more creatures died under your control this turn, draw a card.';
    (g.state as any).creaturesDiedThisTurnByController = { [p1]: 2 };
    expect(isInterveningIfSatisfied(g as any, String(p1), descDiedUnder2)).toBe(true);
    (g.state as any).creaturesDiedThisTurnByController = { [p1]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), descDiedUnder2)).toBe(false);

    const descEtbUnder = 'At the beginning of your upkeep, if a creature entered the battlefield under your control this turn, draw a card.';
    (g.state as any).creaturesEnteredBattlefieldThisTurnByController = { [p1]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), descEtbUnder)).toBe(true);
    (g.state as any).creaturesEnteredBattlefieldThisTurnByController = { [p1]: 0 };
    expect(isInterveningIfSatisfied(g as any, String(p1), descEtbUnder)).toBe(false);

    const descNoEtb = 'At the beginning of your upkeep, if no creatures entered the battlefield under your control this turn, draw a card.';
    (g.state as any).creaturesEnteredBattlefieldThisTurnByController = { [p1]: 0 };
    expect(isInterveningIfSatisfied(g as any, String(p1), descNoEtb)).toBe(true);
    (g.state as any).creaturesEnteredBattlefieldThisTurnByController = { [p1]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), descNoEtb)).toBe(false);
  });

  it('supports subtype death templates (phyrexian / another <subtype>)', () => {
    const g = createInitialGameState('t_intervening_if_eval_subtype_deaths');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const descPhyrexian = 'At the beginning of your upkeep, if a Phyrexian died under your control this turn, draw a card.';
    (g.state as any).creaturesDiedThisTurnByControllerSubtype = { [p1]: { phyrexian: 1 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), descPhyrexian)).toBe(true);
    (g.state as any).creaturesDiedThisTurnByControllerSubtype = { [p1]: { phyrexian: 0 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), descPhyrexian)).toBe(false);

    const descAnotherElf = 'At the beginning of your upkeep, if another Elf died under your control this turn, draw a card.';
    // If the source is an Elf, "another" requires at least 2.
    (g.state as any).creaturesDiedThisTurnByControllerSubtype = { [p1]: { elf: 1 } };
    expect(
      isInterveningIfSatisfied(g as any, String(p1), descAnotherElf, { id: 'src', card: { type_line: 'Creature — Elf' } })
    ).toBe(false);
    (g.state as any).creaturesDiedThisTurnByControllerSubtype = { [p1]: { elf: 2 } };
    expect(
      isInterveningIfSatisfied(g as any, String(p1), descAnotherElf, { id: 'src', card: { type_line: 'Creature — Elf' } })
    ).toBe(true);

    // If the source is not an Elf, "another" just requires at least 1 Elf death.
    (g.state as any).creaturesDiedThisTurnByControllerSubtype = { [p1]: { elf: 1 } };
    expect(
      isInterveningIfSatisfied(g as any, String(p1), descAnotherElf, { id: 'src2', card: { type_line: 'Creature — Human' } })
    ).toBe(true);
  });

  it('tracks creature subtype deaths via movePermanentToGraveyard (integration)', () => {
    const g = createInitialGameState('t_intervening_if_eval_subtype_deaths_integration');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const descPhyrexian = 'At the beginning of your upkeep, if a Phyrexian died under your control this turn, draw a card.';
    const descAnotherElf = 'At the beginning of your upkeep, if another Elf died under your control this turn, draw a card.';

    g.state.battlefield.push({
      id: 'dying_phyrexian',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        id: 'dying_phyrexian_card',
        name: 'Dying Phyrexian',
        type_line: 'Creature — Phyrexian Beast',
        power: '2',
        toughness: '2',
      },
    } as any);

    (g as any).movePermanentToGraveyard('dying_phyrexian', true);

    expect((g.state as any).creaturesDiedThisTurnByControllerSubtype?.[p1]?.phyrexian).toBe(1);
    expect(isInterveningIfSatisfied(g as any, String(p1), descPhyrexian)).toBe(true);

    // "Another Elf" requires at least 2 if the source is itself an Elf.
    g.state.battlefield.push({
      id: 'dying_elf_1',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        id: 'dying_elf_1_card',
        name: 'Dying Elf 1',
        type_line: 'Creature — Elf',
        power: '1',
        toughness: '1',
      },
    } as any);

    (g as any).movePermanentToGraveyard('dying_elf_1', true);
    expect((g.state as any).creaturesDiedThisTurnByControllerSubtype?.[p1]?.elf).toBe(1);
    expect(isInterveningIfSatisfied(g as any, String(p1), descAnotherElf, { id: 'src', card: { type_line: 'Creature — Elf' } })).toBe(
      false
    );

    g.state.battlefield.push({
      id: 'dying_elf_2',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        id: 'dying_elf_2_card',
        name: 'Dying Elf 2',
        type_line: 'Creature — Elf',
        power: '1',
        toughness: '1',
      },
    } as any);

    (g as any).movePermanentToGraveyard('dying_elf_2', true);
    expect((g.state as any).creaturesDiedThisTurnByControllerSubtype?.[p1]?.elf).toBe(2);
    expect(isInterveningIfSatisfied(g as any, String(p1), descAnotherElf, { id: 'src', card: { type_line: 'Creature — Elf' } })).toBe(
      true
    );
  });

  it('supports generic subtype-death templates (your control / opponent control / global)', () => {
    const g = createInitialGameState('t_intervening_if_eval_generic_subtype_deaths');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const descElfUnderYou = 'At the beginning of your upkeep, if an Elf died under your control this turn, draw a card.';
    (g.state as any).creaturesDiedThisTurnByControllerSubtype = { [p1]: { elf: 1 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), descElfUnderYou)).toBe(true);
    (g.state as any).creaturesDiedThisTurnByControllerSubtype = { [p1]: { elf: 0 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), descElfUnderYou)).toBe(false);

    const descElfUnderOpp = "At the beginning of your upkeep, if an Elf died under an opponent's control this turn, draw a card.";
    (g.state as any).creaturesDiedThisTurnByControllerSubtype = { [p2]: { elf: 1 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), descElfUnderOpp)).toBe(true);
    (g.state as any).creaturesDiedThisTurnByControllerSubtype = { [p2]: { elf: 0 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), descElfUnderOpp)).toBe(false);

    const descElfGlobal = 'At the beginning of your upkeep, if an Elf died this turn, draw a card.';
    (g.state as any).creaturesDiedThisTurnByControllerSubtype = { [p1]: { elf: 0 }, [p2]: { elf: 1 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), descElfGlobal)).toBe(true);
    (g.state as any).creaturesDiedThisTurnByControllerSubtype = { [p1]: { elf: 0 }, [p2]: { elf: 0 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), descElfGlobal)).toBe(false);
  });

  it('tracks creature subtype ETBs via triggerETBEffectsForPermanent (integration)', () => {
    const g = createInitialGameState('t_intervening_if_eval_subtype_etb_integration');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const entering = {
      id: 'entering_elf_1',
      controller: p1,
      owner: p1,
      tapped: false,
      card: {
        id: 'entering_elf_1_card',
        name: 'Entering Elf',
        type_line: 'Creature — Elf Druid',
        oracle_text: '',
      },
    };

    (g.state.battlefield as any).push(entering);
    triggerETBEffectsForPermanent(g as any, entering, p1);

    expect((g.state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype?.[p1]?.elf).toBe(1);

    const descElfUnderYou = 'At the beginning of your upkeep, if an Elf entered the battlefield under your control this turn, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), descElfUnderYou)).toBe(true);
  });

  it('supports generic subtype ETB templates (your control / opponent control / global)', () => {
    const g = createInitialGameState('t_intervening_if_eval_generic_subtype_etb');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const descElfUnderYou = 'At the beginning of your upkeep, if an Elf entered the battlefield under your control this turn, draw a card.';
    (g.state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype = { [p1]: { elf: 1 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), descElfUnderYou)).toBe(true);
    (g.state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype = { [p1]: { elf: 0 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), descElfUnderYou)).toBe(false);

    const descElfUnderOpp = "At the beginning of your upkeep, if an Elf entered the battlefield under an opponent's control this turn, draw a card.";
    (g.state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype = { [p2]: { elf: 1 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), descElfUnderOpp)).toBe(true);
    (g.state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype = { [p2]: { elf: 0 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), descElfUnderOpp)).toBe(false);

    const descElfGlobal = 'At the beginning of your upkeep, if an Elf entered the battlefield this turn, draw a card.';
    (g.state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype = { [p1]: { elf: 0 }, [p2]: { elf: 1 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), descElfGlobal)).toBe(true);
    (g.state as any).creaturesEnteredBattlefieldThisTurnByControllerSubtype = { [p1]: { elf: 0 }, [p2]: { elf: 0 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), descElfGlobal)).toBe(false);
  });

  it('supports "+1/+1 counter on this creature" templates', () => {
    const g = createInitialGameState('t_intervening_if_eval_this_counters');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const descAtLeastOne = 'When this creature enters the battlefield, if this creature has one or more +1/+1 counters on it, draw a card.';
    const descFewerThanThree =
      'When this creature enters the battlefield, if this creature has fewer than three +1/+1 counters on it, draw a card.';
    const descDoesNotHave = 'When this creature enters the battlefield, if this creature doesn\'t have a +1/+1 counter on it, draw a card.';

    expect(isInterveningIfSatisfied(g as any, String(p1), descAtLeastOne, { counters: { '+1/+1': 2 } })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), descAtLeastOne, { counters: { '+1/+1': 0 } })).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p1), descFewerThanThree, { counters: { '+1/+1': 2 } })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), descFewerThanThree, { counters: { '+1/+1': 3 } })).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p1), descDoesNotHave, { counters: { '+1/+1': 0 } })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), descDoesNotHave, { counters: { '+1/+1': 1 } })).toBe(false);
  });

  it('supports instant/sorcery graveyard thresholds', () => {
    const g = createInitialGameState('t_intervening_if_eval_gy_instants_sorceries');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: {
        graveyard: [
          { name: 'Shock', type_line: 'Instant' },
          { name: 'Lightning Bolt', type_line: 'Instant' },
          { name: 'Divination', type_line: 'Sorcery' },
          { name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        ],
        graveyardCount: 4,
      },
    };

    const descIn = 'At the beginning of your upkeep, if there are three or more instant and/or sorcery cards in your graveyard, draw a card.';
    const descAmong =
      'At the beginning of your upkeep, if there are three or more instant and/or sorcery cards among cards in your graveyard, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), descIn)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), descAmong)).toBe(true);

    const descTwenty =
      'At the beginning of your upkeep, if there are twenty or more instant and/or sorcery cards in your graveyard, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), descTwenty)).toBe(false);
  });

  it('supports "you control N or more <tribe> and/or <tribe>" templates', () => {
    const g = createInitialGameState('t_intervening_if_eval_tribe_andor');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    g.state.battlefield = [
      { id: 'c1', controller: p1, card: { type_line: 'Creature — Snake' } },
      { id: 'c2', controller: p1, card: { type_line: 'Creature — Snake' } },
      { id: 'c3', controller: p1, card: { type_line: 'Creature — Snake' } },
      { id: 'c4', controller: p1, card: { type_line: 'Creature — Serpent' } },
      { id: 'c5', controller: p1, card: { type_line: 'Creature — Serpent' } },
    ] as any;

    const desc = 'At the beginning of your upkeep, if you control five or more Snakes and/or Serpents, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    g.state.battlefield.pop();
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports energy check: "if you have an {E}"', () => {
    const g = createInitialGameState('t_intervening_if_eval_energy');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'At the beginning of your upkeep, if you have an {E}, draw a card.';

    (g.state as any).energy = { [p1]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).energy = { [p1]: 0 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports combined graveyard + counter check: "if there is an elf card in your graveyard and this creature has a -1/-1 counter on it"', () => {
    const g = createInitialGameState('t_intervening_if_eval_elf_and_counter');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: {
        graveyard: [{ name: 'Elvish Mystic', type_line: 'Creature — Elf Druid' }],
        graveyardCount: 1,
      },
    };

    const desc =
      'At the beginning of your upkeep, if there is an elf card in your graveyard and this creature has a -1/-1 counter on it, draw a card.';

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { counters: { '-1/-1': 1 } })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { counters: { '-1/-1': 0 } })).toBe(false);

    (g.state as any).zones = { [p1]: { graveyard: [{ name: 'Shock', type_line: 'Instant' }], graveyardCount: 1 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { counters: { '-1/-1': 1 } })).toBe(false);
  });

  it('supports comma-delimited upkeep template: "At the beginning of your upkeep, if no opponent has more life than you"', () => {
    const g = createInitialGameState('t_intervening_if_eval_life_no_opp_more');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).life = { [p1]: 10, [p2]: 9 };

    const desc = 'At the beginning of your upkeep, if no opponent has more life than you, abandon this scheme.';
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).life = { [p1]: 10, [p2]: 11 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports comma-delimited upkeep template: "..., if an opponent has more life than you"', () => {
    const g = createInitialGameState('t_intervening_if_eval_life_opp_more');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const desc = 'At the beginning of your upkeep, if an opponent has more life than you, you gain 1 life.';

    (g.state as any).life = { [p1]: 10, [p2]: 11 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).life = { [p1]: 10, [p2]: 10 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports life comparisons vs opponents: less life than (an/each/no opponent)', () => {
    const g = createInitialGameState('t_intervening_if_eval_life_less_than');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');

    const oppLess = 'At the beginning of your upkeep, if an opponent has less life than you, draw a card.';

    (g.state as any).life = { [p1]: 10, [p2]: 9, [p3]: 12 };
    expect(isInterveningIfSatisfied(g as any, String(p1), oppLess)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have less life than an opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have less life than each opponent, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no opponent has less life than you, draw a card.')).toBe(false);

    (g.state as any).life = { [p1]: 9, [p2]: 10, [p3]: 12 };
    expect(isInterveningIfSatisfied(g as any, String(p1), oppLess)).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have less life than an opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have less life than each other player, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no opponent has less life than you, draw a card.')).toBe(true);
  });

  it('supports life superlatives: "If you have the most/least life" (ties count)', () => {
    const g = createInitialGameState('t_intervening_if_eval_life_superlatives');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');

    (g.state as any).life = { [p1]: 10, [p2]: 10, [p3]: 8 };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have the most life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have the most life total, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you have the most life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you have the most life, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you have the least life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you have the least life total, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have the least life, draw a card.')).toBe(false);

    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If you have the most life or are tied for the most life, draw a card.')
    ).toBe(true);

    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If you have the most life total or are tied for the most life total, draw a card.')
    ).toBe(true);

    (g.state as any).life = { [p1]: 8, [p2]: 10, [p3]: 8 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have the least life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you have the least life, draw a card.')).toBe(true);
  });

  it('supports life tie-only superlatives: "If you are tied for the most/least life"', () => {
    const g = createInitialGameState('t_intervening_if_eval_life_tied_for');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');

    (g.state as any).life = { [p1]: 10, [p2]: 10, [p3]: 8 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you are tied for the most life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you are tied for the most life total, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you are tied for the most life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you are tied for the most life, draw a card.')).toBe(false);

    // p3 is uniquely least, so tie-only least is false
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you are tied for the least life, draw a card.')).toBe(false);

    (g.state as any).life = { [p1]: 8, [p2]: 10, [p3]: 8 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you are tied for the least life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you are tied for the least life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you are tied for the least life, draw a card.')).toBe(false);
  });

  it('supports life superlatives: "If you have the highest/lowest life total"', () => {
    const g = createInitialGameState('t_intervening_if_eval_life_superlatives_alt');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).life = { [p1]: 20, [p2]: 10 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have the highest life total, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you have the highest life total, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you have the lowest life total, draw a card.')).toBe(true);
  });

  it('supports life tie-only superlatives: "If you are tied for the highest/lowest life total"', () => {
    const g = createInitialGameState('t_intervening_if_eval_life_tied_for_alt');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).life = { [p1]: 20, [p2]: 10 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you are tied for the highest life total, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you are tied for the lowest life total, draw a card.')).toBe(false);

    (g.state as any).life = { [p1]: 20, [p2]: 20 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you are tied for the highest life total, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you are tied for the highest life total, draw a card.')).toBe(true);
  });

  it('supports zone superlatives: most/least/fewest cards in a zone (ties count)', () => {
    const g = createInitialGameState('t_intervening_if_eval_zone_superlatives');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');

    (g.state as any).zones = {
      [p1]: { handCount: 5, graveyardCount: 2, libraryCount: 40 },
      [p2]: { handCount: 5, graveyardCount: 1, libraryCount: 60 },
      [p3]: { handCount: 2, graveyardCount: 2, libraryCount: 40 },
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have the most cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you have the most cards in your hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you have the most cards in hand, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you have the fewest cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you have the least cards in hand, draw a card.')).toBe(true);

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have the most cards in your graveyard, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you have the least cards in your graveyard, draw a card.')).toBe(true);

    expect(
      isInterveningIfSatisfied(
        g as any,
        String(p2),
        'If you have the most cards in your library or are tied for the most cards in your library, draw a card.'
      )
    ).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have the most cards in your library, draw a card.')).toBe(false);
  });

  it('supports zone tie-only superlatives: "If you are tied for the most/least/fewest cards in <zone>"', () => {
    const g = createInitialGameState('t_intervening_if_eval_zone_tied_for');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');

    (g.state as any).zones = {
      [p1]: { handCount: 5, graveyardCount: 2, libraryCount: 40 },
      [p2]: { handCount: 5, graveyardCount: 1, libraryCount: 60 },
      [p3]: { handCount: 2, graveyardCount: 2, libraryCount: 40 },
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you are tied for the most cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you are tied for the most cards in your hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you are tied for the most cards in hand, draw a card.')).toBe(false);

    // p3 is uniquely fewest, so tie-only fewest is false
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you are tied for the fewest cards in hand, draw a card.')).toBe(false);

    (g.state as any).zones = {
      [p1]: { handCount: 2, graveyardCount: 2, libraryCount: 40 },
      [p2]: { handCount: 5, graveyardCount: 1, libraryCount: 60 },
      [p3]: { handCount: 2, graveyardCount: 2, libraryCount: 40 },
    };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you are tied for the fewest cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you are tied for the least cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you are tied for the least cards in hand, draw a card.')).toBe(false);
  });

  it('supports permanent superlatives: most/least/fewest creatures/lands you control (ties count)', () => {
    const g = createInitialGameState('t_intervening_if_eval_permanent_superlatives');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');

    // P1 creatures=2 lands=1
    // P2 creatures=2 lands=2
    // P3 creatures=1 lands=2
    (g.state as any).battlefield = [
      { id: 'p1_c1', controller: p1, owner: p1, card: { name: 'C1', type_line: 'Creature — Bear' } },
      { id: 'p1_c2', controller: p1, owner: p1, card: { name: 'C2', type_line: 'Creature — Bear' } },
      { id: 'p1_l1', controller: p1, owner: p1, card: { name: 'L1', type_line: 'Land' } },

      { id: 'p2_c1', controller: p2, owner: p2, card: { name: 'C1', type_line: 'Creature — Bear' } },
      { id: 'p2_c2', controller: p2, owner: p2, card: { name: 'C2', type_line: 'Creature — Bear' } },
      { id: 'p2_l1', controller: p2, owner: p2, card: { name: 'L1', type_line: 'Land' } },
      { id: 'p2_l2', controller: p2, owner: p2, card: { name: 'L2', type_line: 'Land' } },

      { id: 'p3_c1', controller: p3, owner: p3, card: { name: 'C1', type_line: 'Creature — Bear' } },
      { id: 'p3_l1', controller: p3, owner: p3, card: { name: 'L1', type_line: 'Land' } },
      { id: 'p3_l2', controller: p3, owner: p3, card: { name: 'L2', type_line: 'Land' } },
    ];

    // Creatures: p1 and p2 tied for most
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control the most creatures, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you control the most creatures, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you control the most creatures, draw a card.')).toBe(false);
    expect(
      isInterveningIfSatisfied(g as any, String(p2), 'If you control the most creatures or are tied for the most creatures, draw a card.')
    ).toBe(true);

    // Creatures: p3 has fewest
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you control the fewest creatures, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you control the least creatures, draw a card.')).toBe(true);

    // Lands: p2 and p3 tied for most, p1 least
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you control the most lands, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you control the most lands, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control the most lands, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control the least lands, draw a card.')).toBe(true);
  });

  it('supports permanent tie-only superlatives: "If you are tied for the most/least/fewest creatures/lands"', () => {
    const g = createInitialGameState('t_intervening_if_eval_permanent_tied_for');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');

    // P1 creatures=2 lands=1
    // P2 creatures=2 lands=2
    // P3 creatures=1 lands=2
    (g.state as any).battlefield = [
      { id: 'p1_c1', controller: p1, owner: p1, card: { name: 'C1', type_line: 'Creature — Bear' } },
      { id: 'p1_c2', controller: p1, owner: p1, card: { name: 'C2', type_line: 'Creature — Bear' } },
      { id: 'p1_l1', controller: p1, owner: p1, card: { name: 'L1', type_line: 'Land' } },

      { id: 'p2_c1', controller: p2, owner: p2, card: { name: 'C1', type_line: 'Creature — Bear' } },
      { id: 'p2_c2', controller: p2, owner: p2, card: { name: 'C2', type_line: 'Creature — Bear' } },
      { id: 'p2_l1', controller: p2, owner: p2, card: { name: 'L1', type_line: 'Land' } },
      { id: 'p2_l2', controller: p2, owner: p2, card: { name: 'L2', type_line: 'Land' } },

      { id: 'p3_c1', controller: p3, owner: p3, card: { name: 'C1', type_line: 'Creature — Bear' } },
      { id: 'p3_l1', controller: p3, owner: p3, card: { name: 'L1', type_line: 'Land' } },
      { id: 'p3_l2', controller: p3, owner: p3, card: { name: 'L2', type_line: 'Land' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you are tied for the most creatures, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you are tied for the most creatures, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you are tied for the most creatures, draw a card.')).toBe(false);

    // p1 is uniquely least lands, so tie-only least is false
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you are tied for the least lands, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you are tied for the most lands, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you are tied for the most lands, draw a card.')).toBe(true);
  });

  it('treats superlatives as true in single-player contexts', () => {
    const g = createInitialGameState('t_intervening_if_eval_superlatives_single_player');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');
    (g.state as any).life = { [p1]: 10 };
    (g.state as any).zones = { [p1]: { handCount: 1, graveyardCount: 0, libraryCount: 10 } };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have the most life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have the least life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have the most cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have the fewest cards in your graveyard, draw a card.')).toBe(true);

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you are tied for the most life, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you are tied for the most cards in hand, draw a card.')).toBe(false);
  });

  it('treats opponent life comparison quantifiers consistently when there are no opponents', () => {
    const g = createInitialGameState('t_intervening_if_eval_life_less_vacuous');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).life = { [p1]: 10 };

    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'At the beginning of your upkeep, if an opponent has less life than you, draw a card.')
    ).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have less life than an opponent, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have less life than each opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no opponent has less life than you, draw a card.')).toBe(true);
  });

  it('supports "If it\'s your turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_your_turn');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).turnPlayer = p1;

    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's your turn, draw a card.")).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), "If it's your turn, draw a card.")).toBe(false);
  });

  it('supports "If it\'s not your turn" / "If it\'s an opponent\'s turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_not_your_turn');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).turnPlayer = p1;

    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's not your turn, draw a card.")).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p2), "If it's not your turn, draw a card.")).toBe(true);

    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's an opponent's turn, draw a card.")).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p2), "If it's an opponent's turn, draw a card.")).toBe(true);
  });

  it('supports day/night transition templates: "If it became day/night this turn" (including "day became night")', () => {
    const g = createInitialGameState('t_intervening_if_eval_became_day_night');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).dayNightChangedThisTurn = true;
    (g.state as any).dayNightChangedTo = 'day';
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it became day this turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it became night this turn, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If night became day this turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If day became night this turn, draw a card.')).toBe(false);

    (g.state as any).dayNightChangedTo = 'night';
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it became night this turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it became day this turn, draw a card.')).toBe(false);
  });

  it('supports "If it\'s neither day nor night" (and "... and ...")', () => {
    const g = createInitialGameState('t_intervening_if_eval_neither_day_nor_night');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    delete (g.state as any).dayNight;
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's neither day nor night, draw a card.")).toBe(null);

    (g.state as any).dayNight = 'day';
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's neither day nor night, draw a card.")).toBe(false);

    (g.state as any).dayNight = 'night';
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's neither day nor night, draw a card.")).toBe(false);

    (g.state as any).dayNight = 'neither';
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's neither day nor night, draw a card.")).toBe(true);
    (g.state as any).turnPlayer = 'pX';
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's neither day nor night and it's your turn, draw a card.")).toBe(false);
    (g.state as any).turnPlayer = p1;
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's neither day nor night and it's your turn, draw a card.")).toBe(true);
  });

  it('supports "If you control exactly N lands"', () => {
    const g = createInitialGameState('t_intervening_if_eval_exactly');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).battlefield = [
      { id: 'l1', controller: p1, owner: p1, card: { name: 'Plains', type_line: 'Basic Land — Plains' } },
      { id: 'l2', controller: p1, owner: p1, card: { name: 'Island', type_line: 'Basic Land — Island' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control exactly two lands, draw a card.')).toBe(true);

    (g.state as any).battlefield.push({
      id: 'l3',
      controller: p1,
      owner: p1,
      card: { name: 'Swamp', type_line: 'Basic Land — Swamp' },
    });

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control exactly two lands, draw a card.')).toBe(false);
  });

  it('supports additional life thresholds: "or less", "less than", "more than", "exactly"', () => {
    const g = createInitialGameState('t_intervening_if_eval_life_thresholds');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).life = { [p1]: 10 };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have ten or less life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have less than ten life, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have more than nine life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have exactly ten life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have exactly nine life, draw a card.')).toBe(false);
  });

  it('supports additional life threshold synonyms: "at least/at most", "no fewer/no more than"', () => {
    const g = createInitialGameState('t_intervening_if_eval_life_threshold_synonyms');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).life = { [p1]: 10 };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have at least ten life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have at least eleven life, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no fewer than ten life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no fewer than eleven life, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have at most ten life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have at most nine life, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no more than ten life, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no more than nine life, draw a card.')).toBe(false);
  });

  it('supports hand-size thresholds: "or fewer", "or more", "exactly"', () => {
    const g = createInitialGameState('t_intervening_if_eval_hand_thresholds');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: { handCount: 2 },
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have two or fewer cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have one or fewer cards in hand, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have two or more cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have exactly two cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have exactly three cards in hand, draw a card.')).toBe(false);
  });

  it('supports hand-size threshold synonyms: "at least/at most", "no fewer/no more than"', () => {
    const g = createInitialGameState('t_intervening_if_eval_hand_threshold_synonyms');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: { handCount: 2 },
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have at least two cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have at least three cards in hand, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no fewer than two cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no fewer than three cards in hand, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have at most two cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have at most one card in hand, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no more than two cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no more than one card in hand, draw a card.')).toBe(false);
  });

  it('supports numeric control-count synonyms: "at most/no more than", "no fewer than"', () => {
    const g = createInitialGameState('t_intervening_if_eval_control_threshold_synonyms');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield = [
      { id: 'c1', controller: p1, owner: p1, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'c2', controller: p1, owner: p1, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'l1', controller: p1, owner: p1, card: { name: 'Plains', type_line: 'Basic Land — Plains' } },
      { id: 'l2', controller: p1, owner: p1, card: { name: 'Plains', type_line: 'Basic Land — Plains' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control at most two creatures, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control no more than two creatures, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control at most one creature, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control no fewer than two lands, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control no fewer than three lands, draw a card.')).toBe(false);
  });

  it('supports graveyard/library numeric thresholds with at least/at most/no more/no fewer', () => {
    const g = createInitialGameState('t_intervening_if_eval_zone_numeric_thresholds');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: { handCount: 2, graveyardCount: 4, libraryCount: 40 },
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have at least four cards in your graveyard, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have at most four cards in your graveyard, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no more than three cards in your graveyard, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no fewer than five cards in your graveyard, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have at most 40 cards in your library, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have at least 41 cards in your library, draw a card.')).toBe(false);
  });

  it('supports "If you control a/an <type>" existence checks', () => {
    const g = createInitialGameState('t_intervening_if_eval_exists');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).battlefield = [];
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control an artifact, draw a card.')).toBe(false);

    (g.state as any).battlefield.push({
      id: 'a1',
      controller: p1,
      owner: p1,
      card: { name: 'Sol Ring', type_line: 'Artifact' },
    });

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control an artifact, draw a card.')).toBe(true);
  });

  it('supports commander templates: "If you control your commander" / "If you control a commander"', () => {
    const g = createInitialGameState('t_intervening_if_eval_commander');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).commandZone = {
      [p1]: { commanderIds: ['c1'] },
      [p2]: { commanderIds: ['c2'] },
    };

    (g.state as any).battlefield = [];
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control your commander, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a commander, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If you don't control your commander, draw a card.")).toBe(true);

    // Control your commander
    (g.state as any).battlefield.push({
      id: 'perm1',
      controller: p1,
      owner: p1,
      card: { id: 'c1', name: 'Commander One', type_line: 'Legendary Creature — Human' },
    });
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control your commander, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a commander, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If you don't control your commander, draw a card.")).toBe(false);

    // Control an opponent's commander (should satisfy "a commander" but not "your commander")
    (g.state as any).battlefield = [
      {
        id: 'perm2',
        controller: p1,
        owner: p2,
        card: { id: 'c2', name: 'Commander Two', type_line: 'Legendary Creature — Elf' },
      },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a commander, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control your commander, draw a card.')).toBe(false);
  });

  it('supports negative control templates: "control no", "do not/don\'t control", and "control no other"', () => {
    const g = createInitialGameState('t_intervening_if_eval_control_none');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield = [];
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control no artifacts, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If you don't control an artifact, draw a card.")).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you do not control any artifacts, draw a card.')).toBe(true);

    (g.state as any).battlefield.push({
      id: 'a1',
      controller: p1,
      owner: p1,
      card: { name: 'Sol Ring', type_line: 'Artifact' },
    });
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control no artifacts, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If you don't control an artifact, draw a card.")).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you do not control any artifacts, draw a card.')).toBe(false);

    // "no other" requires a source permanent so we can exclude itself.
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control no other artifacts, draw a card.')).toBe(null);
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If you control no other artifacts, draw a card.', {
        id: 'a1',
        controller: p1,
        owner: p1,
        card: { name: 'Sol Ring', type_line: 'Artifact' },
      })
    ).toBe(true);

    (g.state as any).battlefield.push({
      id: 'a2',
      controller: p1,
      owner: p1,
      card: { name: 'Arcane Signet', type_line: 'Artifact' },
    });
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If you control no other artifacts, draw a card.', {
        id: 'a1',
        controller: p1,
        owner: p1,
        card: { name: 'Sol Ring', type_line: 'Artifact' },
      })
    ).toBe(false);
  });

  it('supports "..., if N or more spells were cast this turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_spells_cast_this_turn');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const desc = "At the beginning of each end step, if four or more spells were cast this turn, abandon this scheme.";

    (g.state as any).spellsCastThisTurn = ['s1', 's2', 's3', 's4'];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).spellsCastThisTurn = ['s1', 's2', 's3'];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports "If you attacked with N or more creatures this turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_attacked_with_n');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const desc = 'If you attacked with three or more creatures this turn, draw a card.';

    (g.state as any).creaturesAttackedThisTurn = { [p1]: 3, [p2]: 0 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), desc)).toBe(false);

    (g.state as any).creaturesAttackedThisTurn = { [p1]: 2 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports Renown template: "..., if it isn\'t renowned" (requires source permanent)', () => {
    const g = createInitialGameState('t_intervening_if_eval_renown');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = "When this creature deals combat damage to a player, if it isn't renowned, put a +1/+1 counter on it and it becomes renowned.";

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { renowned: false })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { renowned: true })).toBe(false);

    // Without a source permanent, this clause is intentionally treated as unknown.
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });

  it("supports designation templates: monarch / initiative / city's blessing", () => {
    const g = createInitialGameState('t_intervening_if_eval_designations');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).monarch = p1;
    (g.state as any).initiative = p2;
    (g.state as any).cityBlessing = { [p1]: true, [p2]: false };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you are the monarch, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you are the monarch, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you have the initiative, venture into the dungeon.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have the initiative, venture into the dungeon.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p1), "If you have the city's blessing, draw a card.")).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), "If you have the city's blessing, draw a card.")).toBe(false);
  });

  it('supports graveyard-name check: "If <card> is in your graveyard"', () => {
    const g = createInitialGameState('t_intervening_if_eval_gy_name');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: {
        graveyard: [{ id: 'c1', name: 'Lightning Bolt', type_line: 'Instant' }],
      },
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If Lightning Bolt is in your graveyard, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If Black Lotus is in your graveyard, draw a card.')).toBe(false);
  });

  it('supports delirium: "If there are four or more card types among cards in your graveyard"', () => {
    const g = createInitialGameState('t_intervening_if_eval_delirium');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: {
        graveyard: [
          { id: 'a', name: 'A', type_line: 'Artifact' },
          { id: 'c', name: 'C', type_line: 'Creature — Bear' },
          { id: 'i', name: 'I', type_line: 'Instant' },
          { id: 'l', name: 'L', type_line: 'Land' },
        ],
      },
    };

    expect(
      isInterveningIfSatisfied(
        g as any,
        String(p1),
        'If there are four or more card types among cards in your graveyard, draw a card.'
      )
    ).toBe(true);
  });

  it('supports ferocious-style power threshold: "If you control a creature with power 4 or greater"', () => {
    const g = createInitialGameState('t_intervening_if_eval_ferocious');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield = [
      { id: 'c1', controller: p1, owner: p1, card: { name: 'Hill Giant', type_line: 'Creature — Giant', power: '3', toughness: '3' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a creature with power 4 or greater, draw a card.')).toBe(false);

    (g.state as any).battlefield.push({
      id: 'c2',
      controller: p1,
      owner: p1,
      card: { name: 'Craw Wurm', type_line: 'Creature — Wurm', power: '6', toughness: '4' },
    });

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a creature with power 4 or greater, draw a card.')).toBe(true);
  });

  it('supports pack tactics total power: "If you attacked with creatures with total power 6 or greater"', () => {
    const g = createInitialGameState('t_intervening_if_eval_pack_tactics');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield = [
      {
        id: 'a1',
        controller: p1,
        owner: p1,
        attacking: 'pX',
        card: { name: 'A', type_line: 'Creature', power: '3', toughness: '3' },
      },
      {
        id: 'a2',
        controller: p1,
        owner: p1,
        attacking: 'pX',
        card: { name: 'B', type_line: 'Creature', power: '2', toughness: '2' },
      },
    ];

    expect(
      isInterveningIfSatisfied(
        g as any,
        String(p1),
        'If you attacked with creatures with total power 6 or greater, create a Treasure token.'
      )
    ).toBe(false);

    (g.state as any).battlefield.push({
      id: 'a3',
      controller: p1,
      owner: p1,
      attacking: 'pX',
      card: { name: 'C', type_line: 'Creature', power: '1', toughness: '1' },
    });

    expect(
      isInterveningIfSatisfied(
        g as any,
        String(p1),
        'If you attacked with creatures with total power 6 or greater, create a Treasure token.'
      )
    ).toBe(true);
  });

  it('supports morbid/revolt per-turn flags', () => {
    const g = createInitialGameState('t_intervening_if_eval_morbid_revolt');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).creatureDiedThisTurn = true;
    (g.state as any).permanentLeftBattlefieldThisTurn = { [p1]: true };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If a creature died this turn, draw a card.')).toBe(true);
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If a permanent you controlled left the battlefield this turn, draw a card.')
    ).toBe(true);
  });

  it("supports spell-history templates: 'another spell this turn' and 'no spells cast last turn'", () => {
    const g = createInitialGameState('t_intervening_if_eval_spell_history');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).spellsCastThisTurn = [{ casterId: p1 }];
    expect(isInterveningIfSatisfied(g as any, String(p1), "If you've cast another spell this turn, draw a card.")).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If you've cast a spell this turn, draw a card.")).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you cast a spell this turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you cast two or more spells this turn, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If you didn't cast a spell this turn, draw a card.")).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you cast no spells this turn, draw a card.')).toBe(false);

    (g.state as any).spellsCastThisTurn.push({ casterId: p1 });
    expect(isInterveningIfSatisfied(g as any, String(p1), "If you've cast another spell this turn, draw a card.")).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you cast two or more spells this turn, draw a card.')).toBe(true);

    (g.state as any).spellsCastLastTurnCount = 0;
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no spells were cast last turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you cast no spells last turn, draw a card.')).toBe(true);

    (g.state as any).spellsCastLastTurnCount = 2;
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no spells were cast last turn, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you cast no spells last turn, draw a card.')).toBe(false);
  });

  it('supports last-turn self spell-count templates via per-player counts', () => {
    const g = createInitialGameState('t_intervening_if_eval_last_turn_you_cast');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).spellsCastLastTurnByPlayerCounts = { [p1]: 2, [p2]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you cast two or more spells last turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you cast two or more spells last turn, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you cast no spells last turn, draw a card.')).toBe(false);

    // If the map is present but missing an entry, treat that as 0 (common representation)
    (g.state as any).spellsCastLastTurnByPlayerCounts = { [p1]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you cast no spells last turn, draw a card.')).toBe(true);
  });

  it('supports tapped/untapped control templates for lands/creatures', () => {
    const g = createInitialGameState('t_intervening_if_eval_untapped_control');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield = [
      { id: 'l1', controller: p1, owner: p1, tapped: true, card: { name: 'Plains', type_line: 'Basic Land — Plains' } },
      { id: 'l2', controller: p1, owner: p1, tapped: false, card: { name: 'Island', type_line: 'Basic Land — Island' } },
      { id: 'c1', controller: p1, owner: p1, tapped: false, card: { name: 'Bear', type_line: 'Creature — Bear' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control an untapped land, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a tapped land, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control no untapped lands, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control no tapped lands, draw a card.')).toBe(false);

    // Remove the untapped land
    (g.state as any).battlefield = (g.state as any).battlefield.filter((p: any) => p.id !== 'l2');
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control no untapped lands, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control an untapped land, draw a card.')).toBe(false);

    // Creatures
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control an untapped creature, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control no untapped creatures, draw a card.')).toBe(false);
  });

  it('supports opponent control-negative templates', () => {
    const g = createInitialGameState('t_intervening_if_eval_opponent_controls_no');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).battlefield = [
      { id: 'c1', controller: p2, owner: p2, card: { name: 'Bear', type_line: 'Creature — Bear' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent controls no creatures, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no opponent controls a creature, draw a card.')).toBe(false);

    (g.state as any).battlefield = [];
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent controls no creatures, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no opponent controls a creature, draw a card.')).toBe(true);
  });

  it('supports creature/land count comparisons vs opponents: fewer/more than an opponent/each opponent', () => {
    const g = createInitialGameState('t_intervening_if_eval_fewer_more_than_opponents');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');

    (g.state as any).battlefield = [
      // P1: 1 creature, 1 land
      { id: 'p1_c1', controller: p1, owner: p1, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p1_l1', controller: p1, owner: p1, card: { name: 'Plains', type_line: 'Basic Land — Plains' } },

      // P2: 2 creatures, 2 lands
      { id: 'p2_c1', controller: p2, owner: p2, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p2_c2', controller: p2, owner: p2, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p2_l1', controller: p2, owner: p2, card: { name: 'Island', type_line: 'Basic Land — Island' } },
      { id: 'p2_l2', controller: p2, owner: p2, card: { name: 'Island', type_line: 'Basic Land — Island' } },

      // P3: 3 creatures, 3 lands
      { id: 'p3_c1', controller: p3, owner: p3, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p3_c2', controller: p3, owner: p3, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p3_c3', controller: p3, owner: p3, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p3_l1', controller: p3, owner: p3, card: { name: 'Swamp', type_line: 'Basic Land — Swamp' } },
      { id: 'p3_l2', controller: p3, owner: p3, card: { name: 'Swamp', type_line: 'Basic Land — Swamp' } },
      { id: 'p3_l3', controller: p3, owner: p3, card: { name: 'Swamp', type_line: 'Basic Land — Swamp' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control fewer creatures than an opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you control fewer creatures than an opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you control fewer creatures than an opponent, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control fewer creatures than each opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you control fewer creatures than each opponent, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you control more lands than each opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you control more lands than each opponent, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you control more creatures than each other player, draw a card.')).toBe(true);
  });

  it('supports opponent-relative creature/land comparisons: "no opponent controls more" / "an opponent controls fewer"', () => {
    const g = createInitialGameState('t_intervening_if_eval_opponent_relative_counts');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');

    (g.state as any).battlefield = [
      // P1: 1 creature, 1 land
      { id: 'p1_c1', controller: p1, owner: p1, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p1_l1', controller: p1, owner: p1, card: { name: 'Plains', type_line: 'Basic Land — Plains' } },

      // P2: 2 creatures, 2 lands
      { id: 'p2_c1', controller: p2, owner: p2, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p2_c2', controller: p2, owner: p2, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p2_l1', controller: p2, owner: p2, card: { name: 'Island', type_line: 'Basic Land — Island' } },
      { id: 'p2_l2', controller: p2, owner: p2, card: { name: 'Island', type_line: 'Basic Land — Island' } },

      // P3: 3 creatures, 3 lands
      { id: 'p3_c1', controller: p3, owner: p3, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p3_c2', controller: p3, owner: p3, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p3_c3', controller: p3, owner: p3, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p3_l1', controller: p3, owner: p3, card: { name: 'Swamp', type_line: 'Basic Land — Swamp' } },
      { id: 'p3_l2', controller: p3, owner: p3, card: { name: 'Swamp', type_line: 'Basic Land — Swamp' } },
      { id: 'p3_l3', controller: p3, owner: p3, card: { name: 'Swamp', type_line: 'Basic Land — Swamp' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p3), 'If no opponent controls more creatures than you, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If no opponent controls more creatures than you, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no opponent controls more creatures than you, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p3), 'If an opponent controls fewer lands than you, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If an opponent controls fewer lands than you, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent controls fewer lands than you, draw a card.')).toBe(false);
  });

  it('treats "no opponent controls more" comparisons as vacuously true with no opponents', () => {
    const g = createInitialGameState('t_intervening_if_eval_no_opp_more_vacuous');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield = [
      { id: 'p1_c1', controller: p1, owner: p1, card: { name: 'Bear', type_line: 'Creature — Bear' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no opponent controls more creatures than you, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent controls fewer creatures than you, draw a card.')).toBe(false);
  });

  it('supports "no opponent controls fewer" and "as many / at least as many" comparisons vs opponents', () => {
    const g = createInitialGameState('t_intervening_if_eval_as_many_and_no_opp_fewer');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');

    // Scenario A: equality/at-least for permanents
    // P1: 2 creatures, 2 lands
    // P2: 2 creatures, 2 lands
    // P3: 3 creatures, 2 lands
    (g.state as any).battlefield = [
      // P1
      { id: 'p1_c1', controller: p1, owner: p1, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p1_c2', controller: p1, owner: p1, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p1_l1', controller: p1, owner: p1, card: { name: 'Plains', type_line: 'Basic Land — Plains' } },
      { id: 'p1_l2', controller: p1, owner: p1, card: { name: 'Plains', type_line: 'Basic Land — Plains' } },

      // P2
      { id: 'p2_c1', controller: p2, owner: p2, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p2_c2', controller: p2, owner: p2, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p2_l1', controller: p2, owner: p2, card: { name: 'Island', type_line: 'Basic Land — Island' } },
      { id: 'p2_l2', controller: p2, owner: p2, card: { name: 'Island', type_line: 'Basic Land — Island' } },

      // P3
      { id: 'p3_c1', controller: p3, owner: p3, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p3_c2', controller: p3, owner: p3, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p3_c3', controller: p3, owner: p3, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p3_l1', controller: p3, owner: p3, card: { name: 'Swamp', type_line: 'Basic Land — Swamp' } },
      { id: 'p3_l2', controller: p3, owner: p3, card: { name: 'Swamp', type_line: 'Basic Land — Swamp' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control as many creatures as an opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control as many creatures as each opponent, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you control at least as many creatures as each opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you control as many lands as each other player, draw a card.')).toBe(true);

    // Scenario B: no-opponent-controls-fewer
    // P1: 1 land, P2: 2 lands, P3: 3 lands
    (g.state as any).battlefield = [
      { id: 'p1_l1b', controller: p1, owner: p1, card: { name: 'Plains', type_line: 'Basic Land — Plains' } },
      { id: 'p2_l1b', controller: p2, owner: p2, card: { name: 'Island', type_line: 'Basic Land — Island' } },
      { id: 'p2_l2b', controller: p2, owner: p2, card: { name: 'Island', type_line: 'Basic Land — Island' } },
      { id: 'p3_l1b', controller: p3, owner: p3, card: { name: 'Swamp', type_line: 'Basic Land — Swamp' } },
      { id: 'p3_l2b', controller: p3, owner: p3, card: { name: 'Swamp', type_line: 'Basic Land — Swamp' } },
      { id: 'p3_l3b', controller: p3, owner: p3, card: { name: 'Swamp', type_line: 'Basic Land — Swamp' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no opponent controls fewer lands than you, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If no opponent controls fewer lands than you, draw a card.')).toBe(false);

    // Scenario C: equality/at-least for zones + opponent-relative "as many"
    (g.state as any).zones = {
      [p1]: { handCount: 3, graveyardCount: 1, libraryCount: 40 },
      [p2]: { handCount: 3, graveyardCount: 2, libraryCount: 40 },
      [p3]: { handCount: 1, graveyardCount: 2, libraryCount: 41 },
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have as many cards in hand as an opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have as many cards in hand as each opponent, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have at least as many cards in hand as each opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If an opponent has at least as many cards in hand as you, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If no opponent has as many cards in hand as you, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have as many cards in your library as an opponent, draw a card.')).toBe(true);
  });

  it('supports "no more/no fewer" and "at most as many" comparisons vs opponents', () => {
    const g = createInitialGameState('t_intervening_if_eval_no_more_no_fewer_at_most');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');

    // Permanents: P1=2 creatures, P2=3 creatures, P3=1 creature
    (g.state as any).battlefield = [
      { id: 'p1_c1', controller: p1, owner: p1, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p1_c2', controller: p1, owner: p1, card: { name: 'Bear', type_line: 'Creature — Bear' } },

      { id: 'p2_c1', controller: p2, owner: p2, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p2_c2', controller: p2, owner: p2, card: { name: 'Bear', type_line: 'Creature — Bear' } },
      { id: 'p2_c3', controller: p2, owner: p2, card: { name: 'Bear', type_line: 'Creature — Bear' } },

      { id: 'p3_c1', controller: p3, owner: p3, card: { name: 'Bear', type_line: 'Creature — Bear' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control no more creatures than an opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you control no more creatures than an opponent, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you control no fewer creatures than each opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control no fewer creatures than each opponent, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you control at most as many creatures as each opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control at most as many creatures as each opponent, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent controls at most as many creatures as you, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If an opponent controls at most as many creatures as you, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p3), 'If no opponent controls no more creatures than you, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If no opponent controls no more creatures than you, draw a card.')).toBe(false);

    // Zones: P1 hand=2, P2 hand=5, P3 hand=1
    (g.state as any).zones = {
      [p1]: { handCount: 2, graveyardCount: 0, libraryCount: 40 },
      [p2]: { handCount: 5, graveyardCount: 0, libraryCount: 40 },
      [p3]: { handCount: 1, graveyardCount: 0, libraryCount: 40 },
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no more cards in hand than an opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you have no more cards in hand than an opponent, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you have no fewer cards in hand than each opponent, draw a card.')).toBe(true);

    expect(isInterveningIfSatisfied(g as any, String(p3), 'If you have at most as many cards in hand as each opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have at most as many cards in hand as each opponent, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent has no more cards in hand than you, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If an opponent has no more cards in hand than you, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p3), 'If no opponent has no more cards in hand than you, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If no opponent has no more cards in hand than you, draw a card.')).toBe(false);
  });

  it('supports hand/graveyard count comparisons vs opponents: fewer/more than an opponent/each opponent', () => {
    const g = createInitialGameState('t_intervening_if_eval_hand_graveyard_vs_opponents');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');

    // P1: hand=2, gy=4
    // P2: hand=5, gy=2
    // P3: hand=1, gy=4
    (g.state as any).zones = {
      [p1]: { handCount: 2, graveyardCount: 4 },
      [p2]: { handCount: 5, graveyardCount: 2 },
      [p3]: { handCount: 1, graveyardCount: 4 },
    };

    // Hand
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have fewer cards in hand than an opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have less cards in hand than an opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have fewer cards in hand than each opponent, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have less cards in hand than each opponent, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have more cards in hand than an opponent, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have more cards in hand than each opponent, draw a card.')).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you have more cards in your hand than each other player, draw a card.')).toBe(true);

    // Graveyard
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If you have more cards in your graveyard than an opponent, draw a card.')
    ).toBe(true);
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If you have more cards in your graveyard than each opponent, draw a card.')
    ).toBe(false);

    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If you have fewer cards in your graveyard than an opponent, draw a card.')
    ).toBe(false);
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If you have less cards in your graveyard than an opponent, draw a card.')
    ).toBe(false);
  });

  it('supports opponent-relative zone comparisons and library comparisons vs opponents', () => {
    const g = createInitialGameState('t_intervening_if_eval_zone_vs_opponents_extended');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');

    (g.state as any).zones = {
      [p1]: { handCount: 2, graveyardCount: 4, libraryCount: 60 },
      [p2]: { handCount: 5, graveyardCount: 2, libraryCount: 40 },
      [p3]: { handCount: 1, graveyardCount: 4, libraryCount: 50 },
    };

    // Opponent-relative (hand)
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If no opponent has more cards in hand than you, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no opponent has more cards in hand than you, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent has more cards in hand than you, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If an opponent has fewer cards in hand than you, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p3), 'If an opponent has less cards in hand than you, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no opponent has fewer cards in hand than you, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no opponent has less cards in hand than you, draw a card.')).toBe(false);

    // Opponent-relative (graveyard)
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If an opponent has fewer cards in their graveyard than you, draw a card.')
    ).toBe(true);
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If an opponent has less cards in their graveyard than you, draw a card.')
    ).toBe(true);
    expect(
      isInterveningIfSatisfied(g as any, String(p2), 'If no opponent has fewer cards in their graveyard than you, draw a card.')
    ).toBe(true);
    expect(
      isInterveningIfSatisfied(g as any, String(p2), 'If no opponent has less cards in their graveyard than you, draw a card.')
    ).toBe(true);

    // Library comparisons (you vs opponents)
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If you have more cards in your library than each opponent, draw a card.')
    ).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), 'If you have fewer cards in your library than an opponent, draw a card.')).toBe(true);
    expect(
      isInterveningIfSatisfied(g as any, String(p3), 'If you have fewer cards in your library than each opponent, draw a card.')
    ).toBe(false);
  });

  it('supports opponent numeric zone thresholds: at least/at most/no more/no fewer (an/each/no opponent)', () => {
    const g = createInitialGameState('t_intervening_if_eval_opponent_numeric_zone_thresholds');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');

    (g.state as any).zones = {
      [p1]: { handCount: 2, graveyardCount: 0, libraryCount: 40 },
      [p2]: { handCount: 5, graveyardCount: 4, libraryCount: 60 },
      [p3]: { handCount: 1, graveyardCount: 2, libraryCount: 10 },
    };

    // Existential
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent has at least 5 cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent has at most 1 card in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent has no fewer than 6 cards in hand, draw a card.')).toBe(false);

    // Universal
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If each opponent has at least 1 card in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If each opponent has at most 4 cards in hand, draw a card.')).toBe(false);

    // Universal negation
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no opponent has at least 6 cards in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no opponent has at most 1 card in hand, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no opponent has no more than 2 cards in hand, draw a card.')).toBe(false);

    // Other zones
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent has at most 2 cards in their graveyard, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If each opponent has at least 10 cards in their library, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no opponent has at most 10 cards in their library, draw a card.')).toBe(false);
  });

  it('treats "each opponent" and "no opponent" numeric zone thresholds as vacuously true with no opponents', () => {
    const g = createInitialGameState('t_intervening_if_eval_opponent_numeric_zone_thresholds_vacuous');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: { handCount: 2, graveyardCount: 0, libraryCount: 40 },
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent has at least 1 card in hand, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If each opponent has at least 1 card in hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If no opponent has at least 1 card in hand, draw a card.')).toBe(true);
  });

  it('treats "each opponent" comparisons as vacuously true with no opponents', () => {
    const g = createInitialGameState('t_intervening_if_eval_each_opponent_vacuous');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: { handCount: 2, graveyardCount: 3 },
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have fewer cards in hand than an opponent, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have fewer cards in hand than each opponent, draw a card.')).toBe(true);
  });

  it('supports empty-zone wording variants: graveyard empty / no cards in graveyard / no cards in your hand', () => {
    const g = createInitialGameState('t_intervening_if_eval_empty_zones');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    // Hand empty via zones.handCount
    (g.state as any).zones = { [p1]: { handCount: 0 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no cards in your hand, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no cards in hand, draw a card.')).toBe(true);

    (g.state as any).zones[p1].handCount = 2;
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no cards in your hand, draw a card.')).toBe(false);

    // Graveyard empty via zones.graveyardCount
    (g.state as any).zones[p1].graveyardCount = 0;
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no cards in your graveyard, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If your graveyard is empty, draw a card.')).toBe(true);

    (g.state as any).zones[p1].graveyardCount = 1;
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no cards in your graveyard, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If your graveyard is empty, draw a card.')).toBe(false);
  });

  it('supports day/night style: "If a player cast two or more spells last turn" / "If an opponent cast two or more spells last turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_last_turn_two_spells');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).spellsCastLastTurnByPlayerCounts = { [p1]: 1, [p2]: 2 };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If a player cast two or more spells last turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent cast two or more spells last turn, draw a card.')).toBe(true);

    (g.state as any).spellsCastLastTurnByPlayerCounts = { [p1]: 2, [p2]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If a player cast two or more spells last turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent cast two or more spells last turn, draw a card.')).toBe(false);
  });

  it('supports source permanent checks: untapped / enchanted / enchanted or equipped', () => {
    const g = createInitialGameState('t_intervening_if_eval_enchanted_untapped');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    // Put an Aura and an Equipment onto the battlefield so attachment lookups work
    (g.state as any).battlefield = [
      { id: 'aura1', controller: p1, owner: p1, card: { name: 'Pacifism', type_line: 'Enchantment — Aura' } },
      { id: 'eq1', controller: p1, owner: p1, card: { name: 'Short Sword', type_line: 'Artifact — Equipment' } },
    ];

    const source = { id: 'c1', controller: p1, owner: p1, tapped: false, attachments: ['aura1'] };
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's untapped, draw a card.", source)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's enchanted, draw a card.", source)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's enchanted or equipped, draw a card.", source)).toBe(true);

    const equippedOnly = { id: 'c2', controller: p1, owner: p1, tapped: true, attachments: ['eq1'] };
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's untapped, draw a card.", equippedOnly)).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's enchanted, draw a card.", equippedOnly)).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's enchanted or equipped, draw a card.", equippedOnly)).toBe(true);
  });

  it('supports control templates: "If you control an enchanted creature" / "If you control an equipped creature"', () => {
    const g = createInitialGameState('t_intervening_if_eval_control_enchanted_equipped');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield = [
      { id: 'aura1', controller: p1, owner: p1, card: { name: 'Pacifism', type_line: 'Enchantment — Aura' } },
      { id: 'eq1', controller: p1, owner: p1, card: { name: 'Short Sword', type_line: 'Artifact — Equipment' } },
      {
        id: 'c1',
        controller: p1,
        owner: p1,
        card: { name: 'Bear', type_line: 'Creature — Bear', power: '2', toughness: '2' },
        attachments: ['aura1'],
      },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control an enchanted creature, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control an equipped creature, draw a card.')).toBe(false);

    // Attach equipment to the creature as well
    (g.state as any).battlefield.find((p: any) => p.id === 'c1').attachments.push('eq1');
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control an equipped creature, draw a card.')).toBe(true);
  });

  it('supports combat state templates: attacking / blocking / blocked / unblocked (requires source permanent)', () => {
    const g = createInitialGameState('t_intervening_if_eval_combat_state');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const attacker = {
      id: 'a1',
      controller: p1,
      owner: p1,
      attacking: p2,
      blockedBy: ['b1'],
      card: { name: 'Attacker', type_line: 'Creature', power: '2', toughness: '2' },
    };
    const blocker = {
      id: 'b1',
      controller: p2,
      owner: p2,
      blocking: ['a1'],
      card: { name: 'Blocker', type_line: 'Creature', power: '2', toughness: '2' },
    };
    (g.state as any).battlefield = [attacker, blocker];

    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's attacking, draw a card.", attacker)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's blocked, draw a card.", attacker)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's unblocked, draw a card.", attacker)).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p2), "If it's blocking, draw a card.", blocker)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p2), "If it's blocked, draw a card.", blocker)).toBe(false);
  });

  it("supports 'first spell you cast this turn'", () => {
    const g = createInitialGameState('t_intervening_if_eval_first_spell');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).spellsCastThisTurn = [{ casterId: p1 }];
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's the first spell you've cast this turn, draw a card.")).toBe(true);

    (g.state as any).spellsCastThisTurn.push({ casterId: p1 });
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's the first spell you cast this turn, draw a card.")).toBe(false);
  });

  it('supports graveyard count templates and threshold', () => {
    const g = createInitialGameState('t_intervening_if_eval_graveyard_counts');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: {
        graveyard: Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, type_line: 'Instant' })),
      },
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have six or more cards in your graveyard, draw a card.')).toBe(true);

    // Threshold should be false at 6
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have threshold, draw a card.')).toBe(false);

    // Add one more card to hit 7
    (g.state as any).zones[p1].graveyard.push({ id: 'c6', name: 'C6', type_line: 'Sorcery' });
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If seven or more cards are in your graveyard, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have threshold, draw a card.')).toBe(true);

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have exactly seven cards in your graveyard, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have six or fewer cards in your graveyard, draw a card.')).toBe(false);
  });

  it('supports library count variants: fewer / exactly', () => {
    const g = createInitialGameState('t_intervening_if_eval_library_counts');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: {
        libraryCount: 1,
      },
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have one or fewer cards in your library, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have exactly one card in your library, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have two or fewer cards in your library, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have exactly two cards in your library, draw a card.')).toBe(false);
  });

  it('supports keyword shorthands: delirium / hellbent / metalcraft', () => {
    const g = createInitialGameState('t_intervening_if_eval_shorthands');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    // delirium (4+ types in graveyard)
    (g.state as any).zones = {
      [p1]: {
        graveyard: [
          { id: 'a', name: 'A', type_line: 'Artifact' },
          { id: 'c', name: 'C', type_line: 'Creature — Bear' },
          { id: 'i', name: 'I', type_line: 'Instant' },
          { id: 'l', name: 'L', type_line: 'Land' },
        ],
        handCount: 0,
      },
    };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have delirium, draw a card.')).toBe(true);

    // hellbent (no cards in hand)
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have hellbent, draw a card.')).toBe(true);

    // metalcraft (3+ artifacts)
    (g.state as any).battlefield = [
      { id: 'a1', controller: p1, owner: p1, card: { name: 'Sol Ring', type_line: 'Artifact' } },
      { id: 'a2', controller: p1, owner: p1, card: { name: 'Arcane Signet', type_line: 'Artifact' } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have metalcraft, draw a card.')).toBe(false);
    (g.state as any).battlefield.push({
      id: 'a3',
      controller: p1,
      owner: p1,
      card: { name: 'Mind Stone', type_line: 'Artifact' },
    });
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have metalcraft, draw a card.')).toBe(true);
  });

  it('supports turn-history checks: life gained / opponent lost life / cards drawn / land entered', () => {
    const g = createInitialGameState('t_intervening_if_eval_turn_history_common');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).lifeGainedThisTurn = { [p1]: 3 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you gained three or more life this turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you gained life this turn, draw a card.')).toBe(true);
    (g.state as any).lifeGainedThisTurn = { [p1]: 2 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have gained three or more life this turn, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If you've gained life this turn, draw a card.")).toBe(true);

    (g.state as any).lifeLostThisTurn = { [p1]: 0 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you lost life this turn, draw a card.')).toBe(false);
    (g.state as any).lifeLostThisTurn = { [p1]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you lost life this turn, draw a card.')).toBe(true);

    (g.state as any).lifeLostThisTurn = { [p2]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent lost life this turn, exile the top card of your library.')).toBe(true);
    (g.state as any).lifeLostThisTurn = { [p2]: 0 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent lost life this turn, exile the top card of your library.')).toBe(false);

    (g.state as any).cardsDrawnThisTurn = { [p1]: 2 };
    expect(isInterveningIfSatisfied(g as any, String(p1), "If you've drawn two or more cards this turn, create a token.")).toBe(true);
    (g.state as any).cardsDrawnThisTurn = { [p1]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), "If you've drawn two or more cards this turn, create a token.")).toBe(false);

    (g.state as any).landsEnteredBattlefieldThisTurn = { [p1]: 1 };
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If a land entered the battlefield under your control this turn, draw a card.')
    ).toBe(true);
    (g.state as any).landsEnteredBattlefieldThisTurn = { [p1]: 0 };
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If a land entered the battlefield under your control this turn, draw a card.')
    ).toBe(false);
  });

  it('supports graveyard creature density and empty-library checks', () => {
    const g = createInitialGameState('t_intervening_if_eval_gy_density_empty_lib');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).zones = {
      [p1]: {
        graveyard: [
          { id: 'c1', name: 'C1', type_line: 'Creature — Bear' },
          { id: 'c2', name: 'C2', type_line: 'Creature — Elf' },
          { id: 'i1', name: 'I1', type_line: 'Instant' },
        ],
        libraryCount: 0,
      },
    };

    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If there are two or more creature cards in your graveyard, draw a card.')
    ).toBe(true);
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If there are three or more creature cards in your graveyard, draw a card.')
    ).toBe(false);

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have no cards in your library, you win the game.')).toBe(true);
  });

  it('supports source checks: kicked / modified / +1/+1 counter / tapped / token', () => {
    const g = createInitialGameState('t_intervening_if_eval_source_common');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const kickedSource = { id: 's1', controller: p1, owner: p1, card: { wasKicked: true } };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it was kicked, draw two cards.', kickedSource)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it was kicked, draw two cards.')).toBe(null);

    (g.state as any).battlefield = [
      { id: 'aura1', controller: p1, owner: p1, card: { name: 'Aura', type_line: 'Enchantment — Aura' } },
    ];
    const modified = { id: 'm1', controller: p1, owner: p1, attachments: ['aura1'] };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If this creature is modified, draw a card.', modified)).toBe(true);

    const hasCounter = { id: 'c1', controller: p1, owner: p1, counters: { '+1/+1': 1 } };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it has a +1/+1 counter on it, draw a card.', hasCounter)).toBe(true);

    const tappedToken = { id: 't1', controller: p1, owner: p1, tapped: true, isToken: true };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it is tapped, draw a card.', tappedToken)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it is a token, draw a card.', tappedToken)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it isn't tapped, draw a card.", tappedToken)).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it isn't a token, draw a card.", tappedToken)).toBe(false);

    const untappedNonToken = { id: 'p2', controller: p1, owner: p1, tapped: false, isToken: false };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it is not tapped, draw a card.', untappedNonToken)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's a token, draw a card.", untappedNonToken)).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's not a token, draw a card.", untappedNonToken)).toBe(true);
  });

  it('supports common permanent-count checks: treasures / gates / snow / desert / basic types / domain', () => {
    const g = createInitialGameState('t_intervening_if_eval_counts_domain');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).battlefield = [
      // Treasures
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `tr${i}`,
        controller: p1,
        owner: p1,
        card: { name: `Treasure ${i}`, type_line: 'Artifact — Treasure' },
      })),
      // Gates
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `g${i}`,
        controller: p1,
        owner: p1,
        card: { name: `Gate ${i}`, type_line: 'Land — Gate' },
      })),
      // Snow permanents
      { id: 'sn1', controller: p1, owner: p1, card: { name: 'Snow Land', type_line: 'Snow Land — Forest' } },
      { id: 'sn2', controller: p1, owner: p1, card: { name: 'Snow Artifact', type_line: 'Snow Artifact' } },
      { id: 'sn3', controller: p1, owner: p1, card: { name: 'Snow Creature', type_line: 'Snow Creature — Bear' } },
      // Desert
      { id: 'd1', controller: p1, owner: p1, card: { name: 'Desert', type_line: 'Land — Desert' } },
      // Domain basics
      { id: 'pl', controller: p1, owner: p1, card: { name: 'Plains', type_line: 'Basic Land — Plains' } },
      { id: 'is', controller: p1, owner: p1, card: { name: 'Island', type_line: 'Basic Land — Island' } },
      { id: 'sw', controller: p1, owner: p1, card: { name: 'Swamp', type_line: 'Basic Land — Swamp' } },
      { id: 'mo', controller: p1, owner: p1, card: { name: 'Mountain', type_line: 'Basic Land — Mountain' } },
      { id: 'fo', controller: p1, owner: p1, card: { name: 'Forest', type_line: 'Basic Land — Forest' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control ten or more Treasures, you win the game.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control ten or more Gates, you win the game.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control three or more snow permanents, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a Desert, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a Plains, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control lands of each basic land type, draw a card.')).toBe(true);
  });

  it('supports battalion, blocking checks, party, legendary/named, poison, mana value, and source-dealt-damage-to-opponent', () => {
    const g = createInitialGameState('t_intervening_if_eval_misc_common');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const battalionSource = { id: 'a1', controller: p1, owner: p1, attacking: p2, card: { name: 'A', type_line: 'Creature', power: '2', toughness: '2' } };
    (g.state as any).battlefield = [
      battalionSource,
      { id: 'a2', controller: p1, owner: p1, attacking: p2, card: { name: 'B', type_line: 'Creature', power: '2', toughness: '2' } },
      { id: 'a3', controller: p1, owner: p1, attacking: p2, card: { name: 'C', type_line: 'Creature', power: '2', toughness: '2' } },
    ];
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If this creature and at least two other creatures are attacking, draw a card.', battalionSource)
    ).toBe(true);

    // Blocking a red creature
    const blocker = { id: 'b1', controller: p1, owner: p1, blocking: ['red1'] };
    (g.state as any).battlefield.push({
      id: 'red1',
      controller: p2,
      owner: p2,
      card: { name: 'Red Guy', type_line: 'Creature — Goblin', colors: ['R'] },
    });
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's blocking a red creature, draw a card.", blocker)).toBe(true);

    // Full party
    (g.state as any).battlefield = [
      { id: 'cl', controller: p1, owner: p1, card: { name: 'Cleric', type_line: 'Creature — Cleric' } },
      { id: 'ro', controller: p1, owner: p1, card: { name: 'Rogue', type_line: 'Creature — Rogue' } },
      { id: 'wa', controller: p1, owner: p1, card: { name: 'Warrior', type_line: 'Creature — Warrior' } },
      { id: 'wi', controller: p1, owner: p1, card: { name: 'Wizard', type_line: 'Creature — Wizard' } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you have a full party, draw a card.')).toBe(true);

    // Legendary + named
    (g.state as any).battlefield.push({
      id: 'leg',
      controller: p1,
      owner: p1,
      card: { name: 'Kellan', type_line: 'Legendary Creature — Human' },
    });
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a legendary creature, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a creature named Kellan, draw a card.')).toBe(true);

    // Poison counters
    (g.state as any).poisonCounters = { [p2]: 3 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If an opponent has three or more poison counters, draw a card.')).toBe(true);

    // Mana value threshold
    (g.state as any).battlefield.push({
      id: 'mv5',
      controller: p1,
      owner: p1,
      card: { name: 'Big', type_line: 'Artifact', cmc: 5 },
    });
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you control a permanent with mana value five or greater, draw a card.')).toBe(true);

    // Source dealt damage to an opponent this turn
    (g.state as any).creaturesThatDealtDamageToPlayer = {
      [p2]: { src1: { creatureName: 'Hit', totalDamage: 2 } },
    };
    const src1 = { id: 'src1', controller: p1, owner: p1 };
    expect(
      isInterveningIfSatisfied(g as any, String(p1), 'If it dealt damage to an opponent this turn, draw a card.', src1)
    ).toBe(true);
  });

  it('supports cast-time metadata: "If you cast it during your main phase"', () => {
    const g = createInitialGameState('t_intervening_if_eval_cast_timing');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const srcTrue = { id: 's1', controller: p1, owner: p1, castDuringOwnMainPhase: true };
    const srcFalse = { id: 's2', controller: p1, owner: p1, castDuringOwnMainPhase: false };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you cast it during your main phase, draw a card.', srcTrue)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you cast it during your main phase, draw a card.', srcFalse)).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you cast it during your main phase, draw a card.')).toBe(null);
  });

  it('supports foretold metadata: "If it/that spell was foretold"', () => {
    const g = createInitialGameState('t_intervening_if_eval_foretold');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it was foretold, draw a card.', { card: { castFromForetell: true } })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If that spell was foretold, draw a card.', { castFromForetell: false })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If it was foretold, draw a card.')).toBe(null);
  });

  it('supports mana colors spent to cast: "If {R} was spent..." and "If N colors..."', () => {
    const g = createInitialGameState('t_intervening_if_eval_mana_spent');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const src = { manaColorsSpent: ['red', 'green'] };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If {R} was spent to cast it, draw a card.', src)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If blue mana was spent to cast this spell, draw a card.', src)).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If two or more colors of mana were spent to cast it, draw a card.', src)).toBe(true);
  });

  it('supports chosen-color clauses: "If you chose red" / "If the chosen color is red"', () => {
    const g = createInitialGameState('t_intervening_if_eval_chosen_color');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you chose red, draw a card.', { chosenColor: 'red' })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If the chosen color is blue, draw a card.', { chosenColor: 'red' })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you chose red, draw a card.')).toBe(null);
  });

  it('supports day/night state: "If it\'s day" and "If it\'s day and ..."', () => {
    const g = createInitialGameState('t_intervening_if_eval_day_night');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    (g.state as any).dayNight = 'day';
    (g.state as any).battlefield = [
      { id: 'a1', controller: p1, owner: p1, card: { name: 'Sol Ring', type_line: 'Artifact' } },
    ];

    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's day, draw a card.")).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's night, draw a card.")).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's day and you control an artifact, draw a card.")).toBe(true);

    (g.state as any).dayNight = 'night';
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's day, draw a card.")).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), "If it's day and you control an artifact, draw a card.")).toBe(false);
  });

  it('supports die-roll history: "If you rolled a N" / "If you rolled N or higher this turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_die_rolls');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled a ten this turn, draw a card.')).toBe(null);

    (g.state as any).dieRollsThisTurn = {
      [p1]: [
        { sides: 20, result: 10, timestamp: 1 },
        { sides: 6, result: 2, timestamp: 2 },
      ],
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled a ten this turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled a two, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled a twelve this turn, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled 12 or higher this turn, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled 10 or higher this turn, draw a card.')).toBe(true);
  });

  it('supports die-roll history: "If you rolled a die this turn" and "If you rolled N or less this turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_die_rolls_more');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled a die this turn, draw a card.')).toBe(false);

    (g.state as any).dieRollsThisTurn = {
      [p1]: [{ sides: 20, result: 3 }],
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled a die this turn, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled 2 or less this turn, draw a card.')).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you rolled 3 or less this turn, draw a card.')).toBe(true);
  });

  it('supports dungeon completion clauses: "If you completed a dungeon" and "... this turn"', () => {
    const g = createInitialGameState('t_intervening_if_eval_dungeon');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you completed a dungeon, draw a card.')).toBe(null);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you completed a dungeon this turn, draw a card.')).toBe(null);

    (g.state as any).completedDungeons = { [p1]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you completed a dungeon, draw a card.')).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you completed a dungeon this turn, draw a card.')).toBe(null);

    (g.state as any).completedDungeonThisTurn = { [p1]: true };
    expect(isInterveningIfSatisfied(g as any, String(p1), 'If you completed a dungeon this turn, draw a card.')).toBe(true);
  });
});
