import { describe, it, expect } from 'vitest';
import type { GameContext } from '../src/state/context.js';
import { applyBatch19DrawInstead } from '../src/state/modules/replacementBatch19DrawInstead.js';
import { collectOraclePatternZoneChangeReplacementSpecsFromState } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecZoneChangeOracleTemplates.js';
import { collectOraclePatternDamageReplacementSpecsFromState, overlaySpecsMatchDamage } from '../src/state/modules/replacementEffectSpec-handlers/replacementEffectSpecDamageOracleTemplates.js';
import { setResolvingSpellSource, clearResolvingSpellSource } from '../src/state/modules/replacementResolvingSpellSource.js';
import { permanentActivatedAbilitiesLockedByAttachment } from '../src/state/modules/staticActivationLockFromAttachments.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { classifyStaticCensusLine } from '../scripts/static-replacement-census-classify.js';

type Perm = { id: string; controller: string; owner: string; card: { name: string; type_line: string; oracle_text: string }; [k: string]: unknown };
const perm = (id: string, name: string, oracle: string, controller = 'p1', type_line = 'Creature'): Perm =>
  ({ id, controller, owner: controller, card: { name, type_line, oracle_text: oracle } });
// Single fixture adapter: tests build plain state objects, the API takes a GameContext.
const ctxOf = (state: object, libraries = new Map<string, unknown[]>(), gameId?: string): GameContext => ({ state, libraries, gameId }) as unknown as GameContext;
const zones = () => ({ p1: { hand: [] as unknown[], handCount: 0, libraryCount: 2, graveyard: [] as unknown[], graveyardCount: 0, exile: [] as unknown[], exileCount: 0 }, p2: { hand: [], handCount: 0, libraryCount: 2, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 } });
const CRYPT = "If you would draw a card, return a card from your graveyard to your hand instead. If you can't, you lose the game.\nIf a card would be put into your graveyard from anywhere, exile that card instead.";

describe('batch20 draw replacements', () => {
  it('Uba Mask cards are playable by that player this turn', () => {
    const state = { battlefield: [perm('um', 'Uba Mask', 'If a player would draw a card, that player exiles that card face up instead.', 'p1', 'Artifact')], zones: zones(), players: [], turnNumber: 7 };
    const l = new Map<string, unknown[]>([['p1', [{ id: 'c1', name: 'A' }]]]);
    expect(applyBatch19DrawInstead(ctxOf(state, l), 'p1', { drawNumber: 1, isDrawStep: true }, () => true)).toBe(true);
    expect(state.zones.p1.exile[0]).toMatchObject({ canBePlayedBy: 'p1', playableUntilTurn: 7, playFromExileRequiresSourcePermanentId: 'um' });
  });
  it('Forbidden Crypt queues a graveyard choice when several cards are available', () => {
    const gameId = 'batch20-crypt-choice';
    const z = zones(); z.p1.graveyard.push({ id: 'g1', name: 'G1' }, { id: 'g2', name: 'G2' });
    const players = [{ id: 'p1', hasLost: false }];
    const state = { battlefield: [perm('fc', 'Forbidden Crypt', CRYPT, 'p1', 'Enchantment')], zones: z, players };
    expect(applyBatch19DrawInstead(ctxOf(state, undefined, gameId), 'p1', { drawNumber: 1, isDrawStep: true }, () => true)).toBe(true);
    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, 'p1');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ mandatory: true, destination: 'hand' });
    expect(z.p1.hand).toHaveLength(0);
    // second replaced draw: one card left unclaimed -> another choice; third: none left -> loss
    expect(applyBatch19DrawInstead(ctxOf(state, undefined, gameId), 'p1', { drawNumber: 2, isDrawStep: false }, () => true)).toBe(true);
    expect(players[0].hasLost).toBe(false);
    expect(applyBatch19DrawInstead(ctxOf(state, undefined, gameId), 'p1', { drawNumber: 3, isDrawStep: false }, () => true)).toBe(true);
    expect(players[0].hasLost).toBe(true);
    expect(state.battlefield.some((p) => p.owner === 'p1')).toBe(false);
  });
  it('Forbidden Crypt exile-that-card line yields a graveyard-to-exile spec', () => {
    const specs = collectOraclePatternZoneChangeReplacementSpecsFromState({ battlefield: [perm('fc', 'Forbidden Crypt', CRYPT, 'p1', 'Enchantment')] });
    expect(specs.some((s) => s.instead?.redirectZone === 'exile')).toBe(true);
  });
  it('Notion Thief exempts only the first draw in the draw step', () => {
    const state = { battlefield: [perm('nt', 'Notion Thief', 'If an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card.')], zones: zones(), players: [], turnPlayer: 'p2', turnNumber: 3 };
    const drew: string[] = [];
    const d = (pid: string) => { drew.push(pid); return true; };
    expect(applyBatch19DrawInstead(ctxOf(state), 'p2', { drawNumber: 1, isDrawStep: true }, d)).toBe(false);
    expect(applyBatch19DrawInstead(ctxOf(state), 'p2', { drawNumber: 2, isDrawStep: true }, d)).toBe(true);
    expect(drew).toEqual(['p1']);
  });
});

describe('batch20 spell source id', () => {
  it('spells that target it match via the resolving spell snapshot', () => {
    const g = perm('g', 'Guardian', 'Prevent all damage that would be dealt to ~ by spells that target it.');
    const state = { battlefield: [g], stack: [] };
    const input = { damageDealer: 'p2', damageReceiver: 'p1', damageSourcePermanentId: 'spell1', targetPermanentId: 'g' };
    const hit = () => collectOraclePatternDamageReplacementSpecsFromState(state)
      .some((s) => s.instead?.modify === 'cap' && s.instead?.value === 0 && overlaySpecsMatchDamage(s, input, state));
    setResolvingSpellSource(state, { id: 'spell1', cardId: 'card1', card: { name: 'Shock', type_line: 'Instant' }, targets: ['g'] });
    expect(hit()).toBe(true);
    clearResolvingSpellSource(state);
    expect(hit()).toBe(false);
  });
});

describe('batch20 activation locks and classifier', () => {
  it('Stony Silence locks artifacts only; Linvala only opponents', () => {
    const rock = perm('r', 'Rock', '{T}: Add {C}.', 'p2', 'Artifact');
    const elf = perm('e', 'Elf', '{T}: Add {G}.', 'p2', 'Creature');
    const stony = perm('s', 'Stony Silence', "Activated abilities of artifacts can't be activated.", 'p1', 'Enchantment');
    expect(permanentActivatedAbilitiesLockedByAttachment(rock, { battlefield: [rock, elf, stony] }, true).locked).toBe(true);
    expect(permanentActivatedAbilitiesLockedByAttachment(elf, { battlefield: [rock, elf, stony] }, true).locked).toBe(false);
    const linvala = perm('l', 'Linvala', "Activated abilities of artifacts and creatures your opponents control can't be activated.");
    const mine = perm('m', 'Mine', '{T}: Add {G}.', 'p1');
    expect(permanentActivatedAbilitiesLockedByAttachment(elf, { battlefield: [elf, mine, linvala] }, false).locked).toBe(true);
    expect(permanentActivatedAbilitiesLockedByAttachment(mine, { battlefield: [elf, mine, linvala] }, false).locked).toBe(false);
  });
  it('goaded aura line with reminder text is owned by goad', () => {
    expect(classifyStaticCensusLine('Enchanted creature gets +2/+2 and is goaded. (It attacks each combat if able and attacks a player other than you if able.)', 'Psychic Impetus')?.system).toMatch(/goad/);
  });
});
