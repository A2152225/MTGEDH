from pathlib import Path
path = Path(r"D:\Git\MTGEDH\server\tests\on-cast-spell-trigger.unit.test.ts")
# Keep existing tests and append new coverage. Read with utf-8.
try:
    text = path.read_text(encoding="utf-8")
except UnicodeDecodeError:
    text = path.read_bytes().decode("latin-1")

# Update imports
old_imp = "import { resolveOnCastSpellTriggerDescription } from '../src/state/modules/onCastSpellTriggerUtils.js';"
new_imp = """import {
  resolveOnCastSpellTriggerDescription,
  resolveOnCastSpellTriggerDescriptions,
} from '../src/state/modules/onCastSpellTriggerUtils.js';
import { extractSelfCastEffectClauses } from '../../rules-engine/src/cards/castTriggers.js';
import { inferTriggeredAbilityTargetMetadata } from '../src/state/modules/inferTriggeredAbilityTargetMetadata.js';"""
if old_imp not in text:
    raise SystemExit("import missing")
text = text.replace(old_imp, new_imp, 1)

appendix = r'''

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
  });
});
'''

if "on-cast extraction preserves multi-sentence" not in text:
    text = text.rstrip() + "\n" + appendix
path.write_text(text, encoding="utf-8")
print("updated unit test file, lines", text.count("\n"))
