from pathlib import Path

path = Path(r"D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorConditionalStepTypedCreatureClause.ts")
text = path.read_text(encoding="utf-8")

# Add import for named descriptor matcher
old_import = """import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
"""
new_import = """import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';
import { permanentMatchesNamedControlDescriptor } from './oracleIRExecutorBattlefieldArmySelection';
"""
if old_import not in text:
  raise SystemExit("import anchor missing")
text = text.replace(old_import, new_import, 1)

old_block = """  {
    const dontControl = normalizedRaw.match(/^you don'?t control an? ([a-z][a-z'-]*)$/);
    const typeName = dontControl ? parseTypedNoun(String(dontControl[1] || '')) : null;
    if (typeName) return countControlledMatchingDescriptor(nextState, controllerId, typeName) === 0;
  }
"""

new_block = """  {
    // Single-word subtype/type: "you don't control a Faerie" / "you don't control an Army"
    const dontControl = normalizedRaw.match(/^you don'?t control an? ([a-z][a-z'-]*)$/);
    const typeName = dontControl ? parseTypedNoun(String(dontControl[1] || '')) : null;
    if (typeName) return countControlledMatchingDescriptor(nextState, controllerId, typeName) === 0;
  }

  {
    // Multi-word Amass/Empower-style descriptors:
    // "you don't control an Army creature"
    // "you don't control a Jace planeswalker token"
    const dontControlMulti = normalizedRaw.match(/^you don'?t control (?:an? )?(.+)$/);
    if (dontControlMulti) {
      const descriptor = String(dontControlMulti[1] || '').trim();
      const lowered = descriptor.toLowerCase();
      // Keep unrelated "you don't control the monarch/initiative/..." clauses out of this matcher.
      if (
        descriptor
        && !/^(?:the\s+)?(?:monarch|initiative|city'?s blessing|ring-bearer)\b/i.test(descriptor)
        && !/^(?:more|fewer|as many)\b/i.test(descriptor)
        && (/\btoken\b/i.test(lowered) || /\b(?:creature|planeswalker|artifact|enchantment|land|battle|vehicle|permanent)\b/i.test(lowered) || /^[a-z][a-z'-]*$/i.test(descriptor))
      ) {
        const battlefield = getProcessedBattlefield(nextState) as any[];
        const count = battlefield.filter((perm: any) => {
          if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
          return permanentMatchesNamedControlDescriptor(perm, descriptor);
        }).length;
        return count === 0;
      }
    }
  }
"""

if old_block not in text:
  raise SystemExit("dontControl block missing")
text = text.replace(old_block, new_block, 1)
path.write_text(text, encoding="utf-8", newline="\n")
print("patched typed creature clause", path.stat().st_size)

# verify neighbors
lines = path.read_text(encoding="utf-8").splitlines()
for i, l in enumerate(lines, 1):
  if 125 <= i <= 175:
    print(f"{i}:{l}")
