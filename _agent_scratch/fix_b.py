from pathlib import Path
path = Path(r"D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorConditionalStepTypedCreatureClause.ts")
text = path.read_text(encoding="utf-8")
start = text.find("    // Multi-word Amass/Empower-style descriptors:")
end = text.find("  {\n    const thisIs = normalizedRaw.match", start)
if start < 0 or end < 0:
  raise SystemExit(f"anchors missing {start} {end}")
replacement = '''    // Multi-word Amass/Empower-style descriptors:
    // "you don't control an Army creature"
    // "you don't control a Jace planeswalker token"
    const dontControlMulti = normalizedRaw.match(/^you don'?t control (?:an? )?(.+)$/);
    if (dontControlMulti) {
      const descriptor = String(dontControlMulti[1] || '').trim();
      const lowered = descriptor.toLowerCase();
      // Keep unrelated "you don't control the monarch/initiative/..." clauses out of this matcher.
      const looksLikeBattlefieldDescriptor =
        /\\btoken\\b/i.test(lowered)
        || /\\b(?:creature|planeswalker|artifact|enchantment|land|battle|vehicle|permanent)\\b/i.test(lowered)
        || /^[a-z][a-z'-]*$/i.test(descriptor);
      const isStatusClause =
        /^(?:the\\s+)?(?:monarch|initiative|city'?s blessing|ring-bearer)\\b/i.test(descriptor)
        || /^(?:more|fewer|as many)\\b/i.test(descriptor);
      if (descriptor && looksLikeBattlefieldDescriptor && !isStatusClause) {
        const battlefield = getProcessedBattlefield(nextState) as any[];
        const count = battlefield.filter((perm: any) => {
          if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
          return permanentMatchesNamedControlDescriptor(perm, descriptor);
        }).length;
        return count === 0;
      }
    }
  }

'''
# Use a normal string with doubled backslashes written carefully via chr or raw parts
replacement = (
"    // Multi-word Amass/Empower-style descriptors:\n"
'    // "you don\'t control an Army creature"\n'
'    // "you don\'t control a Jace planeswalker token"\n'
"    const dontControlMulti = normalizedRaw.match(/^you don'?t control (?:an? )?(.+)$/);\n"
"    if (dontControlMulti) {\n"
"      const descriptor = String(dontControlMulti[1] || '').trim();\n"
"      const lowered = descriptor.toLowerCase();\n"
'      // Keep unrelated "you don\'t control the monarch/initiative/..." clauses out of this matcher.\n'
"      const looksLikeBattlefieldDescriptor =\n"
"        /" + "\\btoken\\b" + "/i.test(lowered)\n"
"        || /" + "\\b(?:creature|planeswalker|artifact|enchantment|land|battle|vehicle|permanent)\\b" + "/i.test(lowered)\n"
"        || /^[a-z][a-z'-]*$/i.test(descriptor);\n"
"      const isStatusClause =\n"
"        /" + "^(?:the\\s+)?(?:monarch|initiative|city'?s blessing|ring-bearer)\\b" + "/i.test(descriptor)\n"
"        || /" + "^(?:more|fewer|as many)\\b" + "/i.test(descriptor);\n"
"      if (descriptor && looksLikeBattlefieldDescriptor && !isStatusClause) {\n"
"        const battlefield = getProcessedBattlefield(nextState) as any[];\n"
"        const count = battlefield.filter((perm: any) => {\n"
"          if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;\n"
"          return permanentMatchesNamedControlDescriptor(perm, descriptor);\n"
"        }).length;\n"
"        return count === 0;\n"
"      }\n"
"    }\n"
"  }\n"
"\n"
)
text2 = text[:start] + replacement + text[end:]
path.write_text(text2, encoding="utf-8", newline="\n")
# verify no backspace chars remain in that region
chunk = path.read_text(encoding="utf-8")[start:start+900]
print(repr(chunk))
print("has_backspace", "\x08" in chunk)
