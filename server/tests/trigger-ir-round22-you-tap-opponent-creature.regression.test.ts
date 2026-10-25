import { describe, expect, it } from 'vitest';
import { queueYouTapOpponentCreatureTriggers } from '../src/state/modules/triggers/youTapOpponentCreature.js';
import { getTapTriggers } from '../src/state/modules/triggers/tap-untap.js';

function makeCtx() {
  const sentry = { id: 'sentry', controller: 'p1', card: { name: 'Icewrought Sentry', type_line: 'Creature \u2014 Elemental Soldier', oracle_text: 'Vigilance\nWhenever this creature attacks, you may pay {1}{U}. When you do, tap target creature an opponent controls.\nWhenever you tap an untapped creature an opponent controls, this creature gets +2/+1 until end of turn.' } };
  const bear = { id: 'bear', controller: 'p2', card: { name: 'Bear', type_line: 'Creature \u2014 Bear', oracle_text: '' } };
  const mine = { id: 'mine', controller: 'p1', card: { name: 'Mine', type_line: 'Creature \u2014 Bear', oracle_text: '' } };
  return { state: { stack: [], battlefield: [sentry, bear, mine], players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p1' }, bumpSeq() {} } as any;
}

describe('round 22: whenever you tap an untapped creature an opponent controls', () => {
  it('queues when you tap an opponent creature', () => {
    const ctx = makeCtx();
    const queued = queueYouTapOpponentCreatureTriggers(ctx, ['bear'], 'p1');
    expect(queued).toHaveLength(1);
    expect(String(queued[0].description || queued[0].effect)).toMatch(/gets \+2\/\+1/);
  });

  it('does not queue for your own creature, an opponent tapper, or via the becomes-tapped queue', () => {
    expect(queueYouTapOpponentCreatureTriggers(makeCtx(), ['mine'], 'p1')).toHaveLength(0);
    expect(queueYouTapOpponentCreatureTriggers(makeCtx(), ['bear'], 'p2')).toHaveLength(0);
    const ctx = makeCtx();
    const bear = ctx.state.battlefield[1];
    expect(getTapTriggers(ctx, bear, 'p2').filter((t: any) => t.permanentId === 'sentry')).toHaveLength(0);
  });
});
