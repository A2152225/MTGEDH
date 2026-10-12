import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { createInitialGameState } from '../src/state/gameState.js';
import { getSpellCastTriggers } from '../src/state/modules/triggered-abilities.js';
import { getSpellCastTriggersForCard } from '../src/socket/game-actions-handlers/gameActionsSpellCastTriggerDetection.js';
import { opponentCastSourceZoneMatches } from '../src/state/modules/triggers/spell-cast.js';
import { queueSacrificeTriggers } from '../src/state/modules/triggers/sacrifice.js';
import { queueCounterPlacedTriggers } from '../src/state/modules/triggers/counters.js';
import { runWithSimultaneousEntryBatch } from '../src/state/modules/triggers/simultaneousEntryBatch.js';
import { getLandfallTriggers } from '../src/state/modules/triggers/landfall.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { keywordsOnPermanent } from '../src/state/modules/triggers/triggerConditionFamilyMatch.js';

// Third-party review of the trigger IR commits (e15d1ac9..806fddc6), server findings 2, 3, 5, 6, 7.
const a = 'a' as PlayerID;
const b = 'b' as PlayerID;

function game() {
  const g: any = createInitialGameState(`t_irreview_${Math.random().toString(36).slice(2, 7)}`);
  g.applyEvent({ type: 'join', playerId: a, name: 'A' });
  g.applyEvent({ type: 'join', playerId: b, name: 'B' });
  g.state.turnPlayer = a;
  g.state.activePlayer = a;
  g.state.phase = 'precombatMain';
  g.state.step = 'MAIN1';
  g.state.stack = [];
  return g;
}

function perm(id: string, controller: PlayerID, typeLine: string, oracle = '', extra: any = {}) {
  return {
    id, controller, owner: controller, tapped: false, counters: {},
    card: { id: `${id}_c`, name: id, type_line: typeLine, oracle_text: oracle, power: '2', toughness: '2' },
    ...extra,
  };
}

const fromSource = (g: any, name: string) => (g.state.stack || []).filter((item: any) => (
  String(item?.sourceName || item?.cardName || item?.source || '').startsWith(name)
));

describe('finding 2: spell-cast qualifiers survive the legacy enum', () => {
  const bear = { name: 'Bear', type_line: 'Creature - Bear', colors: ['G'] };
  const golem = { name: 'Golem', type_line: 'Artifact Creature - Golem', colors: [] };
  const legend = { name: 'Legend', type_line: 'Legendary Creature - Elf', colors: ['G'] };
  const setup = (oracle: string) => ({ battlefield: [perm('watcher', a, 'Enchantment', oracle)], spellsCastThisTurn: [] });

  it('"an artifact creature spell" ignores a plain creature spell (both pipelines)', () => {
    const state = setup('Whenever you cast an artifact creature spell, draw a card.');
    expect(getSpellCastTriggersForCard({ state } as any, a, bear, 'hand')).toHaveLength(0);
    expect(getSpellCastTriggers({ state } as any, a, bear)).toHaveLength(0);
    expect(getSpellCastTriggersForCard({ state } as any, a, golem, 'hand')).toHaveLength(1);
    expect(getSpellCastTriggers({ state } as any, a, golem)).toHaveLength(1);
  });

  it('"a legendary creature spell" ignores a nonlegendary creature spell', () => {
    const state = setup('Whenever you cast a legendary creature spell, draw a card.');
    expect(getSpellCastTriggersForCard({ state } as any, a, bear, 'hand')).toHaveLength(0);
    expect(getSpellCastTriggersForCard({ state } as any, a, legend, 'hand')).toHaveLength(1);
  });

  it('plain "a creature spell" is unchanged', () => {
    const state = setup('Whenever you cast a creature spell, draw a card.');
    expect(getSpellCastTriggersForCard({ state } as any, a, bear, 'hand')).toHaveLength(1);
  });
});

describe('finding 3: "anywhere other than your hand" fails closed on an unknown zone', () => {
  it('opponent pipeline', () => {
    expect(opponentCastSourceZoneMatches('not_hand', undefined)).toBe(false);
    expect(opponentCastSourceZoneMatches('not_hand', 'hand')).toBe(false);
    expect(opponentCastSourceZoneMatches('not_hand', 'graveyard')).toBe(true);
  });
});

