import { describe, it, expect } from 'vitest';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../../rules-engine/src/oracleIRExecutor';
import { buildMoveZoneSelectionOptions } from '../../rules-engine/src/oracleIRExecutorPlayerStepHandlers';

const GIFT = 'Each opponent reveals cards from the top of their library until they reveal a creature card. Assimilate one of the creature cards revealed this way. Then each opponent puts the other cards they revealed this way on the bottom of their library in a random order.';
const c = (id: string, type_line: string) => ({ id, name: 'Card ' + id, type_line, oracle_text: '', owner: id.slice(0, 2) });
function giftState(libs: Record<string, any[]>): any {
  return { id: 'g', format: 'commander', turnPlayer: 'p1', priority: 'p1', stack: [], startingLife: 40, life: {},
    players: ['p1', 'p2', 'p3'].map((id, seat) => ({ id, name: id, seat, life: 40, library: libs[id] || [], hand: [], graveyard: [], exile: [] })),
    battlefield: [] };
}
const twoOpps = () => ({ p2: [c('p2l1', 'Land'), c('p2c1', 'Creature \u2014 Elf'), c('p2x', 'Land')], p3: [c('p3c1', 'Creature \u2014 Bear'), c('p3x', 'Instant')] });
const oneOpp = () => ({ p2: [c('p2l1', 'Land'), c('p2c1', 'Creature \u2014 Elf'), c('p2x', 'Land')], p3: [c('p3x', 'Instant')] });
const steps = (): any[] => ((parseOracleTextToIR(GIFT, 'Gift of Perfection') as any).abilities || []).flatMap((a: any) => a.steps || []);
const ids = (r: any, pid: string) => r.state.players.find((p: any) => p.id === pid).library.map((x: any) => x.id);
const ctx = (extra: any = {}) => ({ controllerId: 'p1', sourceId: 'src', sourceName: 'Gift of Perfection', ...extra } as any);

describe('ui43 one of the [type] cards revealed this way (Gift of Perfection)', () => {
  it('single qualifying reveal is assimilated automatically; the tail leaves it alone', () => {
    const r: any = applyOracleIRStepsToGameState(giftState(oneOpp()), steps(), ctx());
    const perm = r.state.battlefield.find((p: any) => p.card?.id === 'p2c1' || p.id === 'p2c1');
    expect(perm).toBeTruthy();
    expect(String(perm.controller)).toBe('p1');
    expect(ids(r, 'p2')).not.toContain('p2c1');
    expect(ids(r, 'p2').slice(0, 1)).toEqual(['p2x']);
    expect(r.log.join('\n')).not.toMatch(/unsupported selector/);
  });
  it('several qualifying reveals across opponents need a choice', () => {
    const r: any = applyOracleIRStepsToGameState(giftState(twoOpps()), steps(), ctx(), { haltOnPlayerChoiceRequired: true } as any);
    expect(r.log.join('\n')).not.toMatch(/unsupported selector/);
    expect(r.state.battlefield.length).toBe(0);
    expect(r.lastStepOutcome?.kind ?? r.lastStepOutcome).toMatch(/choice_required/);
    // halted before the bottom-of-library tail: nothing moved yet
    expect(r.log.join('\n')).not.toMatch(/on the bottom of their library/);
  });
  it('the chosen card (from either opponent) is assimilated; others go to the bottom', () => {
    const r: any = applyOracleIRStepsToGameState(giftState(twoOpps()), steps(), ctx({ selectorContext: { chosenObjectIds: ['p3c1'] } }));
    expect(r.state.battlefield.some((p: any) => p.card?.id === 'p3c1' || p.id === 'p3c1')).toBe(true);
    expect(r.state.battlefield.some((p: any) => p.card?.id === 'p2c1' || p.id === 'p2c1')).toBe(false);
    expect(ids(r, 'p3')).not.toContain('p3c1');
    expect(ids(r, 'p2')).toContain('p2c1');
  });
  it('choice pool offers the revealed creatures from all opponents only', () => {
    const s = steps();
    const revealed = [c('p2l1', 'Land'), c('p2c1', 'Creature \u2014 Elf'), c('p3c1', 'Creature \u2014 Bear')];
    const opts: any = buildMoveZoneSelectionOptions(giftState(twoOpps()), s[1], ctx({ currentStepIndex: 1, appliedStepKinds: new Map([[0, 'reveal_top']]), stepLedger: new Map([[0, revealed.map((x) => ({ objectId: x.id, name: x.name, typeLine: x.type_line, colors: [], zone: 'library', ownerId: x.owner }))]]) }) as any);
    const optIds = [...(opts?.selectableCardIds || [])].map(String);
    expect(optIds.sort()).toEqual(['p2c1', 'p3c1']);
  });
});