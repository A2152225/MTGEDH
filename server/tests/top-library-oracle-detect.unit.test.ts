import { describe, expect, it } from 'vitest';

import {
  canCastFromTop,
  canLookAtTopOfLibrary,
  canPlayLandsFromTop,
} from '../src/state/modules/game-state-effects.js';

// Quoted from mtg_data.db (is_token = 0), 2026-08-27, except Ulvenwald Channelers (featured-test oracle).
const FUTURE_SIGHT_ORACLE =
  'Play with the top card of your library revealed.\nYou may play lands and cast spells from the top of your library.';
const MYSTIC_FORGE_ORACLE =
  'You may look at the top card of your library any time.\nYou may cast artifact spells and colorless spells from the top of your library.\n{T}, Pay 1 life: Exile the top card of your library.';
const MYSTIC_FORGE_LEGACY_ORACLE =
  "You may look at the top card of your library any time. You may cast the top card of your library if it's an artifact card or a colorless nonland card.";
const AUGUR_ORACLE =
  'You may look at the top card of your library any time.\nYou may play lands from the top of your library.\nCoven — As long as you control three or more creatures with different powers, you may cast creature spells from the top of your library.';
const ELSHA_ORACLE =
  'Prowess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)\nYou may look at the top card of your library any time.\nYou may cast noncreature spells from the top of your library. If you cast a spell this way, you may cast it as though it had flash.';
const SNOOP_ORACLE =
  'Play with the top card of your library revealed.\nYou may cast Goblin spells from the top of your library.\nAs long as the top card of your library is a Goblin card, this creature has all activated abilities of that card.';
const CRUCIBLE_ORACLE = 'You may play lands from your graveyard.';

function ctxFor(battlefield: any[]) {
  return { state: { battlefield, players: [{ id: 'p1' }, { id: 'p2' }], turnPlayer: 'p1' } } as any;
}

function perm(
  id: string,
  name: string,
  oracleText: string,
  extra?: { typeLine?: string; power?: string },
) {
  const { typeLine, ...rest } = extra ?? {};
  return {
    id,
    controller: 'p1',
    ...rest,
    card: {
      name,
      type_line: typeLine ?? 'Enchantment',
      oracle_text: oracleText,
      ...(rest.power ? { power: rest.power } : {}),
    },
  };
}

describe('top-of-library permissions are oracle-only (no TOP_OF_LIBRARY_CARDS table)', () => {
  it('grants look, land play, and unrestricted cast from Future Sight oracle on an anonymous permanent', () => {
    const ctx = ctxFor([perm('fx1', 'Fixture Future Top', FUTURE_SIGHT_ORACLE)]);
    expect(canLookAtTopOfLibrary(ctx, 'p1').canLook).toBe(true);
    expect(canPlayLandsFromTop(ctx, 'p1', { type_line: 'Basic Land — Forest' }).canPlay).toBe(true);
    expect(canCastFromTop(ctx, 'p1', { type_line: 'Instant', colors: ['U'] }).canCast).toBe(true);
    expect(canLookAtTopOfLibrary(ctx, 'p2').canLook).toBe(false);
  });

  it('does not grant top-library permissions from leftover names without matching oracle', () => {
    const ctx = ctxFor([perm('fx1', 'Future Sight', CRUCIBLE_ORACLE)]);
    expect(canLookAtTopOfLibrary(ctx, 'p1').canLook).toBe(false);
    expect(canPlayLandsFromTop(ctx, 'p1', { type_line: 'Basic Land — Forest' }).canPlay).toBe(false);
    expect(canCastFromTop(ctx, 'p1', { type_line: 'Instant', colors: ['U'] }).canCast).toBe(false);
  });

  it('allows artifact and colorless nonland spells from Mystic Forge oracle, not colored creatures', () => {
    const ctx = ctxFor([perm('fx1', 'Fixture Artifact Top', MYSTIC_FORGE_ORACLE)]);
    expect(canCastFromTop(ctx, 'p1', { type_line: 'Artifact', colors: [] }).canCast).toBe(true);
    expect(canCastFromTop(ctx, 'p1', { type_line: 'Legendary Planeswalker — Ugin', colors: [] }).canCast).toBe(true);
    expect(canCastFromTop(ctx, 'p1', { type_line: 'Creature — Elf Druid', colors: ['G'] }).canCast).toBe(false);
  });

  it('still honors the legacy Mystic Forge artifact-or-colorless-nonland template', () => {
    const ctx = ctxFor([perm('fx1', 'Fixture Legacy Forge', MYSTIC_FORGE_LEGACY_ORACLE)]);
    expect(canCastFromTop(ctx, 'p1', { type_line: 'Legendary Planeswalker — Ugin', colors: [] }).canCast).toBe(true);
    expect(canCastFromTop(ctx, 'p1', { type_line: 'Creature — Elf Druid', colors: ['G'] }).canCast).toBe(false);
  });

  it('gates Augur creature-from-top on coven', () => {
    const augur = perm('fx1', 'Fixture Coven Top', AUGUR_ORACLE, { typeLine: 'Creature — Human Druid', power: '2' });
    const ctx = ctxFor([augur]);
    expect(canPlayLandsFromTop(ctx, 'p1', { type_line: 'Basic Land — Forest' }).canPlay).toBe(true);
    expect(canCastFromTop(ctx, 'p1', { type_line: 'Creature — Elf Druid', colors: ['G'] }).canCast).toBe(false);

    ctx.state.battlefield.push(
      perm('c2', 'Fixture Power Two', '', { typeLine: 'Creature — Bear', power: '3' }),
      perm('c3', 'Fixture Power Three', '', { typeLine: 'Creature — Ox', power: '4' }),
    );
    expect(canCastFromTop(ctx, 'p1', { type_line: 'Creature — Elf Druid', colors: ['G'] }).canCast).toBe(true);
    expect(canCastFromTop(ctx, 'p1', { type_line: 'Instant', colors: ['U'] }).canCast).toBe(false);
  });

  it('grants flash for noncreature spells from Elsha oracle', () => {
    const ctx = ctxFor([perm('fx1', 'Fixture Flash Top', ELSHA_ORACLE, { typeLine: 'Creature — Djinn Monk' })]);
    const instant = canCastFromTop(ctx, 'p1', { type_line: 'Instant', colors: ['U'] });
    expect(instant.canCast).toBe(true);
    expect(instant.grantsFlash).toBe(true);
    expect(canCastFromTop(ctx, 'p1', { type_line: 'Creature — Bear', colors: ['G'] }).canCast).toBe(false);
  });

  it('allows Goblin spells from Snoop oracle, not other creatures', () => {
    const ctx = ctxFor([perm('fx1', 'Fixture Goblin Top', SNOOP_ORACLE, { typeLine: 'Creature — Goblin Rogue' })]);
    expect(canLookAtTopOfLibrary(ctx, 'p1').canLook).toBe(true);
    expect(canCastFromTop(ctx, 'p1', { type_line: 'Creature — Goblin Rogue', colors: ['R'] }).canCast).toBe(true);
    expect(canCastFromTop(ctx, 'p1', { type_line: 'Creature — Bear', colors: ['G'] }).canCast).toBe(false);
  });
});
