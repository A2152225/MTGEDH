import { describe, expect, it } from 'vitest';
import { createInitialGameState } from '../src/state/gameState';
import type { PlayerID } from '../../shared/src';
import { isInterveningIfSatisfied } from '../src/state/modules/triggers/intervening-if';

function addPlayer(g: any, id: PlayerID, name: string) {
  g.applyEvent({ type: 'join', playerId: id, name });
}

describe('Intervening-if evaluator (more templates)', () => {
  it('supports "all nonland permanents you control are white" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_all_nonland_white');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'At the beginning of your upkeep, if all nonland permanents you control are white, draw a card.';

    (g.state as any).battlefield = [
      { id: 'l1', controller: p1, card: { type_line: 'Land', colors: [] } },
      { id: 'c1', controller: p1, card: { type_line: 'Creature', colors: ['W'] } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).battlefield = [
      { id: 'c1', controller: p1, card: { type_line: 'Creature', colors: ['W'] } },
      { id: 'a1', controller: p1, card: { type_line: 'Artifact', colors: ['U'] } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    (g.state as any).battlefield = [
      { id: 'c1', controller: p1, card: { type_line: 'Creature', colors: ['W'] } },
      { id: 'u1', controller: p1, card: { type_line: 'Artifact' } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });

  it('supports "creatures you control have total toughness N or greater" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_total_toughness');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'At the beginning of your upkeep, if creatures you control have total toughness ten or greater, draw a card.';

    (g.state as any).battlefield = [
      { id: 'c1', controller: p1, card: { type_line: 'Creature' }, toughness: '4' },
      { id: 'c2', controller: p1, card: { type_line: 'Creature' }, toughness: '6' },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).battlefield = [
      { id: 'c1', controller: p1, card: { type_line: 'Creature' }, toughness: '3' },
      { id: 'c2', controller: p1, card: { type_line: 'Creature' }, toughness: '4' },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    // Conservative: missing toughness info prevents a definitive false.
    (g.state as any).battlefield = [
      { id: 'c1', controller: p1, card: { type_line: 'Creature' }, toughness: '4' },
      { id: 'cX', controller: p1, card: { type_line: 'Creature' } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });

  it('supports "it was blocked this turn" (positive evidence only)', () => {
    const g = createInitialGameState('t_intervening_if_blocked_this_turn');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'When this creature attacks, if it was blocked this turn, draw a card.';

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { blockedThisTurn: true })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { blockedBy: ['x'] })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, {})).toBe(null);
  });

  it('supports "if no creatures died this turn"', () => {
    const g = createInitialGameState('t_intervening_if_no_creatures_died');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'At the beginning of your upkeep, if no creatures died this turn, draw a card.';

    (g.state as any).creatureDiedThisTurn = false;
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).creatureDiedThisTurn = true;
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    delete (g.state as any).creatureDiedThisTurn;
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });

  it('supports "if no permanents left the battlefield this turn" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_no_permanents_left');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const desc = 'At the beginning of your upkeep, if no permanents left the battlefield this turn, draw a card.';

    (g.state as any).permanentLeftBattlefieldThisTurn = { [p1]: false, [p2]: false };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).permanentLeftBattlefieldThisTurn = { [p1]: false, [p2]: true };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    // Conservative: missing per-player entry => null
    (g.state as any).permanentLeftBattlefieldThisTurn = { [p1]: false };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });

  it('supports "if it was cast from your graveyard"', () => {
    const g = createInitialGameState('t_intervening_if_cast_from_graveyard');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'When this creature enters the battlefield, if it was cast from your graveyard, draw a card.';

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { castSourceZone: 'graveyard' })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { castSourceZone: 'hand' })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, {})).toBe(null);
  });

  it('supports "if this creature wasn\'t kicked" (best-effort)', () => {
    const g = createInitialGameState('t_intervening_if_not_kicked');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = "When this creature enters the battlefield, if this creature wasn't kicked, draw a card.";

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { wasKicked: false })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { wasKicked: true })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, {})).toBe(null);
  });

  it('supports "if there are no Reflection tokens on the battlefield"', () => {
    const g = createInitialGameState('t_intervening_if_no_reflection_tokens');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'At the beginning of your upkeep, if there are no Reflection tokens on the battlefield, draw a card.';

    (g.state as any).battlefield = [];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).battlefield = [
      { id: 't1', controller: p1, isToken: true, card: { name: 'Reflection', type_line: 'Token Creature' } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports "if this creature is named <Name>"', () => {
    const g = createInitialGameState('t_intervening_if_this_named');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'When this creature enters the battlefield, if this creature is named Awestruck Cygnet, draw a card.';

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { name: 'Awestruck Cygnet' } })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { name: 'Not It' } })).toBe(false);
  });

  it('supports "if it didn\'t have decayed" (keyword; conservative)', () => {
    const g = createInitialGameState('t_intervening_if_not_decayed');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = "When this creature dies, if it didn't have decayed, draw a card.";

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { oracle_text: 'Decayed' } })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { oracle_text: 'Flying' } })).toBe(true);

    // Conservative: no keyword info at all => null
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { oracle_text: '' } })).toBe(null);
  });

  it('supports "if no colored mana was spent to cast it" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_no_colored_mana');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'When you cast this spell, if no colored mana was spent to cast it, draw a card.';

    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, {
        manaSpentBreakdown: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
      })
    ).toBe(true);

    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, {
        manaSpentBreakdown: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
      })
    ).toBe(false);

    // Conservative: partial breakdown => unknown
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { manaSpentBreakdown: { colorless: 2 } })).toBe(null);

    // Fallback: use tracked manaColorsSpent when breakdown is missing/incomplete
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { manaColorsSpent: ['red'] })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { manaColorsSpent: [] })).toBe(true);
  });

  it('supports "if it was the second spell you cast this turn" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_second_spell');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'When you cast this spell, if it was the second spell you cast this turn, draw a card.';

    (g.state as any).spellsCastThisTurn = [{ casterId: p1, card: { type_line: 'Instant' } }, { casterId: p1, card: { type_line: 'Creature' } }];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { name: 'Any Spell' } })).toBe(true);

    (g.state as any).spellsCastThisTurn = [{ casterId: p1, card: { type_line: 'Instant' } }];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { name: 'Any Spell' } })).toBe(false);

    delete (g.state as any).spellsCastThisTurn;
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { name: 'Any Spell' } })).toBe(null);
  });

  it('supports "if a player was dealt N or more combat damage this turn" (best-effort)', () => {
    const g = createInitialGameState('t_intervening_if_player_dealt_combat_damage_n');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');

    const desc = 'At the beginning of your end step, if a player was dealt 6 or more combat damage this turn, draw a card.';

    // Tracker missing => unknown
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);

    (g.state as any).creaturesThatDealtDamageToPlayer = {
      [p2]: { c1: { creatureName: 'Attacker 1', totalDamage: 3 }, c2: { creatureName: 'Attacker 2', totalDamage: 3 } },
      [p3]: { c3: { creatureName: 'Attacker 3', totalDamage: 2 } },
    };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).creaturesThatDealtDamageToPlayer = {
      [p2]: { c1: { creatureName: 'Attacker 1', totalDamage: 2 }, c2: { creatureName: 'Attacker 2', totalDamage: 3 } },
      [p3]: {},
    };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports "if a player was dealt combat damage by a Zombie this turn" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_player_dealt_zombie_combat_damage');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const desc = 'At the beginning of your end step, if a player was dealt combat damage by a Zombie this turn, draw a card.';

    // Tracker missing => unknown
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);

    // Positive: zombie attacker still on battlefield
    (g.state as any).battlefield = [
      { id: 'z1', controller: p1, card: { type_line: 'Creature — Zombie' } },
    ];
    (g.state as any).creaturesThatDealtDamageToPlayer = {
      [p2]: { z1: { creatureName: 'Zombie Attacker', totalDamage: 1 } },
    };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    // Negative: only known non-zombie sources
    (g.state as any).battlefield = [
      { id: 'c1', controller: p1, card: { type_line: 'Creature — Human Soldier' } },
    ];
    (g.state as any).creaturesThatDealtDamageToPlayer = {
      [p2]: { c1: { creatureName: 'Not a Zombie', totalDamage: 1 } },
    };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    // Conservative: damage tracked but we can’t classify the source (left battlefield)
    (g.state as any).battlefield = [];
    (g.state as any).creaturesThatDealtDamageToPlayer = {
      [p2]: { gone: { creatureName: 'Unknown Source', totalDamage: 1 } },
    };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });

  it('supports "if it\'s attacking the player with the most life or tied for most life" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_attacking_most_life');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    const p3 = 'p3' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');
    addPlayer(g, p3, 'P3');

    const desc = "Whenever it attacks, if it's attacking the player with the most life or tied for most life, draw a card.";

    // Deterministic: p2 and p3 are tied for most life.
    (g.state as any).life = { [p1]: 20, [p2]: 30, [p3]: 30 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { id: 'src', card: { type_line: 'Creature' }, attacking: p2 })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { id: 'src', card: { type_line: 'Creature' }, attacking: p1 })).toBe(false);

    // Best-effort: if another player's life isn't present in state.life, we fall back to the player's stored life (typically 40).
    // With default life (40) for p3, p2 is not the "most life" target.
    (g.state as any).life = { [p1]: 20, [p2]: 30 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { id: 'src', card: { type_line: 'Creature' }, attacking: p2 })).toBe(false);

    // Not attacking => false
    (g.state as any).life = { [p1]: 20, [p2]: 30, [p3]: 30 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { id: 'src', card: { type_line: 'Creature' } })).toBe(false);
  });

  it('supports "if you control thirty or more artifacts"', () => {
    const g = createInitialGameState('t_intervening_if_thirty_artifacts');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'At the beginning of your upkeep, if you control thirty or more artifacts, draw a card.';

    (g.state as any).battlefield = Array.from({ length: 30 }, (_, i) => ({
      id: `a${i}`,
      controller: p1,
      card: { type_line: 'Artifact' },
    }));
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).battlefield = Array.from({ length: 29 }, (_, i) => ({
      id: `a${i}`,
      controller: p1,
      card: { type_line: 'Artifact' },
    }));
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports "if you control the artifact with the greatest mana value or tied for the greatest mana value" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_greatest_mv_artifact');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const desc =
      'At the beginning of your upkeep, if you control the artifact with the greatest mana value or tied for the greatest mana value, draw a card.';

    (g.state as any).battlefield = [
      { id: 'a1', controller: p1, card: { type_line: 'Artifact', cmc: 5 } },
      { id: 'a2', controller: p2, card: { type_line: 'Artifact', cmc: 4 } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).battlefield = [
      { id: 'a1', controller: p1, card: { type_line: 'Artifact', cmc: 5 } },
      { id: 'a2', controller: p2, card: { type_line: 'Artifact', cmc: 6 } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    // Conservative: unknown opponent artifact mana value => null
    (g.state as any).battlefield = [
      { id: 'a1', controller: p1, card: { type_line: 'Artifact', cmc: 5 } },
      { id: 'aU', controller: p2, card: { type_line: 'Artifact' } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);

    // If all unknown artifacts are controlled by you and you already control a known max, we can still say true.
    (g.state as any).battlefield = [
      { id: 'a1', controller: p1, card: { type_line: 'Artifact', cmc: 5 } },
      { id: 'aU', controller: p1, card: { type_line: 'Artifact' } },
      { id: 'a2', controller: p2, card: { type_line: 'Artifact', cmc: 4 } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);
  });

  it('supports "if you cast it and there are twenty or more creature cards with mana value 3 or less among cards in your graveyard" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_inquisitor_captain');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc =
      'When this creature enters the battlefield, if you cast it and there are twenty or more creature cards with mana value 3 or less among cards in your graveyard, you gain 1 life.';

    (g.state as any).zones = {
      [p1]: {
        graveyard: Array.from({ length: 20 }, (_, i) => ({ id: `g${i}`, type_line: 'Creature', cmc: 3 })),
      },
    };

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { enteredFromCast: true })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { enteredFromCast: false })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, {})).toBe(null);

    // Count fails definitively even if cast is unknown
    (g.state as any).zones = {
      [p1]: {
        graveyard: Array.from({ length: 19 }, (_, i) => ({ id: `g${i}`, type_line: 'Creature', cmc: 3 })),
      },
    };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, {})).toBe(false);
  });

  it('supports "if you cast it from your hand and there are five or more other creatures on the battlefield" (Deathbringer Regent style)', () => {
    const g = createInitialGameState('t_intervening_if_deathbringer_regent');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc =
      'When this creature enters the battlefield, if you cast it from your hand and there are five or more other creatures on the battlefield, destroy all other creatures.';

    (g.state as any).battlefield = [
      { id: 'src', controller: p1, card: { type_line: 'Creature' } },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, controller: p1, card: { type_line: 'Creature' } })),
    ];
    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, { id: 'src', card: { type_line: 'Creature' }, castFromHand: true })
    ).toBe(true);
    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, { id: 'src', card: { type_line: 'Creature' }, castFromHand: false })
    ).toBe(false);

    (g.state as any).battlefield = [
      { id: 'src', controller: p1, card: { type_line: 'Creature' } },
      ...Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, controller: p1, card: { type_line: 'Creature' } })),
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { id: 'src', card: { type_line: 'Creature' }, castFromHand: true })).toBe(
      false
    );

    // Count true but cast-from-hand unknown => null
    (g.state as any).battlefield = [
      { id: 'src', controller: p1, card: { type_line: 'Creature' } },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, controller: p1, card: { type_line: 'Creature' } })),
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { id: 'src', card: { type_line: 'Creature' } })).toBe(null);
  });

  it('supports "if evidence was collected" (best-effort via evidenceCollectedThisTurn)', () => {
    const g = createInitialGameState('t_intervening_if_evidence_collected');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'At the beginning of your upkeep, if evidence was collected, draw a card.';

    (g.state as any).evidenceCollectedThisTurn = { [p1]: true };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).evidenceCollectedThisTurn = { [p1]: false };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    delete (g.state as any).evidenceCollectedThisTurn;
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });

  it('supports "if it was unearthed" (best-effort via wasUnearthed)', () => {
    const g = createInitialGameState('t_intervening_if_unearthed');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'When this creature enters the battlefield, if it was unearthed, draw a card.';

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { wasUnearthed: true })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { wasUnearthed: false })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, {})).toBe(null);
  });

  it('supports "if it dealt combat damage to a player this turn" (best-effort via creaturesThatDealtDamageToPlayer)', () => {
    const g = createInitialGameState('t_intervening_if_dealt_combat_damage_to_player');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    const source = { id: 'src_1', controller: p1, card: { type_line: 'Creature' } };
    const desc = 'When this creature attacks, if it dealt combat damage to a player this turn, draw a card.';

    // Missing tracker => conservative unknown.
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, source)).toBe(null);

    (g.state as any).creaturesThatDealtDamageToPlayer = { [p2]: { src_1: true } };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, source)).toBe(true);

    (g.state as any).creaturesThatDealtDamageToPlayer = { [p2]: {} };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, source)).toBe(false);
  });

  it('supports "if it/this creature was attacking or blocking alone" (best-effort)', () => {
    const g = createInitialGameState('t_intervening_if_attacking_or_blocking_alone');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'Whenever this creature attacks, if it was attacking or blocking alone, draw a card.';

    const source: any = { id: 'src_1', controller: p1, card: { type_line: 'Creature' }, attacking: 'p2' };
    (g.state as any).battlefield = [source];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, source)).toBe(true);

    // Another attacker => false
    (g.state as any).battlefield = [
      source,
      { id: 'c2', controller: p1, card: { type_line: 'Creature' }, attacking: 'p2' },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, source)).toBe(false);
  });

  it('supports "if a Pirate and a Vehicle attacked this combat" (best-effort)', () => {
    const g = createInitialGameState('t_intervening_if_pirate_and_vehicle_attacked');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'At the beginning of combat, if a Pirate and a Vehicle attacked this combat, draw a card.';

    // No attackers => false
    (g.state as any).battlefield = [];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    // Pirate only => false
    (g.state as any).battlefield = [
      { id: 'pir_1', controller: p1, card: { type_line: 'Creature — Pirate' }, attacking: 'p2' },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    // Pirate + Vehicle (as creature) => true
    (g.state as any).battlefield = [
      { id: 'pir_1', controller: p1, card: { type_line: 'Creature — Pirate' }, attacking: 'p2' },
      { id: 'veh_1', controller: p1, card: { type_line: 'Artifact Creature — Vehicle' }, attacking: 'p2' },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);
  });

  it('supports "if Kytheon and at least two other creatures attacked this combat" (best-effort)', () => {
    const g = createInitialGameState('t_intervening_if_kytheon_attacked_with_two_others');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'At the beginning of combat, if Kytheon and at least two other creatures attacked this combat, draw a card.';

    (g.state as any).battlefield = [
      { id: 'k', controller: p1, card: { name: 'Kytheon, Hero of Akros', type_line: 'Creature — Human Soldier' }, attacking: 'p2' },
      { id: 'c1', controller: p1, card: { name: 'A', type_line: 'Creature' }, attacking: 'p2' },
      { id: 'c2', controller: p1, card: { name: 'B', type_line: 'Creature' }, attacking: 'p2' },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    // Only two attackers => false
    (g.state as any).battlefield = [
      { id: 'k', controller: p1, card: { name: 'Kytheon, Hero of Akros', type_line: 'Creature' }, attacking: 'p2' },
      { id: 'c1', controller: p1, card: { name: 'A', type_line: 'Creature' }, attacking: 'p2' },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports "if any of those creatures have power or toughness equal to the chosen number" (best-effort)', () => {
    const g = createInitialGameState('t_intervening_if_those_creatures_pt_equals_chosen');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const source: any = { id: 'src_1', controller: p1, card: { type_line: 'Enchantment' }, chosenNumber: 2 };
    const desc = 'Whenever this enchantment attacks, if any of those creatures have power or toughness equal to the chosen number, draw a card.';

    (g.state as any).battlefield = [
      { id: 'a1', controller: p1, card: { type_line: 'Creature' }, power: '2', toughness: '3' },
      { id: 'a2', controller: p1, card: { type_line: 'Creature' }, power: '4', toughness: '4' },
    ];

    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, source, {
        thoseCreatureIds: ['a1', 'a2'],
      } as any)
    ).toBe(true);

    // No matches => false
    source.chosenNumber = 1;
    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, source, {
        thoseCreatureIds: ['a1', 'a2'],
      } as any)
    ).toBe(false);
  });

  it('supports "if <Name> attacked this turn" (best-effort, assumes name refers to source)', () => {
    const g = createInitialGameState('t_intervening_if_named_attacked');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'At the beginning of your upkeep, if Taigam attacked this turn, draw a card.';

    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, {
        card: { name: 'Taigam, Ojutai Master', type_line: 'Creature — Human Monk' },
        attackedThisTurn: true,
      })
    ).toBe(true);

    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, {
        card: { name: 'Taigam, Ojutai Master', type_line: 'Creature — Human Monk' },
        attackedThisTurn: false,
      })
    ).toBe(false);

    // Missing attack info => null
    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, {
        card: { name: 'Taigam, Ojutai Master', type_line: 'Creature — Human Monk' },
      })
    ).toBe(null);
  });

  it('supports "if it\'s renowned" (alias)', () => {
    const g = createInitialGameState('t_intervening_if_its_renowned');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = "At the beginning of combat on your turn, if it's renowned, draw a card.";

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { renowned: true })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { renowned: false })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, {})).toBe(false);
  });

  it('supports "if it\'s modified" (alias)', () => {
    const g = createInitialGameState('t_intervening_if_its_modified');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = "At the beginning of your upkeep, if it's modified, draw a card.";

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { counters: { any: 1 } })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { counters: { any: 0 } })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, {})).toBe(false);
  });

  it('supports "if it\'s not suspected" (best-effort)', () => {
    const g = createInitialGameState('t_intervening_if_not_suspected');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = "At the beginning of your upkeep, if it's not suspected, draw a card.";

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { suspected: false })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { suspected: true })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, {})).toBe(null);
  });

  it('supports "if it\'s the first instant spell" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_first_instant');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = "When you cast an instant spell, if it's the first instant spell, draw a card.";

    (g.state as any).spellsCastThisTurn = [{ casterId: p1, card: { type_line: 'Instant' } }];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { type_line: 'Instant' } })).toBe(true);

    (g.state as any).spellsCastThisTurn = [
      { casterId: p1, card: { type_line: 'Instant' } },
      { casterId: p1, card: { type_line: 'Instant' } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { type_line: 'Instant' } })).toBe(false);

    // Conservative: unknown types prevent a definitive true
    (g.state as any).spellsCastThisTurn = [{ casterId: p1, card: { type_line: 'Instant' } }, { casterId: p1, card: {} }];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { type_line: 'Instant' } })).toBe(null);
  });

  it('supports "if you\'ve cast a spell with mana value N or greater this turn" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_mv_threshold');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = "At the beginning of your end step, if you've cast a spell with mana value four or greater this turn, draw a card.";

    (g.state as any).spellsCastThisTurn = [{ casterId: p1, card: { type_line: 'Sorcery', manaValue: 4 } }];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).spellsCastThisTurn = [
      { casterId: p1, card: { type_line: 'Instant', manaValue: 3 } },
      { casterId: p1, card: { type_line: 'Creature', manaValue: 2 } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    (g.state as any).spellsCastThisTurn = [{ casterId: p1, card: { type_line: 'Sorcery' } }];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });

  it('supports "if you\'ve cast N or more instant and sorcery spells this turn" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_is_count');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = "At the beginning of your end step, if you've cast three or more instant and sorcery spells this turn, draw a card.";

    (g.state as any).spellsCastThisTurn = [
      { casterId: p1, card: { type_line: 'Instant' } },
      { casterId: p1, card: { type_line: 'Sorcery' } },
      { casterId: p1, card: { type_line: 'Instant' } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).spellsCastThisTurn = [
      { casterId: p1, card: { type_line: 'Instant' } },
      { casterId: p1, card: { type_line: 'Creature' } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    (g.state as any).spellsCastThisTurn = [{ casterId: p1, card: { type_line: 'Instant' } }, { casterId: p1, card: {} }];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });

  it('supports "if there are cards exiled with it/this enchantment" (best-effort)', () => {
    const g = createInitialGameState('t_intervening_if_cards_exiled_with');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc1 = 'At the beginning of your upkeep, if there are cards exiled with it, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), desc1, { exiledCardIds: ['c1'] })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc1, { exiledCardIds: [] })).toBe(false);

    const desc2 = 'At the beginning of your upkeep, if there are cards exiled with this enchantment, draw a card.';
    expect(isInterveningIfSatisfied(g as any, String(p1), desc2, { cardsExiledWith: ['c1', 'c2'] })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc2, { cardsExiledWith: [] })).toBe(false);
  });

  it('supports "if there are N or more cards exiled with this artifact" (best-effort, via zones)', () => {
    const g = createInitialGameState('t_intervening_if_exiled_with_artifact_count');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const source: any = { id: 'a1', controller: p1, card: { name: "River Song's Diary", type_line: 'Artifact' } };
    const desc = 'At the beginning of your upkeep, if there are four or more cards exiled with this artifact, draw a card.';

    (g.state as any).zones = {
      [p1]: {
        exile: [
          { id: 'e1', name: 'A', exiledWithSourceId: 'a1' },
          { id: 'e2', name: 'B', exiledWithSourceId: 'a1' },
          { id: 'e3', name: 'C', exiledWithSourceId: 'a1' },
        ],
      },
    };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, source)).toBe(null);

    (g.state as any).zones[p1].exile.push({ id: 'e4', name: 'D', exiledWithSourceId: 'a1' });
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, source)).toBe(true);
  });

  it('supports "if N or more cards have been exiled with this artifact" (best-effort, via zones)', () => {
    const g = createInitialGameState('t_intervening_if_exiled_with_artifact_have_been');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const source: any = { id: 'a1', controller: p1, card: { name: "Colfenor's Urn", type_line: 'Artifact' } };
    const desc = 'At the beginning of your upkeep, if three or more cards have been exiled with this artifact, draw a card.';

    (g.state as any).zones = {
      [p1]: {
        exile: [
          { id: 'e1', name: 'A', exiledWithSourceId: 'a1' },
          { id: 'e2', name: 'B', exiledWithSourceId: 'a1' },
        ],
      },
    };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, source)).toBe(null);

    (g.state as any).zones[p1].exile.push({ id: 'e3', name: 'C', exiledWithSourceId: 'a1' });
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, source)).toBe(true);
  });

  it('supports "if there are three or more cards exiled with The Mysterious Sphere" (best-effort)', () => {
    const g = createInitialGameState('t_intervening_if_mysterious_sphere_exile_count');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const source: any = { id: 'ms1', controller: p1, card: { name: 'The Mysterious Sphere', type_line: 'Artifact' } };
    const desc = 'At the beginning of your upkeep, if there are three or more cards exiled with The Mysterious Sphere, draw a card.';

    (g.state as any).zones = {
      [p1]: {
        exile: [
          { id: 'e1', name: 'A', exiledWithSourceId: 'ms1' },
          { id: 'e2', name: 'B', exiledWithSourceId: 'ms1' },
          { id: 'e3', name: 'C', exiledWithSourceId: 'ms1' },
        ],
      },
    };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, source)).toBe(true);

    // If the source isn't actually The Mysterious Sphere, we don't guess.
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { ...source, card: { name: 'Not The Sphere', type_line: 'Artifact' } })).toBe(null);
  });

  it('supports "if it has the same name as one of the cards exiled with this artifact" (best-effort)', () => {
    const g = createInitialGameState('t_intervening_if_same_name_as_exiled_with_artifact');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const source: any = { id: 'helix', controller: p1, card: { name: 'Spellweaver Helix', type_line: 'Artifact' } };
    const desc = 'When you cast a spell, if it has the same name as one of the cards exiled with this artifact, draw a card.';

    (g.state as any).zones = {
      [p1]: {
        exile: [{ id: 'x1', name: 'Lightning Bolt', exiledWithSourceId: 'helix' }],
      },
    };

    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, source, {
        stackItem: { card: { name: 'Lightning Bolt' } },
      } as any)
    ).toBe(true);

    expect(
      isInterveningIfSatisfied(g as any, String(p1), desc, source, {
        stackItem: { card: { name: 'Shock' } },
      } as any)
    ).toBe(false);

    // Missing spell name => conservative unknown
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, source, {} as any)).toBe(null);
  });

  it('supports "if enchanted permanent is a creature with the greatest power among creatures on the battlefield" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_enchanted_greatest_power');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const aura: any = { id: 'aura1', controller: p1, card: { type_line: 'Enchantment — Aura' }, attachedTo: 'c1' };
    const desc =
      'At the beginning of your upkeep, if enchanted permanent is a creature with the greatest power among creatures on the battlefield, draw a card.';

    (g.state as any).battlefield = [
      aura,
      { id: 'c1', controller: p1, card: { type_line: 'Creature' }, power: '5', toughness: '5' },
      { id: 'c2', controller: p1, card: { type_line: 'Creature' }, power: '4', toughness: '4' },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, aura)).toBe(true);

    // A creature with strictly greater power exists => false
    (g.state as any).battlefield = [
      aura,
      { id: 'c1', controller: p1, card: { type_line: 'Creature' }, power: '5', toughness: '5' },
      { id: 'c2', controller: p1, card: { type_line: 'Creature' }, power: '6', toughness: '6' },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, aura)).toBe(false);

    // Unknown creature power elsewhere => conservative null
    (g.state as any).battlefield = [
      aura,
      { id: 'c1', controller: p1, card: { type_line: 'Creature' }, power: '5', toughness: '5' },
      { id: 'cX', controller: p1, card: { type_line: 'Creature' } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, aura)).toBe(null);
  });

  it('supports "if N or more artifacts/creatures entered the battlefield under your control this turn" (best-effort)', () => {
    const g = createInitialGameState('t_intervening_if_n_or_more_entered_this_turn');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const dArtifacts3 = 'At the beginning of your end step, if three or more artifacts entered the battlefield under your control this turn, draw a card.';
    const dArtifacts2Short = 'At the beginning of your end step, if two or more artifacts entered under your control this turn, draw a card.';
    const dCreatures2 = 'At the beginning of your end step, if two or more creatures entered the battlefield under your control this turn, draw a card.';

    // Artifacts are tracked via a per-turn counter map when present.
    (g.state as any).artifactsEnteredBattlefieldThisTurnByController = { [p1]: 2 };
    expect(isInterveningIfSatisfied(g as any, String(p1), dArtifacts3)).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), dArtifacts2Short)).toBe(true);

    (g.state as any).artifactsEnteredBattlefieldThisTurnByController = { [p1]: 3 };
    expect(isInterveningIfSatisfied(g as any, String(p1), dArtifacts3)).toBe(true);

    // Creatures are also tracked via a per-turn counter map when present.
    (g.state as any).creaturesEnteredBattlefieldThisTurnByController = { [p1]: 2 };
    expect(isInterveningIfSatisfied(g as any, String(p1), dCreatures2)).toBe(true);
  });

  it('supports power/toughness threshold templates (best-effort, conservative)', () => {
    const g = createInitialGameState('t_intervening_if_pt_thresholds');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const dPowLe2 = 'When this creature attacks, if its power is 2 or less, draw a card.';
    const dPowGt0 = 'When this creature attacks, if its power is greater than 0, draw a card.';
    const dPowWas3 = 'When this creature attacks, if its power was three or greater, draw a card.';
    const dTouWasLt1 = 'When this creature attacks, if its toughness was less than 1, draw a card.';

    expect(isInterveningIfSatisfied(g as any, String(p1), dPowLe2, { id: 'c1', card: { type_line: 'Creature' }, power: '2' })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), dPowLe2, { id: 'c1', card: { type_line: 'Creature' }, power: '3' })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), dPowLe2, { id: 'c1', card: { type_line: 'Creature' } })).toBe(null);

    expect(isInterveningIfSatisfied(g as any, String(p1), dPowGt0, { id: 'c1', card: { type_line: 'Creature' }, power: '1' })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), dPowGt0, { id: 'c1', card: { type_line: 'Creature' }, power: '0' })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), dPowGt0, { id: 'c1', card: { type_line: 'Creature' } })).toBe(null);

    expect(isInterveningIfSatisfied(g as any, String(p1), dPowWas3, { id: 'c1', card: { type_line: 'Creature' }, power: '3' })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), dPowWas3, { id: 'c1', card: { type_line: 'Creature' }, power: '2' })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), dPowWas3, { id: 'c1', card: { type_line: 'Creature' } })).toBe(null);

    expect(isInterveningIfSatisfied(g as any, String(p1), dTouWasLt1, { id: 'c1', card: { type_line: 'Creature' }, toughness: '0' })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), dTouWasLt1, { id: 'c1', card: { type_line: 'Creature' }, toughness: '1' })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), dTouWasLt1, { id: 'c1', card: { type_line: 'Creature' } })).toBe(null);
  });

  it("supports Guardian Project-style name uniqueness (conservative)", () => {
    const g = createInitialGameState('t_intervening_if_name_uniqueness');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc =
      'Whenever a creature enters the battlefield under your control, if it does not have the same name as another creature you control or a creature card in your graveyard, draw a card.';

    const itCreature: any = { id: 'c1', controller: p1, card: { name: 'Alpha', type_line: 'Creature' } };

    (g.state as any).battlefield = [
      itCreature,
      { id: 'c2', controller: p1, card: { name: 'Beta', type_line: 'Creature' } },
    ];
    (g.state as any).zones = { [p1]: { graveyard: [] } };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, itCreature)).toBe(true);

    // Same name on battlefield => false
    (g.state as any).battlefield = [
      itCreature,
      { id: 'c3', controller: p1, card: { name: 'Alpha', type_line: 'Creature' } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, itCreature)).toBe(false);

    // Same name in graveyard => false
    (g.state as any).battlefield = [itCreature];
    (g.state as any).zones = { [p1]: { graveyard: [{ id: 'g1', name: 'Alpha', type_line: 'Creature' }] } };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, itCreature)).toBe(false);

    // Missing zones => conservative unknown
    delete (g.state as any).zones;
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, itCreature)).toBe(null);
  });

  it('supports "if it/he wasn\'t a/an <subtype>" (best-effort)', () => {
    const g = createInitialGameState('t_intervening_if_wasnt_subtype');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const dNotDemon = 'At the beginning of your upkeep, if it wasn\'t a Demon, draw a card.';
    const dNotSpirit = 'At the beginning of your upkeep, if he wasn\'t a Spirit, draw a card.';

    expect(isInterveningIfSatisfied(g as any, String(p1), dNotDemon, { id: 'c1', card: { type_line: 'Creature — Human' } })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), dNotDemon, { id: 'c1', card: { type_line: 'Creature — Demon' } })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), dNotDemon, { id: 'c1', card: {} })).toBe(null);

    expect(isInterveningIfSatisfied(g as any, String(p1), dNotSpirit, { id: 'c1', card: { type_line: 'Creature — Human' } })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), dNotSpirit, { id: 'c1', card: { type_line: 'Creature — Spirit' } })).toBe(false);
  });

  it('supports "if it\'s not a/an <subtype>" (best-effort)', () => {
    const g = createInitialGameState('t_intervening_if_its_not_subtype');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const dNotBrushwagg = 'At the beginning of your upkeep, if it\'s not a Brushwagg, draw a card.';
    const dNotSpirit = 'At the beginning of your upkeep, if it\'s not a Spirit, draw a card.';

    expect(isInterveningIfSatisfied(g as any, String(p1), dNotBrushwagg, { id: 'c1', card: { type_line: 'Creature — Human' } })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), dNotBrushwagg, { id: 'c1', card: { type_line: 'Creature — Brushwagg' } })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), dNotBrushwagg, { id: 'c1', card: {} })).toBe(null);

    expect(isInterveningIfSatisfied(g as any, String(p1), dNotSpirit, { id: 'c1', card: { type_line: 'Creature — Human' } })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), dNotSpirit, { id: 'c1', card: { type_line: 'Creature — Spirit' } })).toBe(false);
  });

  it('supports "if its mana value was N or greater" (best-effort via triggering stackItem card)', () => {
    const g = createInitialGameState('t_intervening_if_mv_was');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'Whenever you cast a spell, if its mana value was 1 or greater, draw a card.';

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, undefined, { stackItem: { card: { cmc: 0, type_line: 'Instant' } } })).toBe(false);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, undefined, { stackItem: { card: { cmc: 1, type_line: 'Instant' } } })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, undefined, { stackItem: { card: { type_line: 'Instant' } } })).toBe(null);
  });

  it('supports "if it shares a creature type with Plane-Merge Elf" (best-effort)', () => {
    const g = createInitialGameState('t_intervening_if_shares_type_with_named');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'Whenever a creature enters the battlefield under your control, if it shares a creature type with Plane-Merge Elf, draw a card.';
    const itCreature: any = { id: 'c1', controller: p1, card: { name: 'It', type_line: 'Creature — Elf Druid' } };

    (g.state as any).battlefield = [{ id: 'pm1', controller: p1, card: { name: 'Plane-Merge Elf', type_line: 'Creature — Elf Wizard' } }];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, itCreature)).toBe(true);

    const human: any = { id: 'c2', controller: p1, card: { name: 'It', type_line: 'Creature — Human' } };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, human)).toBe(false);

    // Missing Plane-Merge Elf => conservative unknown
    (g.state as any).battlefield = [itCreature];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, itCreature)).toBe(null);
  });

  it('supports "if N or more creatures died under your control this turn" (best-effort)', () => {
    const g = createInitialGameState('t_intervening_if_n_or_more_died_under_your_control');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'At the beginning of your end step, if two or more creatures died under your control this turn, draw a card.';

    (g.state as any).creaturesDiedThisTurnByController = { [p1]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    (g.state as any).creaturesDiedThisTurnByController = { [p1]: 2 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    // If we only know "a creature died" globally, can't conclude for n>=2
    delete (g.state as any).creaturesDiedThisTurnByController;
    (g.state as any).creatureDiedThisTurn = true;
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);

    (g.state as any).creatureDiedThisTurn = false;
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);
  });

  it('supports "if it\'s not that player\'s turn" (refs-based)', () => {
    const g = createInitialGameState('t_intervening_if_not_that_players_turn');
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;
    addPlayer(g, p1, 'P1');
    addPlayer(g, p2, 'P2');

    (g.state as any).activePlayer = p1;
    const desc = "At the beginning of each player's upkeep, if it's not that player's turn, draw a card.";

    expect(isInterveningIfSatisfied(g as any, String(p1), desc, {}, { thatPlayerId: p2 })).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, {}, { thatPlayerId: p1 })).toBe(false);
  });

  it('supports "if it wasn\'t the first land you played this turn"', () => {
    const g = createInitialGameState('t_intervening_if_not_first_land');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = "When you play a land, if it wasn't the first land you played this turn, draw a card.";

    (g.state as any).landsPlayedThisTurn = { [p1]: 1 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    (g.state as any).landsPlayedThisTurn = { [p1]: 2 };
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    delete (g.state as any).landsPlayedThisTurn;
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });

  it('supports "if it\'s not the first turn of the game"', () => {
    const g = createInitialGameState('t_intervening_if_not_first_turn');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = "At the beginning of your upkeep, if it's not the first turn of the game, draw a card.";

    (g.state as any).turnNumber = 1;
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    (g.state as any).turnNumber = 2;
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    delete (g.state as any).turnNumber;
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });

  it("supports \"if it's the second creature spell you cast this turn\" (conservative)", () => {
    const g = createInitialGameState('t_intervening_if_second_creature_spell');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = "When you cast this spell, if it's the second creature spell you cast this turn, draw a card.";

    (g.state as any).spellsCastThisTurn = [
      { casterId: p1, card: { type_line: 'Creature' } },
      { casterId: p1, card: { type_line: 'Instant' } },
      { casterId: p1, card: { type_line: 'Creature' } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { name: 'Any Creature' } })).toBe(true);

    (g.state as any).spellsCastThisTurn = [{ casterId: p1, card: { type_line: 'Creature' } }];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { name: 'Any Creature' } })).toBe(false);

    (g.state as any).spellsCastThisTurn = [
      { casterId: p1, card: { type_line: 'Creature' } },
      { casterId: p1, card: { } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc, { card: { name: 'Any Creature' } })).toBe(null);
  });

  it('supports "if Sarulf has one or more +1/+1 counters on it" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_sarulf_counters');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const desc = 'At the beginning of your upkeep, if Sarulf has one or more +1/+1 counters on it, draw a card.';

    (g.state as any).battlefield = [
      { id: 's1', controller: p1, card: { name: 'Sarulf, Realm Eater', type_line: 'Legendary Creature' }, counters: { '+1/+1': 1 } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(true);

    (g.state as any).battlefield = [
      { id: 's1', controller: p1, card: { name: 'Sarulf, Realm Eater', type_line: 'Legendary Creature' }, counters: { '+1/+1': 0 } },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(false);

    // Conservative: can't locate Sarulf
    (g.state as any).battlefield = [];
    expect(isInterveningIfSatisfied(g as any, String(p1), desc)).toBe(null);
  });

  it('supports "if Katara is tapped" and "if Kona is tapped" (conservative)', () => {
    const g = createInitialGameState('t_intervening_if_named_is_tapped');
    const p1 = 'p1' as PlayerID;
    addPlayer(g, p1, 'P1');

    const dKatara = 'At the beginning of your upkeep, if Katara is tapped, draw a card.';
    const dKona = 'At the beginning of your upkeep, if Kona is tapped, draw a card.';

    (g.state as any).battlefield = [
      { id: 'k1', controller: p1, card: { name: 'Katara, Bending Prodigy', type_line: 'Legendary Creature' }, tapped: true },
      { id: 'k2', controller: p1, card: { name: 'Kona, Rescue Beastie', type_line: 'Legendary Creature' }, tapped: false },
    ];
    expect(isInterveningIfSatisfied(g as any, String(p1), dKatara)).toBe(true);
    expect(isInterveningIfSatisfied(g as any, String(p1), dKona)).toBe(false);

    // Conservative: tapped state missing
    (g.state as any).battlefield = [{ id: 'k1', controller: p1, card: { name: 'Katara, Bending Prodigy' } }];
    expect(isInterveningIfSatisfied(g as any, String(p1), dKatara)).toBe(null);
  });
});
