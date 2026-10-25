import { describe, expect, it } from 'vitest';
import { canBlockAttacker } from '../src/socket/combat-handlers/combatLegalityGates.js';
import { handleVoteResponse } from '../src/socket/resolutionVoteProliferateLimDulResponseHandlers.js';
import { tryHandleExtraVoteOfferChoice } from '../src/socket/resolutionOptionChoiceExtraVoteHandlers.js';
import { isSpellCastingProhibitedByChosenName } from '../src/state/modules/chosen-name-restrictions.js';
import { applyFlagbearerRequirement, violatesFlagbearerRequirement } from '../src/state/modules/flagbearerTargeting.js';
import { untapPermanentsForPlayer } from '../src/state/modules/turn-handlers/turnUntapPermanents.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function perm(id: string, name: string, type: string, oracle: string, controller = 'p1', extra: any = {}): any {
  return { id, controller, owner: controller, tapped: false, counters: {}, ...extra, card: { id: id + '_c', name, type_line: type, oracle_text: oracle, keywords: [] } };
}
const io: any = { to: () => ({ emit: () => {} }), emit: () => {} };

describe('batch29 optional extra vote', () => {
  it('declining the offer moves to the next voter', async () => {
    const gameId = 'b29_vote_decline';
    ResolutionQueueManager.removeQueue(gameId);
    const game: any = { state: { battlefield: [perm('bb', 'Ballot Broker', 'Creature', 'While voting, you may vote an additional time.')], players: [{ id: 'p1' }, { id: 'p2' }] } };
    const step: any = { id: 's1', type: ResolutionStepType.VOTE, playerId: 'p1', voteId: 'v1', choices: ['a', 'b'], votesSubmitted: [], oracleIrVoterOrder: ['p1', 'p2'] };
    handleVoteResponse(io, game, gameId, step, { playerId: 'p1', selections: 'a' } as any);
    let q = ResolutionQueueManager.getQueue(gameId).steps as any[];
    const offer = q[q.length - 1];
    expect(offer.type).toBe(ResolutionStepType.OPTION_CHOICE);
    expect(offer.options.map((o: any) => o.id)).toEqual(['vote_again', 'decline']);
    expect(await tryHandleExtraVoteOfferChoice(io, game, gameId, offer, { playerId: 'p1', selections: ['decline'] } as any)).toBe(true);
    q = ResolutionQueueManager.getQueue(gameId).steps as any[];
    const next = q[q.length - 1];
    expect(next.type).toBe(ResolutionStepType.VOTE);
    expect(next.playerId).toBe('p2');
    expect(next.votesSubmitted.length).toBe(1);
    ResolutionQueueManager.removeQueue(gameId);
  });
});

describe('batch29 exiled-card name cast lock', () => {
  const erasure = perm('ae', "Ashiok's Erasure", 'Enchantment', "Flash\nWhen Ashiok's Erasure enters, exile target spell.\nYour opponents can't cast spells with the same name as the exiled card.\nWhen Ashiok's Erasure leaves the battlefield, the exiled card's owner may cast it without paying its mana cost.", 'p1');
  const state: any = { battlefield: [erasure], linkedExiles: [{ exilingPermanentId: 'ae', exiledCardName: 'Lightning Bolt' }], zones: {} };
  it('locks opponents out of the exiled name', () => {
    expect(isSpellCastingProhibitedByChosenName(state, 'p2', 'Lightning Bolt').prohibited).toBe(true);
    expect(isSpellCastingProhibitedByChosenName(state, 'p2', 'Shock').prohibited).toBe(false);
  });
  it('does not lock the controller', () => {
    expect(isSpellCastingProhibitedByChosenName(state, 'p1', 'Lightning Bolt').prohibited).toBe(false);
  });
  it('finds exile-zone cards stamped with the source', () => {
    const st: any = { battlefield: [erasure], zones: { p2: { exile: [{ id: 'x', name: 'Counterspell', exiledWithSourceId: 'ae' }] } } };
    expect(isSpellCastingProhibitedByChosenName(st, 'p2', 'Counterspell').prohibited).toBe(true);
  });
});

describe('batch29 Intruder Alarm', () => {
  it('creatures stay tapped, lands untap', () => {
    const ia = perm('ia', 'Intruder Alarm', 'Enchantment', "Creatures don't untap during their controllers' untap steps.\nWhenever a creature enters, untap all creatures.", 'p2');
    const c = perm('c', 'Bear', 'Creature', '', 'p1', { tapped: true });
    const l = perm('l', 'Forest', 'Basic Land', '', 'p1', { tapped: true });
    const ctx: any = { state: { battlefield: [ia, c, l], players: [{ id: 'p1' }, { id: 'p2' }] } };
    untapPermanentsForPlayer(ctx, 'p1');
    expect(c.tapped).toBe(true);
    expect(l.tapped).toBe(false);
  });
});

describe('batch29 attached unblockable', () => {
  const b = perm('b', 'Wall', 'Creature', '', 'p2');
  it('Aqueous Form and Aether Tunnel', () => {
    const c = perm('c', 'Bear', 'Creature', '', 'p1', { attachments: ['a'] });
    const a = perm('a', 'Aqueous Form', 'Enchantment', "Enchant creature\nEnchanted creature can't be blocked.\nWhenever enchanted creature attacks, scry 1.", 'p1', { attachedTo: 'c' });
    const d = perm('d', 'Wolf', 'Creature', '', 'p1');
    const t = perm('t', 'Aether Tunnel', 'Enchantment', "Enchant creature\nEnchanted creature gets +1/+0 and can't be blocked.", 'p1', { attachedTo: 'd' });
    const bf = [c, a, b, d, t];
    expect(canBlockAttacker(b, c, bf, 'p2', { battlefield: bf }).canBlock).toBe(false);
    expect(canBlockAttacker(b, d, bf, 'p2', { battlefield: bf }).canBlock).toBe(false);
  });
  it('restricted wording stays blockable', () => {
    const c = perm('c', 'Bear', 'Creature', '', 'p1');
    const a = perm('a', 'Some Aura', 'Enchantment', "Enchant creature\nEnchanted creature can't be blocked except by Walls.", 'p1', { attachedTo: 'c' });
    const bf = [c, a, b];
    expect(canBlockAttacker(b, c, bf, 'p2', { battlefield: bf }).canBlock).toBe(true);
  });
});

describe('batch29 Flagbearer targeting', () => {
  const bearer = perm('sb', 'Standard Bearer', 'Creature \u2014 Human Flagbearer', 'While an opponent is choosing targets as part of casting a spell they control or activating an ability they control, that player chooses at least one Flagbearer on the battlefield if able.', 'p2');
  const other = perm('o', 'Bear', 'Creature', '', 'p2');
  const state: any = { battlefield: [bearer, other] };
  const step: any = { spellCastContext: { cardId: 'x' }, validTargets: [{ id: 'sb' }, { id: 'o' }] };
  it('rejects a non-Flagbearer choice from the opponent', () => {
    expect(violatesFlagbearerRequirement(state, 'p1', step, ['o'])).toBe(true);
    expect(violatesFlagbearerRequirement(state, 'p1', step, ['sb'])).toBe(false);
  });
  it('does not bind the controller or triggered abilities', () => {
    expect(violatesFlagbearerRequirement(state, 'p2', step, ['o'])).toBe(false);
    expect(violatesFlagbearerRequirement(state, 'p1', { validTargets: step.validTargets }, ['o'])).toBe(false);
  });
  it('AI swaps in the Flagbearer', () => {
    expect(applyFlagbearerRequirement(state, 'p1', step, ['o'])).toEqual(['sb']);
  });
});
