import { describe, expect, it, vi } from 'vitest';
import { cyclingAbilityHasXCost, dispatchZoneCardAbility } from './tableLayoutZoneAbilityDispatch';

const card = { id: 'c1', name: 'Test Card' } as any;

function run(overrides: Record<string, unknown>) {
  const emit = vi.fn();
  const onCastFromHand = vi.fn();
  const onGraveyardAbility = vi.fn();
  const onExileAbility = vi.fn();
  const handled = dispatchZoneCardAbility({
    zone: 'graveyard',
    gameId: 'g1',
    cardId: 'c1',
    abilityId: 'flashback',
    card,
    emit,
    onCastFromHand,
    onGraveyardAbility,
    onExileAbility,
    ...(overrides as object),
  } as any);
  return { handled, emit, onCastFromHand, onGraveyardAbility, onExileAbility };
}

describe('dispatchZoneCardAbility (table card right-click menu)', () => {
  it('routes graveyard Flashback and Unearth through the shared graveyard handler', () => {
    for (const abilityId of ['flashback', 'unearth', 'escape', 'embalm', 'eternalize', 'jump-start', 'retrace', 'disturb']) {
      const r = run({ zone: 'graveyard', abilityId });
      expect(r.handled).toBe(true);
      expect(r.onGraveyardAbility).toHaveBeenCalledWith('c1', abilityId, card);
    }
  });

  it('falls back to the activateGraveyardAbility socket event when no App handler is supplied', () => {
    const r = run({ zone: 'graveyard', abilityId: 'unearth', onGraveyardAbility: undefined });
    expect(r.handled).toBe(true);
    expect(r.emit).toHaveBeenCalledWith('activateGraveyardAbility', { gameId: 'g1', cardId: 'c1', abilityId: 'unearth' });
  });

  it('routes exile Foretell / Plot / adventure casts through the shared exile handler', () => {
    for (const abilityId of ['foretell-cast', 'plot-cast', 'adventure-creature', 'play-from-exile']) {
      const r = run({ zone: 'exile', abilityId });
      expect(r.handled).toBe(true);
      expect(r.onExileAbility).toHaveBeenCalledWith('c1', abilityId, card);
    }
  });

  it('does not treat the Suspended status line as an action', () => {
    const r = run({ zone: 'exile', abilityId: 'suspend-status' });
    expect(r.handled).toBe(false);
    expect(r.onExileAbility).not.toHaveBeenCalled();
  });

  it('keeps hand cycling and foretell working and wires Cast with Kicker / Buyback to the cast flow', () => {
    expect(run({ zone: 'hand', abilityId: 'plains-cycling-2' }).emit).toHaveBeenCalledWith('activateCycling', { gameId: 'g1', cardId: 'c1', abilityId: 'plains-cycling-2' });
    expect(run({ zone: 'hand', abilityId: 'foretell' }).emit).toHaveBeenCalledWith('foretellCard', { gameId: 'g1', cardId: 'c1' });
    for (const abilityId of ['cast-kicked', 'cast-buyback']) {
      const r = run({ zone: 'hand', abilityId });
      expect(r.handled).toBe(true);
      expect(r.onCastFromHand).toHaveBeenCalledWith('c1');
    }
  });

  it('ignores clicks without a game id and unknown zones', () => {
    expect(run({ gameId: null }).handled).toBe(false);
    expect(run({ zone: 'library' }).handled).toBe(false);
  });
});

describe('cycling with {X} in its cost', () => {
  const shark = {
    id: 'shark',
    name: 'Shark Typhoon',
    type_line: 'Enchantment',
    oracle_text: "Whenever you cast a noncreature spell, create an X/X blue Shark creature token with flying, where X is that spell's mana value.\nCycling {X}{1}{U} ({X}{1}{U}, Discard this card: Draw a card.)\nWhen you cycle this card, create an X/X blue Shark creature token with flying.",
  } as any;
  const tusker = {
    id: 'tusker',
    name: 'Krosan Tusker',
    type_line: 'Creature — Boar Beast',
    oracle_text: 'Cycling {2}{G} ({2}{G}, Discard this card: Draw a card.)\nWhen you cycle this card, you may search your library for a basic land card, reveal that card, put it into your hand, then shuffle.',
  } as any;

  it('asks for X instead of emitting when the cycling cost has {X}', () => {
    expect(cyclingAbilityHasXCost(shark, 'cycling')).toBe(true);
    const onCyclingNeedsX = vi.fn();
    const r = run({ zone: 'hand', cardId: 'shark', abilityId: 'cycling', card: shark, onCyclingNeedsX });
    expect(r.handled).toBe(true);
    expect(onCyclingNeedsX).toHaveBeenCalledWith('shark', 'cycling', shark);
    expect(r.emit).not.toHaveBeenCalled();
  });

  it('emits right away for fixed-cost cycling', () => {
    expect(cyclingAbilityHasXCost(tusker, 'cycling')).toBe(false);
    const onCyclingNeedsX = vi.fn();
    const r = run({ zone: 'hand', cardId: 'tusker', abilityId: 'cycling', card: tusker, onCyclingNeedsX });
    expect(onCyclingNeedsX).not.toHaveBeenCalled();
    expect(r.emit).toHaveBeenCalledWith('activateCycling', { gameId: 'g1', cardId: 'tusker', abilityId: 'cycling' });
  });
});
