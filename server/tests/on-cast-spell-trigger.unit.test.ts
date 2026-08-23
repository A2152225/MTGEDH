import { describe, expect, it } from 'vitest';

import { detectCastTrigger } from '../../rules-engine/src/cards/castTriggers.js';
import {
  isOnCastReflexiveCostGateEffect,
  resolveOnCastSpellTriggerDescription,
  resolveOnCastSpellTriggerDescriptions,
} from '../src/state/modules/onCastSpellTriggerUtils.js';
import {
  parseReflexiveExileToOwnersGraveyardWhenYouDo,
  parseReflexiveFixedPaymentWhenYouDo,
} from '../src/state/modules/reflexive-triggers.js';
import { extractSelfCastEffectClauses } from '../../rules-engine/src/cards/castTriggers.js';
import { inferTriggeredAbilityTargetMetadata } from '../src/state/modules/inferTriggeredAbilityTargetMetadata.js';

describe('resolveOnCastSpellTriggerDescription', () => {
  it('parses Kozilek draw-four from oracle text without Eldrazi name table', () => {
    const card = {
      name: 'Generic Eldrazi Titan',
      type_line: 'Legendary Creature — Eldrazi',
      oracle_text:
        'When you cast this spell, draw four cards.\n'
        + 'Annihilator 4 (Whenever this creature attacks, defending player sacrifices four permanents.)\n'
        + 'When Kozilek, Butcher of Truth is put into a graveyard from anywhere, its controller shuffles it into their library.',
    };

    const resolved = resolveOnCastSpellTriggerDescription(card);
    expect(resolved).toEqual({
      description: 'When you cast this spell, draw four cards',
      effect: 'draw four cards',
    });
  });

  it('parses Emrakul extra-turn shorthand from oracle text without name table', () => {
    const card = {
      name: 'Emrakul, the Aeons Torn',
      type_line: 'Legendary Creature — Eldrazi',
      oracle_text: "This spell can't be countered. Take an extra turn after this one.",
    };

    const resolved = resolveOnCastSpellTriggerDescription(card);
    expect(resolved?.description).toContain('extra turn');
    expect(resolved?.effect).toContain('extra turn');
  });

  it('parses standard Ulamog destroy-permanent on-cast from oracle text', () => {
    const card = {
      name: 'Ulamog, the Infinite Gyre',
      type_line: 'Legendary Creature — Eldrazi',
      oracle_text: 'When you cast this spell, destroy target permanent.',
    };

    const resolved = resolveOnCastSpellTriggerDescription(card);
    expect(resolved?.description).toMatch(/destroy target permanent/i);
  });
});

describe('detectCastTrigger Eldrazi patterns', () => {
  it('detects Emrakul extra turn without explicit when-you-cast clause', () => {
    const info = detectCastTrigger("This spell can't be countered. Take an extra turn after this one.");
    expect(info.hasCastTrigger).toBe(true);
    expect(info.triggerType).toBe('self_cast');
    expect(String(info.effect || '')).toMatch(/extra turn/i);
  });
});


describe('on-cast extraction preserves multi-sentence If-you-do clauses', () => {
  it('keeps Bearer of Silence pay-then-sacrifice clause intact', () => {
    const card = {
      name: 'Bearer of Silence',
      type_line: 'Creature ? Eldrazi',
      oracle_text:
        'When you cast this spell, you may pay {1}{C}. If you do, target opponent sacrifices a creature. ({C} represents colorless mana.)',
    };
    const resolved = resolveOnCastSpellTriggerDescription(card);
    expect(resolved?.description).toMatch(/you may pay/i);
    expect(resolved?.description).toMatch(/If you do, target opponent sacrifices a creature/i);
    expect(resolved?.description).not.toMatch(/represents colorless/i);
  });

  it('queues both Wastescape Battlemage on-cast clauses', () => {
    const card = {
      name: 'Wastescape Battlemage',
      type_line: 'Creature ? Eldrazi Wizard',
      oracle_text:
        'When you cast this spell, if it was kicked with its {G} kicker, exile target artifact or enchantment an opponent controls.\n'
        + "When you cast this spell, if it was kicked with its {1}{U} kicker, return target creature an opponent controls to its owner's hand.",
    };
    const all = resolveOnCastSpellTriggerDescriptions(card);
    expect(all).toHaveLength(2);
    expect(all[0].description).toMatch(/exile target artifact or enchantment/i);
    expect(all[1].description).toMatch(/return target creature/i);
  });

  it('extractSelfCastEffectClauses does not stop at the first period', () => {
    const clauses = extractSelfCastEffectClauses(
      'When you cast this spell, you may put a card an opponent owns from exile into that player\'s graveyard. If you do, you gain 5 life.',
    );
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toMatch(/If you do, you gain 5 life/i);
  });
});

