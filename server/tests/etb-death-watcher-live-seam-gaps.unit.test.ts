import { describe, expect, it } from 'vitest';
import { evaluateLiveSeams } from '../scripts/oracle-ir-live-seam-audit.ts';
import { detectDeathTriggers, detectETBTriggers, getDeathTriggers } from '../src/state/modules/triggered-abilities.js';

const permanent = { id: 'seam_1', controller: 'p1' };

// mtg_data.db (is_token = 0)
const TATYOVA =
  "Land creatures you control have flying.\nWhenever a land you control enters, if you control seven or more lands, up to one target land you control becomes a 3/3 Elemental creature with haste. It's still a land.";
const CURSE_RESTLESS =
  "Enchant player\nWhenever a land enchanted player controls enters, you create a 2/2 black Zombie creature token with decayed. (It can't block. When it attacks, sacrifice it at end of combat.)";
const HUNGRY_LYNX =
  "Cats you control have protection from Rats. (They can't be blocked, targeted, or dealt damage by Rats.)\nAt the beginning of your end step, target opponent creates a 1/1 black Rat creature token with deathtouch.\nWhenever a Rat dies, put a +1/+1 counter on each Cat you control.";
const HANSK =
  "At the beginning of your upkeep, target opponent creates three Walker tokens. (They're 2/2 black Zombie creatures.)\n{T}: Hansk, Slayer Zealot deals 2 damage to target creature.\nWhenever a Zombie an opponent controls dies, draw a card.";

