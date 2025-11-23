/**
 * Tests for Part 5 keyword abilities (Rules 702.74-702.92)
 */

import { describe, it, expect } from 'vitest';
import {
  // Evoke
  evoke, payEvoke, wasEvoked, getEvokeSacrificeTrigger,
  // Hideaway
  hideaway, completeHideaway, getHideawayCard, hasHideawayTriggered,
  // Prowl
  prowl, payProwl, wasProwled, isProwlAvailable,
  // Reinforce
  reinforce, activateReinforce, canActivateReinforce,
  // Conspire
  conspire, payConspire, wasConspired,
  // Persist
  persist, shouldPersistTrigger,
  // Wither
  wither, witherDamage,
  // Retrace
  retrace, castWithRetrace, canUseRetrace,
  // Devour
  devour, sacrificeForDevour, getDevourCounters, getCreaturesDevoured,
  // Exalted
  exalted, isAttackingAlone, getExaltedBonus,
  // Unearth
  unearth, activateUnearth, canActivateUnearth, wasUnearthed,
  // Cascade
  cascade, resolveCascade, canCascadeInto,
  // Annihilator
  annihilator, getAnnihilatorCount,
  // Level Up
  levelUp, activateLevelUp, getLevelCounters,
  // Rebound
  rebound, exileForRebound, shouldReboundTrigger,
  // Umbra Armor
  umbraArmor, applyUmbraArmor,
  // Infect
  infect, infectDamageToPlayer, infectDamageToCreature,
  // Battle Cry
  battleCry, getBattleCryBonus,
  // Living Weapon
  livingWeapon, triggerLivingWeapon, getGermToken
} from '../src/keywordAbilities';

describe('Evoke (Rule 702.74)', () => {
  it('should create evoke ability', () => {
    const ability = evoke('mulldrifter', '2U');
    expect(ability.type).toBe('evoke');
    expect(ability.cost).toBe('2U');
    expect(ability.wasPaid).toBe(false);
  });

  it('should mark evoke cost as paid', () => {
    const ability = evoke('mulldrifter', '2U');
    const paid = payEvoke(ability);
    expect(wasEvoked(paid)).toBe(true);
  });

  it('should trigger sacrifice when evoke cost is paid', () => {
    const ability = evoke('mulldrifter', '2U');
    const paid = payEvoke(ability);
    expect(getEvokeSacrificeTrigger(paid)).toBe(true);
  });
});

describe('Hideaway (Rule 702.75)', () => {
  it('should create hideaway ability with default count', () => {
    const ability = hideaway('mosswort-bridge');
    expect(ability.type).toBe('hideaway');
    expect(ability.count).toBe(4);
  });

  it('should create hideaway ability with custom count', () => {
    const ability = hideaway('new-hideaway', 3);
    expect(ability.count).toBe(3);
  });

  it('should complete hideaway by exiling card', () => {
    const ability = hideaway('mosswort-bridge');
    const completed = completeHideaway(ability, 'lightning-bolt');
    expect(getHideawayCard(completed)).toBe('lightning-bolt');
    expect(hasHideawayTriggered(completed)).toBe(true);
  });
});

describe('Prowl (Rule 702.76)', () => {
  it('should create prowl ability', () => {
    const ability = prowl('stinkdrinker-bandit', '1B');
    expect(ability.type).toBe('prowl');
    expect(ability.cost).toBe('1B');
  });

  it('should mark prowl cost as paid', () => {
    const ability = prowl('stinkdrinker-bandit', '1B');
    const paid = payProwl(ability);
    expect(wasProwled(paid)).toBe(true);
  });

  it('should check if prowl is available based on creature types', () => {
    const ability = prowl('morsel-theft', '2B');
    const spellTypes = ['Rogue'];
    const damageTypes = ['Rogue', 'Warrior'];
    expect(isProwlAvailable(ability, spellTypes, damageTypes)).toBe(true);
  });

  it('should not allow prowl if no matching types dealt damage', () => {
    const ability = prowl('morsel-theft', '2B');
    const spellTypes = ['Rogue'];
    const damageTypes = ['Warrior', 'Cleric'];
    expect(isProwlAvailable(ability, spellTypes, damageTypes)).toBe(false);
  });
});

describe('Reinforce (Rule 702.77)', () => {
  it('should create reinforce ability', () => {
    const ability = reinforce('hunting-triad', 3, '2G');
    expect(ability.type).toBe('reinforce');
    expect(ability.count).toBe(3);
    expect(ability.cost).toBe('2G');
  });

  it('should return counter count when activated', () => {
    const ability = reinforce('hunting-triad', 3, '2G');
    const counters = activateReinforce(ability, 'target-creature');
    expect(counters).toBe(3);
  });

  it('should only activate from hand', () => {
    const ability = reinforce('hunting-triad', 3, '2G');
    expect(canActivateReinforce(ability, 'hand')).toBe(true);
    expect(canActivateReinforce(ability, 'battlefield')).toBe(false);
    expect(canActivateReinforce(ability, 'graveyard')).toBe(false);
  });
});