describe('on-cast target metadata (Artisan-class shared gaps)', () => {
  it('infers GY return metadata for Artisan of Kozilek', () => {
    const metadata = inferTriggeredAbilityTargetMetadata(
      'When you cast this spell, you may return target creature card from your graveyard to the battlefield.',
    );
    expect(metadata.requiresTarget).toBe(true);
    expect(metadata.targetZone).toBe('graveyard');
    expect(metadata.targetDestination).toBe('battlefield');
    expect(metadata.targetGraveyardScope).toBe('your');
    expect(metadata.targetFilterTypes).toEqual(['creature']);
  });

  it('uses compound type for World Breaker exile', () => {
    const metadata = inferTriggeredAbilityTargetMetadata(
      'When you cast this spell, exile target artifact, enchantment, or land.',
    );
    expect(metadata.requiresTarget).toBe(true);
    expect(metadata.targetType).toBe('artifact, enchantment, or land');
  });

  it('sets up-to-four min/max for Elder Deep-Fiend', () => {
    const metadata = inferTriggeredAbilityTargetMetadata(
      'When you cast this spell, tap up to four target permanents.',
    );
    expect(metadata.requiresTarget).toBe(true);
    expect(metadata.targetType).toBe('permanent');
    expect(metadata.minTargets).toBe(0);
    expect(metadata.maxTargets).toBe(4);
  });

  it('sets up-to-one min/max for Ugin colored permanent exile', () => {
    const metadata = inferTriggeredAbilityTargetMetadata(
      "When you cast this spell, exile up to one target permanent that's one or more colors.",
    );
    expect(metadata.minTargets).toBe(0);
    expect(metadata.maxTargets).toBe(1);
    expect(metadata.targetType).toBe('permanent');
    expect(metadata.targetFilterRequiresOneOrMoreColors).toBe(true);
  });

  it('sets exactly-two min/max for Ulamog Ceaseless Hunger exile', () => {
    const metadata = inferTriggeredAbilityTargetMetadata(
      'When you cast this spell, exile two target permanents.',
    );
    expect(metadata.requiresTarget).toBe(true);
    expect(metadata.targetType).toBe('permanent');
    expect(metadata.minTargets).toBe(2);
    expect(metadata.maxTargets).toBe(2);
  });
});


describe('optional pay / processor If-you-do gates', () => {
  it('keeps Bearer of Silence effect bare for reflexive pay matching', () => {
    const card = {
      name: 'Bearer of Silence',
      type_line: 'Creature — Eldrazi',
      oracle_text:
        'When you cast this spell, you may pay {1}{C}. If you do, target opponent sacrifices a creature. ({C} represents colorless mana.)',
    };
    const resolved = resolveOnCastSpellTriggerDescription(card);
    expect(resolved?.description).toMatch(/^When you cast this spell,/i);
    expect(resolved?.effect).toMatch(/^you may pay \{1\}\{C\}/i);
    expect(resolved?.effect).toMatch(/If you do, target opponent sacrifices a creature/i);
    expect(isOnCastReflexiveCostGateEffect(resolved?.effect || '')).toBe(true);

    const parsed = parseReflexiveFixedPaymentWhenYouDo(resolved?.effect || '');
    expect(parsed?.manaCost).toBe('{1}{C}');
    expect(parsed?.followupText).toMatch(/target opponent sacrifices a creature/i);
  });

  it('parses Vile Redeemer pay-then-create-scions with If you do', () => {
    const effect =
      'you may pay {C}. If you do, create a 1/1 colorless Eldrazi Scion creature token for each nontoken creature that died under your control this turn.';
    const parsed = parseReflexiveFixedPaymentWhenYouDo(`When you cast this spell, ${effect}`);
    expect(parsed?.manaCost).toBe('{C}');
    expect(parsed?.followupText).toMatch(/create a 1\/1 colorless Eldrazi Scion/i);
  });

  it('parses Ruin Processor put-from-exile If-you-do followup', () => {
    const effect =
      "you may put a card an opponent owns from exile into that player's graveyard. If you do, you gain 5 life.";
    const parsed = parseReflexiveExileToOwnersGraveyardWhenYouDo(`When you cast this spell, ${effect}`);
    expect(parsed?.putCount).toBe(1);
    expect(parsed?.ownerScope).toBe('opponent');
    expect(parsed?.followupText).toMatch(/you gain 5 life/i);
    expect(isOnCastReflexiveCostGateEffect(effect)).toBe(true);
  });

  it('parses Blight Herder two-card processor If-you-do followup', () => {
    const effect =
      "you may put two cards your opponents own from exile into their owners' graveyards. If you do, create three 1/1 colorless Eldrazi Scion creature tokens.";
    const parsed = parseReflexiveExileToOwnersGraveyardWhenYouDo(effect);
    expect(parsed?.putCount).toBe(2);
    expect(parsed?.ownerScope).toBe('opponents');
    expect(parsed?.followupText).toMatch(/create three 1\/1 colorless Eldrazi Scion/i);
  });

  it('queues both Sowing Mycospawn on-cast clauses', () => {
    const card = {
      name: 'Sowing Mycospawn',
      type_line: 'Creature — Eldrazi Fungus',
      oracle_text:
        'Devoid\n'
        + 'When you cast this spell, search your library for a land card, put it onto the battlefield tapped, then shuffle.\n'
        + 'When you cast this spell, if it was kicked, exile target land.',
    };
    const all = resolveOnCastSpellTriggerDescriptions(card);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.some((entry) => /search your library for a land/i.test(entry.description))).toBe(true);
    expect(all.some((entry) => /exile target land/i.test(entry.description))).toBe(true);
  });
});
