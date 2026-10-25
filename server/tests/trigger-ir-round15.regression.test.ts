import { describe, expect, it } from 'vitest';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';
import { playerBindingsMatch } from '../../rules-engine/src/triggerCondition/matchPlayerBindings.js';
import { selfNameVariants } from '../../rules-engine/src/triggerCondition/selfNameNormalize.js';

const cond = (text: string, name?: string) => (parseTriggerClause(text, name) as any)?.condition;
const subj: any = { id: 'c', controllerId: 'p2' };
const src: any = { id: 's', controllerId: 'p1' };

describe('round 15: player bindings', () => {
  it('attacks you skips planeswalker attacks', () => {
    const c: any = { attackedTargetType: 'player' };
    expect(playerBindingsMatch(c, subj, src, { attackedTargetIsPlayer: true } as any)).toBe(true);
    expect(playerBindingsMatch(c, subj, src, { attackedTargetIsPlayer: false } as any)).toBe(false);
    expect(playerBindingsMatch(c, subj, src, {} as any)).toBe(false);
  });
  it('enchanted player bindings', () => {
    expect(playerBindingsMatch({ attackedPlayer: 'enchanted' } as any, subj, src, { attackedPlayerId: 'p3', enchantedPlayerId: 'p3' } as any)).toBe(true);
    expect(playerBindingsMatch({ attackedPlayer: 'enchanted' } as any, subj, src, { attackedPlayerId: 'p1', enchantedPlayerId: 'p3' } as any)).toBe(false);
    expect(playerBindingsMatch({ damagedPlayer: 'enchanted' } as any, subj, src, { damagedPlayerId: 'p3', enchantedPlayerId: 'p3' } as any)).toBe(true);
    expect(playerBindingsMatch({ damagedPlayer: 'enchanted' } as any, subj, src, { enchantedPlayerId: 'p3' } as any)).toBe(false);
    expect(playerBindingsMatch({ subjectControlledBy: 'enchanted_player' } as any, subj, src, { enchantedPlayerId: 'p2' } as any)).toBe(true);
    expect(playerBindingsMatch({ subjectControlledBy: 'enchanted_player' } as any, subj, src, { enchantedPlayerId: 'p3' } as any)).toBe(false);
  });
  it('attacks one of your opponents', () => {
    expect(playerBindingsMatch({ attackedPlayer: 'opponent' } as any, subj, src, { attackedPlayerId: 'p2' } as any)).toBe(true);
    expect(playerBindingsMatch({ attackedPlayer: 'opponent' } as any, subj, src, { attackedPlayerId: 'p1' } as any)).toBe(false);
  });
});

describe('round 15: split names', () => {
  it('includes short faces and the full name', () => {
    const v = selfNameVariants('Fire // Ice');
    expect(v).toContain('Fire');
    expect(v).toContain('Ice');
    expect(selfNameVariants('Ob // Xu')).toContain('Ob');
  });
});

describe('round 15: wordings parse', () => {
  it('attacks you / enchanted player / opponents', () => {
    expect(cond('Whenever a creature with flying attacks you, draw a card.')).toMatchObject({ event: 'attacks', attackedPlayer: 'you', attackedTargetType: 'player' });
    expect(cond('Whenever a creature attacks enchanted player, draw a card.')).toMatchObject({ event: 'attacks', attackedPlayer: 'enchanted', attackedTargetType: 'player' });
    expect(cond('Whenever a creature deals combat damage to enchanted player, draw a card.')).toMatchObject({ damagedPlayer: 'enchanted' });
    expect(cond('Whenever a land enchanted player controls enters, draw a card.')).toMatchObject({ event: 'enters', subjectControlledBy: 'enchanted_player' });
    expect(cond('Whenever a creature attacks one of your opponents, draw a card.')).toMatchObject({ attackedPlayer: 'opponent' });
  });
  it('generic tail', () => {
    expect(cond('Whenever a Forest you control enters, draw a card.').alternatives[0].subject.subtypeGroups).toEqual([['forest']]);
    expect(cond('Whenever another creature you control enters or dies, draw a card.')).toMatchObject({ event: 'enters', pairedEvent: 'dies' });
    expect(cond('When this creature enters or becomes monstrous, draw a card.')).toMatchObject({ pairedEvent: 'becomes_monstrous' });
    expect(cond('Whenever this creature or equipped creature attacks, draw a card.').alternatives.map((a: any) => a.source)).toEqual(['self', 'equipped']);
    expect(cond('Whenever you cast a creature spell with power 4 or greater, draw a card.').alternatives[0].subject.stats).toEqual([{ stat: 'power', op: 'gte', value: 4 }]);
  });
});