describe('Conspire (Rule 702.78)', () => {
  it('should create conspire ability', () => {
    const ability = conspire('incremental-blight');
    expect(ability.type).toBe('conspire');
    expect(ability.wasPaid).toBe(false);
  });

  it('should pay conspire by tapping two creatures', () => {
    const ability = conspire('incremental-blight');
    const paid = payConspire(ability, ['creature1', 'creature2']);
    expect(wasConspired(paid)).toBe(true);
    expect(paid.tappedCreatures).toEqual(['creature1', 'creature2']);
  });

  it('should throw error if not exactly two creatures', () => {
    const ability = conspire('incremental-blight');
    expect(() => payConspire(ability, ['creature1'])).toThrow();
    expect(() => payConspire(ability, ['c1', 'c2', 'c3'])).toThrow();
  });
});

describe('Persist (Rule 702.79)', () => {
  it('should create persist ability', () => {
    const ability = persist('kitchen-finks');
    expect(ability.type).toBe('persist');
  });

  it('should trigger if no -1/-1 counters', () => {
    const ability = persist('kitchen-finks');
    expect(shouldPersistTrigger(ability, 0)).toBe(true);
  });

  it('should not trigger if has -1/-1 counters', () => {
    const ability = persist('kitchen-finks');
    expect(shouldPersistTrigger(ability, 1)).toBe(false);
    expect(shouldPersistTrigger(ability, 2)).toBe(false);
  });
});

describe('Wither (Rule 702.80)', () => {
  it('should create wither ability', () => {
    const ability = wither('boggart-ram-gang');
    expect(ability.type).toBe('wither');
  });

  it('should convert damage to -1/-1 counters', () => {
    const ability = wither('boggart-ram-gang');
    expect(witherDamage(ability, 3)).toBe(3);
    expect(witherDamage(ability, 5)).toBe(5);
  });
});

describe('Retrace (Rule 702.81)', () => {
  it('should create retrace ability', () => {
    const ability = retrace('raven-crime');
    expect(ability.type).toBe('retrace');
  });

  it('should cast with retrace by discarding land', () => {
    const ability = retrace('raven-crime');
    const cast = castWithRetrace(ability, 'swamp');
    expect(cast.discardedLand).toBe('swamp');
  });

  it('should only use retrace from graveyard', () => {
    const ability = retrace('raven-crime');
    expect(canUseRetrace(ability, 'graveyard')).toBe(true);
    expect(canUseRetrace(ability, 'hand')).toBe(false);
    expect(canUseRetrace(ability, 'battlefield')).toBe(false);
  });
});

describe('Devour (Rule 702.82)', () => {
  it('should create devour ability', () => {
    const ability = devour('mycoloth', 2);
    expect(ability.type).toBe('devour');
    expect(ability.count).toBe(2);
    expect(ability.devoured).toBe(0);
  });

  it('should create devour with quality', () => {
    const ability = devour('preyseizer-dragon', 1, 'artifact');
    expect(ability.quality).toBe('artifact');
  });

  it('should calculate counters based on creatures devoured', () => {
    const ability = devour('mycoloth', 2);
    const sacrificed = sacrificeForDevour(ability, 3);
    expect(getCreaturesDevoured(sacrificed)).toBe(3);
    expect(getDevourCounters(sacrificed)).toBe(6); // 3 * 2
  });
});

describe('Exalted (Rule 702.83)', () => {
  it('should create exalted ability', () => {
    const ability = exalted('rafiq-of-the-many');
    expect(ability.type).toBe('exalted');
  });

  it('should check if creature attacks alone', () => {
    expect(isAttackingAlone(['creature1'])).toBe(true);
    expect(isAttackingAlone(['creature1', 'creature2'])).toBe(false);
    expect(isAttackingAlone([])).toBe(false);
  });

  it('should provide +1/+1 bonus', () => {
    const bonus = getExaltedBonus();
    expect(bonus.power).toBe(1);
    expect(bonus.toughness).toBe(1);
  });
});

describe('Unearth (Rule 702.84)', () => {
  it('should create unearth ability', () => {
    const ability = unearth('hell-mongrel', 'B');
    expect(ability.type).toBe('unearth');
    expect(ability.cost).toBe('B');
  });

  it('should activate unearth', () => {
    const ability = unearth('hell-mongrel', 'B');
    const activated = activateUnearth(ability);
    expect(wasUnearthed(activated)).toBe(true);
  });

  it('should only activate from graveyard', () => {
    const ability = unearth('hell-mongrel', 'B');
    expect(canActivateUnearth(ability, 'graveyard')).toBe(true);
    expect(canActivateUnearth(ability, 'hand')).toBe(false);
  });

  it('should not activate if already unearthed', () => {
    const ability = unearth('hell-mongrel', 'B');
    const activated = activateUnearth(ability);
    expect(canActivateUnearth(activated, 'graveyard')).toBe(false);
  });
});