describe('finding 5: "one or more" fires once per simultaneous event', () => {
  it('sacrifice: one or more creatures vs a creature', () => {
    const g = game();
    g.state.battlefield.push(perm('Batcher', a, 'Enchantment', 'Whenever you sacrifice one or more creatures, draw a card.'));
    g.state.battlefield.push(perm('Single', a, 'Enchantment', 'Whenever you sacrifice a creature, you gain 1 life.'));
    runWithSimultaneousEntryBatch(() => {
      queueSacrificeTriggers(g, a, perm('v1', a, 'Creature - Bear'));
      queueSacrificeTriggers(g, a, perm('v2', a, 'Creature - Bear'));
    });
    expect(fromSource(g, 'Batcher')).toHaveLength(1);
    expect(fromSource(g, 'Single')).toHaveLength(2);
  });

  it('counters: one or more creatures you control', () => {
    const g = game();
    g.state.battlefield.push(perm('Batcher', a, 'Enchantment', 'Whenever one or more +1/+1 counters are put on one or more creatures you control, draw a card.'));
    const c1 = perm('c1', a, 'Creature - Bear');
    const c2 = perm('c2', a, 'Creature - Bear');
    g.state.battlefield.push(c1, c2);
    runWithSimultaneousEntryBatch(() => {
      queueCounterPlacedTriggers(g, c1, 'c1', { '+1/+1': 1 });
      queueCounterPlacedTriggers(g, c2, 'c2', { '+1/+1': 1 });
    });
    expect(fromSource(g, 'Batcher')).toHaveLength(1);
  });
});

describe('finding 6: landfall honours the printed subject', () => {
  it('"a nontoken land you control" skips land tokens', () => {
    const g = game();
    g.state.battlefield.push(perm('Watcher', a, 'Enchantment', 'Landfall \u2014 Whenever a nontoken land you control enters, draw a card.'));
    const tokenLand = perm('tl', a, 'Land', '', { isToken: true });
    g.state.battlefield.push(tokenLand);
    triggerETBEffectsForPermanent(g, tokenLand, a);
    expect(fromSource(g, 'Watcher')).toHaveLength(0);
    const realLand = perm('rl', a, 'Land - Forest');
    g.state.battlefield.push(realLand);
    triggerETBEffectsForPermanent(g, realLand, a);
    expect(fromSource(g, 'Watcher')).toHaveLength(1);
  });

  it('legacy landfall entries are checked against the printed subject', () => {
    const g = game();
    g.state.battlefield.push(perm('Plain', a, 'Enchantment', 'Landfall — Whenever a land you control enters, draw a card.'));
    expect(getLandfallTriggers(g, a, perm('ol', b, 'Land - Forest', '', { controller: b })).filter((t: any) => t.cardName === 'Plain')).toHaveLength(0);
    expect(getLandfallTriggers(g, a, perm('ml', a, 'Land - Forest')).filter((t: any) => t.cardName === 'Plain')).toHaveLength(1);
  });

  it('an ability-word landfall clause fires once when a land is played', () => {
    const g = game();
    g.state.battlefield.push(perm('Grazer', a, 'Creature - Beast', 'Landfall — Whenever a land you control enters, you gain 1 life.'));
    g.playLand(a, { id: 'forest_1', name: 'Forest', type_line: 'Basic Land - Forest', oracle_text: '({T}: Add {G}.)' });
    expect(g.state.battlefield.some((p: any) => p.card?.name === 'Forest')).toBe(true);
    expect(fromSource(g, 'Grazer')).toHaveLength(1);
  });

  it('a land-watching creature does not trigger off its own entry', () => {
    const g = game();
    const shepherd = perm('Shepherd', a, 'Creature - Angel', 'Flying\nWhenever a nontoken land you control enters, you may return target nonland permanent card from your graveyard to your hand.');
    g.state.battlefield.push(shepherd);
    triggerETBEffectsForPermanent(g, shepherd, a);
    expect(fromSource(g, 'Shepherd')).toHaveLength(0);
  });
});

describe('finding 7: keyword subjects see granted keywords', () => {
  it('keywordsOnPermanent includes a lord grant when given the battlefield', () => {
    const lord = perm('Lord', a, 'Enchantment', 'Creatures you control have flying.');
    const bear = perm('Bear', a, 'Creature - Bear');
    expect(keywordsOnPermanent(bear)).not.toContain('flying');
    expect(keywordsOnPermanent(bear, [lord, bear])).toContain('flying');
  });

  it('"a creature with flying you control enters" fires for a creature granted flying', () => {
    const g = game();
    g.state.battlefield.push(perm('Lord', a, 'Enchantment', 'Creatures you control have flying.'));
    g.state.battlefield.push(perm('Skywatch', a, 'Enchantment', 'Whenever a creature with flying you control enters, draw a card.'));
    const bear = perm('Bear', a, 'Creature - Bear');
    g.state.battlefield.push(bear);
    triggerETBEffectsForPermanent(g, bear, a);
    expect(fromSource(g, 'Skywatch')).toHaveLength(1);
  });
});