describe('ETB / death watcher live-seam gaps', () => {
  it('detects land-you-control enters watchers', () => {
    const triggers = detectETBTriggers({
      name: 'Tatyova, Steward of Tides',
      type_line: 'Legendary Creature — Merfolk Druid',
      oracle_text: TATYOVA,
    }, permanent);
    expect(triggers.some((t) => t.triggerType === 'land_you_control_etb')).toBe(true);
    expect(evaluateLiveSeams({
      name: 'Tatyova, Steward of Tides',
      type_line: 'Legendary Creature — Merfolk Druid',
      oracle_text: TATYOVA,
    }, { exileEmission: true }).some((gap) => gap.seam === 'etb_watcher')).toBe(false);
  });

  it('detects enchanted-player land enters watchers', () => {
    const triggers = detectETBTriggers({
      name: 'Curse of the Restless Dead',
      type_line: 'Enchantment — Aura Curse',
      oracle_text: CURSE_RESTLESS,
    }, permanent);
    expect(triggers.some((t) => t.triggerType === 'enchanted_player_land_etb')).toBe(true);
    expect(evaluateLiveSeams({
      name: 'Curse of the Restless Dead',
      type_line: 'Enchantment — Aura Curse',
      oracle_text: CURSE_RESTLESS,
    }, { exileEmission: true }).some((gap) => gap.seam === 'etb_watcher')).toBe(false);
  });

  it('detects any-typed creature dies watchers', () => {
    const triggers = detectDeathTriggers({
      name: 'Hungry Lynx',
      type_line: 'Creature — Cat',
      oracle_text: HUNGRY_LYNX,
    }, permanent);
    expect(triggers.some((t) => t.triggerType === 'any_typed_creature_dies')).toBe(true);
    expect(evaluateLiveSeams({
      name: 'Hungry Lynx',
      type_line: 'Creature — Cat',
      oracle_text: HUNGRY_LYNX,
    }, { exileEmission: true }).some((gap) => gap.seam === 'death_watcher')).toBe(false);
  });

  it('detects typed opponent-creature dies watchers', () => {
    const triggers = detectDeathTriggers({
      name: 'Hansk, Slayer Zealot',
      type_line: 'Legendary Creature — Human Archer',
      oracle_text: HANSK,
    }, permanent);
    expect(triggers.some((t) => t.triggerType === 'typed_opponent_creature_dies')).toBe(true);
    expect(evaluateLiveSeams({
      name: 'Hansk, Slayer Zealot',
      type_line: 'Legendary Creature — Human Archer',
      oracle_text: HANSK,
    }, { exileEmission: true }).some((gap) => gap.seam === 'death_watcher')).toBe(false);
  });

  it('emits any_typed_creature_dies when a matching creature dies', () => {
    const lynx = {
      id: 'lynx_1',
      controller: 'p1',
      card: { name: 'Hungry Lynx', type_line: 'Creature — Cat', oracle_text: HUNGRY_LYNX },
    };
    const rat = {
      id: 'rat_1',
      controller: 'p2',
      card: { name: 'Typhoid Rats', type_line: 'Creature — Rat', oracle_text: 'Deathtouch' },
    };
    const bear = {
      id: 'bear_1',
      controller: 'p2',
      card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '' },
    };
    const ctx = {
      gameId: 'unknown',
      state: { battlefield: [lynx, rat], stack: [], zones: { p1: { graveyard: [] }, p2: { graveyard: [] } } },
    } as any;
    expect(getDeathTriggers(ctx, rat, 'p2').some((t: any) => t.triggerType === 'any_typed_creature_dies')).toBe(true);

    ctx.state.battlefield = [lynx, bear];
    expect(getDeathTriggers(ctx, bear, 'p2').some((t: any) => t.triggerType === 'any_typed_creature_dies')).toBe(false);
  });

  it('emits typed_opponent_creature_dies only for opponents matching creatures', () => {
    const hansk = {
      id: 'hansk_1',
      controller: 'p1',
      card: { name: 'Hansk, Slayer Zealot', type_line: 'Legendary Creature — Human Archer', oracle_text: HANSK },
    };
    const oppZombie = {
      id: 'z_opp',
      controller: 'p2',
      card: { name: 'Walking Corpse', type_line: 'Creature — Zombie', oracle_text: '' },
    };
    const ownZombie = {
      id: 'z_own',
      controller: 'p1',
      card: { name: 'Walking Corpse', type_line: 'Creature — Zombie', oracle_text: '' },
    };
    const ctx = {
      gameId: 'unknown',
      state: { battlefield: [hansk, oppZombie], stack: [], zones: { p1: { graveyard: [] }, p2: { graveyard: [] } } },
    } as any;
    expect(getDeathTriggers(ctx, oppZombie, 'p2').some((t: any) => t.triggerType === 'typed_opponent_creature_dies')).toBe(true);

    ctx.state.battlefield = [hansk, ownZombie];
    expect(getDeathTriggers(ctx, ownZombie, 'p1').some((t: any) => t.triggerType === 'typed_opponent_creature_dies')).toBe(false);
  });

  it('detects any-land enters, multi-type ETB, and remaining death watchers', () => {
    expect(detectETBTriggers({
      name: 'Zo-Zu the Punisher',
      type_line: 'Creature — Goblin Warrior',
      oracle_text: "Whenever a land enters, Zo-Zu deals 2 damage to that land's controller.",
    }, permanent).some((t) => t.triggerType === 'any_land_etb')).toBe(true);

    expect(evaluateLiveSeams({
      name: 'Zo-Zu the Punisher',
      type_line: 'Creature — Goblin Warrior',
      oracle_text: "Whenever a land enters, Zo-Zu deals 2 damage to that land's controller.",
    }, { exileEmission: true }).some((gap) => gap.seam === 'etb_watcher')).toBe(false);

    expect(evaluateLiveSeams({
      name: 'Faldorn, Dread Wolf Herald',
      type_line: 'Legendary Creature — Human Druid',
      oracle_text: 'Whenever you cast a spell from exile or a land you control enters from exile, create a 2/2 green Wolf creature token.',
    }, { exileEmission: true }).some((gap) => gap.seam === 'etb_watcher')).toBe(false);

    expect(detectETBTriggers({
      name: 'Valley Mightcaller',
      type_line: 'Creature — Frog Warrior',
      oracle_text: 'Whenever another Frog, Rabbit, Raccoon, or Squirrel you control enters, put a +1/+1 counter on this creature.',
    }, permanent).some((t) => t.triggerType === 'multi_typed_you_control_etb')).toBe(true);

    expect(detectDeathTriggers({
      name: 'Sauron, Lord of the Rings',
      type_line: 'Legendary Creature — Avatar Horror',
      oracle_text: 'Whenever a commander an opponent controls dies, the Ring tempts you.',
    }, permanent).some((t) => t.triggerType === 'opponent_commander_dies')).toBe(true);

    expect(evaluateLiveSeams({
      name: 'The Great Goblin',
      type_line: 'Legendary Creature — Goblin Warrior',
      oracle_text: 'Whenever another Goblin, Orc, or Army you control dies, exile the top card of your library.',
    }, { exileEmission: true }).some((gap) => gap.seam === 'death_watcher')).toBe(false);
  });
});