describe('Cascade (Rule 702.85)', () => {
  it('should create cascade ability', () => {
    const ability = cascade('maelstrom-wanderer');
    expect(ability.type).toBe('cascade');
  });

  it('should resolve cascade with exiled cards', () => {
    const ability = cascade('maelstrom-wanderer');
    const resolved = resolveCascade(ability, ['card1', 'card2'], 'card2');
    expect(resolved.exiledCards).toEqual(['card1', 'card2']);
    expect(resolved.castCard).toBe('card2');
  });

  it('should check if card can be cascaded into', () => {
    expect(canCascadeInto(8, 5, false)).toBe(true);
    expect(canCascadeInto(8, 8, false)).toBe(false);
    expect(canCascadeInto(8, 9, false)).toBe(false);
    expect(canCascadeInto(8, 5, true)).toBe(false); // lands can't be cascaded into
  });
});

describe('Annihilator (Rule 702.86)', () => {
  it('should create annihilator ability', () => {
    const ability = annihilator('ulamog', 4);
    expect(ability.type).toBe('annihilator');
    expect(ability.count).toBe(4);
  });

  it('should get sacrifice count', () => {
    const ability = annihilator('kozilek', 4);
    expect(getAnnihilatorCount(ability)).toBe(4);
  });
});

describe('Level Up (Rule 702.87)', () => {
  it('should create level up ability', () => {
    const ability = levelUp('student-of-warfare', '1');
    expect(ability.type).toBe('levelUp');
    expect(ability.cost).toBe('1');
    expect(getLevelCounters(ability)).toBe(0);
  });

  it('should add level counters when activated', () => {
    let ability = levelUp('student-of-warfare', '1');
    ability = activateLevelUp(ability);
    expect(getLevelCounters(ability)).toBe(1);
    ability = activateLevelUp(ability);
    expect(getLevelCounters(ability)).toBe(2);
  });
});

describe('Rebound (Rule 702.88)', () => {
  it('should create rebound ability', () => {
    const ability = rebound('staggershock', true);
    expect(ability.type).toBe('rebound');
    expect(ability.wasCastFromHand).toBe(true);
  });

  it('should exile if cast from hand', () => {
    const ability = rebound('staggershock', true);
    const exiled = exileForRebound(ability);
    expect(exiled.exiled).toBe(true);
    expect(shouldReboundTrigger(exiled)).toBe(true);
  });

  it('should not exile if not cast from hand', () => {
    const ability = rebound('staggershock', false);
    const exiled = exileForRebound(ability);
    expect(exiled.exiled).toBe(false);
    expect(shouldReboundTrigger(exiled)).toBe(false);
  });
});

describe('Umbra Armor (Rule 702.89)', () => {
  it('should create umbra armor ability', () => {
    const ability = umbraArmor('hyena-umbra');
    expect(ability.type).toBe('umbraArmor');
  });

  it('should apply umbra armor replacement', () => {
    const ability = umbraArmor('hyena-umbra');
    expect(applyUmbraArmor(ability)).toBe(true);
  });
});

describe('Infect (Rule 702.90)', () => {
  it('should create infect ability', () => {
    const ability = infect('glistener-elf');
    expect(ability.type).toBe('infect');
  });

  it('should convert damage to poison counters for players', () => {
    const ability = infect('glistener-elf');
    expect(infectDamageToPlayer(ability, 3)).toBe(3);
  });

  it('should convert damage to -1/-1 counters for creatures', () => {
    const ability = infect('glistener-elf');
    expect(infectDamageToCreature(ability, 3)).toBe(3);
  });
});

describe('Battle Cry (Rule 702.91)', () => {
  it('should create battle cry ability', () => {
    const ability = battleCry('hero-of-bladehold');
    expect(ability.type).toBe('battleCry');
  });

  it('should provide +1/+0 bonus', () => {
    const bonus = getBattleCryBonus();
    expect(bonus.power).toBe(1);
    expect(bonus.toughness).toBe(0);
  });
});

describe('Living Weapon (Rule 702.92)', () => {
  it('should create living weapon ability', () => {
    const ability = livingWeapon('batterskull');
    expect(ability.type).toBe('livingWeapon');
  });

  it('should trigger and create germ token', () => {
    const ability = livingWeapon('batterskull');
    const triggered = triggerLivingWeapon(ability, 'germ-token-1');
    expect(getGermToken(triggered)).toBe('germ-token-1');
  });
});
