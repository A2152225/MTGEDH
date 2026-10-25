import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import { finalizeIrEventWatchers, prepareIrEventWatchers } from '../src/state/modules/triggers/irEventWatchers.js';
import { parseTriggerClause } from '../../rules-engine/src/triggerCondition/index.js';

const PICKPOCKET = "When this creature enters, it connives. When it connives this way, return up to one target nonland permanent to its owner's hand.";
const perm = (id: string, controller: string, card: any) => ({ id, controller, owner: controller, tapped: false, counters: {}, card: { id: id + '_c', type_line: 'Creature - Human Rogue', ...card } });
function game() {
  const g: any = createInitialGameState('t21cv_' + Math.random());
  g.applyEvent({ type: 'join', playerId: 'p1', name: 'P1' });
  g.applyEvent({ type: 'join', playerId: 'p2', name: 'P2' });
  g.state.turnPlayer = 'p1'; g.state.phase = 'main1'; g.state.step = 'main';
  return g;
}
const stackText = (g: any) => (g.state.stack || []).map((s: any) => String(s?.description || s?.effect || '')).join(' | ');
const conniveStep = { kind: 'connive', raw: 'it connives' };

describe('when it connives this way', () => {
  it('parses as a legacy-runtime-only clause', () => {
    const p: any = parseTriggerClause("When it connives this way, return up to one target nonland permanent to its owner's hand.", 'Psychic Pickpocket');
    expect(p?.condition?.legacyRuntimeOnly).toBe(true);
  });

  it('queues the rider after the source\'s own connive', () => {
    const g = game();
    g.state.battlefield.push(perm('pp', 'p1', { name: 'Psychic Pickpocket', oracle_text: PICKPOCKET }));
    finalizeIrEventWatchers(g, [conniveStep], prepareIrEventWatchers([]).pending, { sourceId: 'pp', sourceName: 'Psychic Pickpocket', controllerId: 'p1' }, { automationGaps: [] });
    expect(stackText(g)).toMatch(/return up to one target nonland permanent/i);
  });

  it('does not queue when another source makes it connive', () => {
    const g = game();
    g.state.battlefield.push(perm('pp', 'p1', { name: 'Psychic Pickpocket', oracle_text: PICKPOCKET }));
    finalizeIrEventWatchers(g, [{ kind: 'connive', raw: 'target creature connives' }], prepareIrEventWatchers([]).pending, { sourceId: 'other', sourceName: 'Other', controllerId: 'p1', targetPermanentId: 'pp' }, { automationGaps: [] });
    expect(stackText(g)).not.toMatch(/return up to one target/i);
  });

  it('waits while the connive discard choice is deferred', () => {
    const g = game();
    g.state.battlefield.push(perm('pp', 'p1', { name: 'Psychic Pickpocket', oracle_text: PICKPOCKET }));
    finalizeIrEventWatchers(g, [conniveStep], prepareIrEventWatchers([]).pending, { sourceId: 'pp', sourceName: 'Psychic Pickpocket', controllerId: 'p1' }, { automationGaps: [{ stepKind: 'connive', reasonCode: 'player_choice_required', raw: 'it connives' }] });
    expect(stackText(g)).not.toMatch(/return up to one target/i);
  });
});
