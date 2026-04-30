import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';

function collectUnknowns(value: unknown): unknown[] {
  const unknowns: unknown[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ((node as any).kind === 'unknown') unknowns.push((node as any).raw ?? node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(value);
  return unknowns;
}

function collectSteps(value: unknown): any[] {
  const steps: any[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (typeof (node as any).kind === 'string') steps.push(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(value);
  return steps;
}

describe('Oracle IR gap batch 23 support', () => {
  it('normalizes modal labels and reminder wrappers around graveyard zone moves', () => {
    const palace = parseOracleTextToIR(
      '\u2022 Khans \u2014 At the beginning of your upkeep, return target creature card from your graveyard to your hand.',
      'Palace Siege'
    );
    const legendarySorcery = parseOracleTextToIR(
      '(You may cast a legendary sorcery only if you control a legendary creature or planeswalker.) Return all legendary permanent cards from your graveyard to the battlefield.',
      "Primevals' Glorious Rebirth"
    );
    const flashbackGrant = parseOracleTextToIR(
      '\u2022 Each instant and sorcery card in your graveyard gains flashback until end of turn.',
      'Will of the Jeskai'
    );

    expect(collectUnknowns([palace, legendarySorcery, flashbackGrant])).toEqual([]);
    expect(palace.abilities[0]).toMatchObject({ type: 'triggered', triggerCondition: 'the beginning of your upkeep' });
    expect(palace.abilities[0]?.steps[0]).toMatchObject({ kind: 'move_zone', to: 'hand' });
    expect(legendarySorcery.abilities[0]?.steps[0]).toMatchObject({ kind: 'move_zone', to: 'battlefield' });
    expect(flashbackGrant.abilities[0]?.steps[0]).toMatchObject({
      kind: 'grant_graveyard_permission',
      permission: 'cast',
      duration: 'this_turn',
    });
  });

  it('parses temporary dies-trigger grants with reminder tails and rider effects', () => {
    const roleToken = parseOracleTextToIR(
      'Until end of turn, target creature you control gains "When this creature dies, return it to the battlefield tapped under its owner\'s control, then create a Wicked Role token attached to it." (Enchanted creature gets +1/+1.',
      'Not Dead After All'
    );
    const treasureToken = parseOracleTextToIR(
      'Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield tapped under its owner\'s control and you create a Treasure token." (It\'s an artifact with "{T}, Sacrifice this token: Add one mana of any color.")',
      'Fake Your Own Death'
    );
    const suspect = parseOracleTextToIR(
      'Until end of turn, target creature gets +2/+0 and gains "When this creature dies, return it to the battlefield under its owner\'s control and suspect it." (A suspected creature has menace and can\'t block.)',
      'Presumed Dead'
    );

    expect(collectUnknowns([roleToken, treasureToken, suspect])).toEqual([]);
    expect(roleToken.abilities[0]?.steps[0]).toMatchObject({
      kind: 'grant_temporary_dies_trigger',
      target: { kind: 'raw', text: 'target creature you control' },
      effect: "return it to the battlefield tapped under its owner's control, then create a Wicked Role token attached to it.",
    });
    expect(treasureToken.abilities[0]?.steps.map(step => step.kind)).toEqual(['modify_pt', 'grant_temporary_dies_trigger']);
    expect((treasureToken.abilities[0]?.steps[1] as any).effect).toBe(
      "return it to the battlefield tapped under its owner's control and you create a Treasure token."
    );
    expect(suspect.abilities[0]?.steps.map(step => step.kind)).toEqual(['modify_pt', 'grant_temporary_dies_trigger']);
    expect((suspect.abilities[0]?.steps[1] as any).effect).toBe(
      "return it to the battlefield under its owner's control and suspect it."
    );
  });

  it('parses graveyard play/cast permission variants from the offset queue', () => {
    const will = parseOracleTextToIR(
      'Until end of turn, you may play lands and cast spells from your graveyard.',
      "Gaea's Will"
    );
    const kethis = parseOracleTextToIR(
      'Exile two legendary cards from your graveyard: Until end of turn, each legendary card in your graveyard gains "You may play this card from your graveyard."',
      'Kethis, the Hidden Hand'
    );
    const mayhem = parseOracleTextToIR(
      'Mayhem (You may play this card from your graveyard if you discarded it this turn.',
      'Oscorp Industries'
    );

    expect(collectUnknowns([will, kethis, mayhem])).toEqual([]);
    expect(will.abilities[0]?.steps).toMatchObject([
      { kind: 'grant_graveyard_permission', permission: 'play', what: { kind: 'raw', text: 'lands' }, duration: 'this_turn' },
      { kind: 'grant_graveyard_permission', permission: 'cast', what: { kind: 'raw', text: 'spells' }, duration: 'this_turn' },
    ]);
    expect(kethis.abilities[0]).toMatchObject({ type: 'activated' });
    expect(kethis.abilities[0]?.steps[0]).toMatchObject({
      kind: 'grant_graveyard_permission',
      permission: 'play',
      what: { kind: 'raw', text: 'legendary card' },
      duration: 'this_turn',
    });
    expect(mayhem.abilities[0]?.steps[0]).toMatchObject({
      kind: 'conditional',
      condition: { kind: 'as_long_as', raw: 'you discarded it this turn' },
      steps: [{ kind: 'grant_graveyard_permission', permission: 'play', what: { kind: 'raw', text: 'this card' } }],
    });
  });

  it('folds Vraska-style returned Treasure artifact rewrites into the battlefield move', () => {
    const text =
      'Deathtouch Whenever a nontoken creature an opponent controls dies, you may pay {1}. If you do, return that card to the battlefield tapped under your control. It\'s a Treasure artifact with "{T}, Sacrifice this artifact: Add one mana of any color," and it loses all other card types.';
    const ir = parseOracleTextToIR(text, 'Vraska, the Silencer');
    const move = collectSteps(ir.abilities).find(step => step.kind === 'move_zone');

    expect(collectUnknowns(ir.abilities)).toEqual([]);
    expect(move).toMatchObject({
      kind: 'move_zone',
      to: 'battlefield',
      entersTapped: true,
      battlefieldSetTypeLine: 'Artifact - Treasure',
      battlefieldSetOracleText: '{T}, Sacrifice this artifact: Add one mana of any color,',
    });
  });
});