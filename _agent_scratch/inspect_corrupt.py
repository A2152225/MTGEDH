from pathlib import Path
path = Path(r"D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorConditionalStepTypedCreatureClause.ts")
text = path.read_text(encoding="utf-8")
# Fix corrupted word-boundary escapes (literal backspace U+0008)
bad = """      if (
        descriptor
        && !/^(?:the\\s+)?(?:monarch|initiative|city'?s blessing|ring-bearer)\u0008/i.test(descriptor)
        && !/^(?:more|fewer|as many)\u0008/i.test(descriptor)
        && (/\u0008token\u0008/i.test(lowered) || /\u0008(?:creature|planeswalker|artifact|enchantment|land|battle|vehicle|permanent)\u0008/i.test(lowered) || /^[a-z][a-z'-]*$/i.test(descriptor))
      ) {
"""
# Read actual bytes around the broken section
idx = text.find("Keep unrelated")
print(repr(text[idx:idx+450]))
