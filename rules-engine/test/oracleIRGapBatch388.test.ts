import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';

const controllerId = 'p1' as PlayerID;

function expectNoTargetGaps(steps: any[], state: GameState, ctx: Record<string, unknown>) {
  const result = applyOracleIRStepsToGameState(state, steps, ctx as any, { allowOptional: true });
  expect(result.automationGaps?.some((gap) => gap.reasonCode === 'no_deterministic_target')).toBe(false);
  expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_target')).toBe(false);
  return result;
}

describe('Oracle IR gap batch 388 — target clusters (Track E2 mega-batch)', () => {
  it('executes skip untap, cant block, and grant clusters', () => {
    const manaVapors = parseOracleTextToIR(
      "Lands target player controls don't untap during their next untap step.",
      'Mana Vapors'
    );
    const skipStep = manaVapors.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'skip_next_untap');
    expect(skipStep).toBeTruthy();
    expectNoTargetGaps(
      [skipStep!],
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        battlefield: [
          { id: 'bf-land', controller: 'p2', type_line: 'Basic Land — Forest' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { targetPlayerId: 'p2', targetOpponentId: 'p2' } }
    );

    const flash = parseOracleTextToIR(
      "Green creatures and white creatures can't block this turn.",
      'Flash of Defiance'
    );
    const cantBlockStep = flash.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'cant_block');
    expect(cantBlockStep).toBeTruthy();
    expectNoTargetGaps(
      [cantBlockStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-green', controller: 'p2', type_line: 'Creature — Elf', colors: ['G'] },
          { id: 'bf-white', controller: 'p2', type_line: 'Creature — Soldier', colors: ['W'] },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );

    const blacksmith = parseOracleTextToIR(
      'During your turn, equipped creatures you control have double strike and haste.',
      "Blacksmith's Talent"
    );
    const grantStep = blacksmith.abilities
      .flatMap((a) => a.steps || [])
      .flatMap((s) => (s.kind === 'conditional' && Array.isArray((s as any).steps) ? (s as any).steps : [s]))
      .find((s) => s.kind === 'grant_temporary_ability');
    expect(grantStep).toBeTruthy();
    expectNoTargetGaps(
      [grantStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-equip', controller: controllerId, type_line: 'Artifact — Equipment', attachedTo: 'bf-creature' },
          { id: 'bf-creature', controller: controllerId, type_line: 'Creature — Human', isEquipped: true },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-equip' }
    );
  });

  it('executes destroy, exile, sacrifice, and copy clusters', () => {
    const ultimatum = parseOracleTextToIR('Destroy three target permanents.', 'Violent Ultimatum');
    const destroyStep = ultimatum.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'destroy');
    expect(destroyStep).toBeTruthy();
    expectNoTargetGaps(
      [destroyStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-a', controller: 'p2', type_line: 'Creature — Zombie' },
          { id: 'bf-b', controller: 'p2', type_line: 'Artifact' },
          { id: 'bf-c', controller: 'p2', type_line: 'Enchantment' },
        ],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-src',
        selectorContext: { chosenObjectIds: ['bf-a', 'bf-b', 'bf-c'] },
      }
    );

    const flicker = parseOracleTextToIR(
      'Exile two target artifacts, creatures, and/or lands you control.',
      'Ghostly Flicker'
    );
    const exileStep = flicker.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'exile');
    expect(exileStep).toBeTruthy();
    expectNoTargetGaps(
      [exileStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-art', controller: controllerId, type_line: 'Artifact' },
          { id: 'bf-creature', controller: controllerId, type_line: 'Creature — Human' },
        ],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-src',
        selectorContext: { chosenObjectIds: ['bf-art', 'bf-creature'] },
      }
    );

    const snub = parseOracleTextToIR('Each player sacrifices a creature of their choice.', 'Social Snub');
    const sacrificeStep = snub.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'sacrifice');
    expect(sacrificeStep).toBeTruthy();
    expectNoTargetGaps(
      [sacrificeStep!],
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        battlefield: [
          { id: 'bf-p1', controller: controllerId, type_line: 'Creature — Human' },
          { id: 'bf-p2', controller: 'p2', type_line: 'Creature — Elf' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );

    const stage = parseOracleTextToIR(
      "This land becomes a copy of target land, except it has this ability.",
      "Thespian's Stage"
    );
    const copyStep = stage.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'copy_permanent');
    expect(copyStep).toBeTruthy();
    expectNoTargetGaps(
      [copyStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-stage', controller: controllerId, type_line: 'Land' },
          { id: 'bf-ref', controller: 'p2', type_line: 'Basic Land — Island' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-stage', selectorContext: { chosenObjectIds: ['bf-ref'] } }
    );
  });

  it("copies a legendary land's name and type onto Thespian's Stage so the legend rule can see it", () => {
    const stage = parseOracleTextToIR(
      "This land becomes a copy of target land, except it has this ability.",
      "Thespian's Stage"
    );
    const copyStep = stage.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'copy_permanent');
    expect(copyStep).toBeTruthy();
    const result = applyOracleIRStepsToGameState(
      {
        players: [{ id: controllerId }],
        battlefield: [
          {
            id: 'bf-stage',
            controller: controllerId,
            type_line: 'Land',
            card: { name: "Thespian's Stage", type_line: 'Land' },
          },
          {
            id: 'bf-ruins',
            controller: controllerId,
            type_line: 'Legendary Land',
            card: { name: 'Academy Ruins', type_line: 'Legendary Land' },
          },
        ],
      } as GameState,
      [copyStep!],
      {
        controllerId,
        sourceId: 'bf-stage',
        selectorContext: { chosenObjectIds: ['bf-ruins'] },
      } as any,
      { allowOptional: true },
    );
    const copied = (result.state?.battlefield || []).find((perm: any) => perm.id === 'bf-stage') as any;
    expect(String(copied?.name || copied?.card?.name || '')).toBe('Academy Ruins');
    expect(String(copied?.card?.type_line || copied?.type_line || '').toLowerCase()).toContain('legendary');
  });

  it('executes set_base_pt, force_block, and animate clusters', () => {
    const katsumasa = parseOracleTextToIR(
      'It has base power and toughness 1/1 until end of turn.',
      'Katsumasa, the Animator'
    );
    const setBaseStep = katsumasa.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'set_base_pt');
    expect(setBaseStep).toBeTruthy();
    expectNoTargetGaps(
      [setBaseStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-art', controller: controllerId, type_line: 'Artifact' }],
      } as GameState,
      { controllerId, sourceId: 'bf-art', targetPermanentId: 'bf-art' }
    );

    const mark = parseOracleTextToIR(
      'Target creature an opponent controls blocks this turn if able.',
      'Mark for Death'
    );
    const forceStep = mark.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'force_block');
    expect(forceStep).toBeTruthy();
    expectNoTargetGaps(
      [forceStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-blocker', controller: 'p2', type_line: 'Creature — Human' }],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-src',
        selectorContext: { chosenObjectIds: ['bf-blocker'] },
      }
    );

    const genju = parseOracleTextToIR(
      'Enchanted Forest becomes a 4/4 green Spirit creature until end of turn.',
      'Genju of the Cedars'
    );
    const animateStep = genju.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'animate_permanent');
    expect(animateStep).toBeTruthy();
    expectNoTargetGaps(
      [animateStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-aura', controller: controllerId, type_line: 'Enchantment — Aura', attachedTo: 'bf-forest' },
          { id: 'bf-forest', controller: controllerId, type_line: 'Basic Land — Forest' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-aura' }
    );
  });
});
