from pathlib import Path
path = Path(r"D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorBattlefieldArmySelection.ts")
text = path.read_text(encoding="utf-8")
old = '''function normalizeNamedControlSelectorText(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined,
): string | null {
  if (!target || target.kind !== 'raw') return null;
  const normalized = normalizeSelfReferenceText(String((target as any).text || ''));
  if (!normalized) return null;
  const match = normalized.match(/^(?:target |an |a )?(.+?) you control$/i);
  if (!match) return null;
  const descriptor = String(match[1] || '').trim();
  if (!descriptor) return null;
  // Avoid swallowing broad generic selectors handled elsewhere.
  if (/^(?:another )?(?:target )?(?:nonland )?permanents?$/i.test(descriptor)) return null;
  if (/^(?:another )?(?:target )?creatures?$/i.test(descriptor)) return null;
  if (/^(?:another )?(?:target )?artifacts?$/i.test(descriptor)) return null;
  if (/^(?:another )?(?:target )?enchantments?$/i.test(descriptor)) return null;
  if (/^(?:another )?(?:target )?lands?$/i.test(descriptor)) return null;
  if (/^(?:another )?(?:target )?planeswalkers?$/i.test(descriptor)) return null;
  // Require a named subtype/name and/or explicit token designation.
  const lowered = descriptor.toLowerCase();
  const hasToken = /\\btoken\\b/.test(lowered);
  const strippedTypes = CARD_TYPES.reduce(
    (acc, cardType) => acc.replace(new RegExp(`\\\\b${cardType}\\\\b`, 'gi'), ' '),
    lowered,
  )
    .replace(/^an?\\s+/, '')
    .replace(/\\btoken\\b/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
  if (!hasToken && !strippedTypes) return null;
  return descriptor;
}
'''
# Simpler: replace the whole function by unique start/end markers
start = text.find("function normalizeNamedControlSelectorText(")
end = text.find("export function normalizeArmyCreatureSelectorText(", start)
if start < 0 or end < 0:
  raise SystemExit(f"anchors {start} {end}")
replacement = (
"function normalizeNamedControlSelectorText(\n"
"  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined,\n"
"): string | null {\n"
"  if (!target || target.kind !== 'raw') return null;\n"
"  const normalized = normalizeSelfReferenceText(String((target as any).text || ''));\n"
"  if (!normalized) return null;\n"
"  const match = normalized.match(/^(?:target |an |a )?(.+?) you control$/i);\n"
"  if (!match) return null;\n"
"  const descriptor = String(match[1] || '').trim();\n"
"  if (!descriptor) return null;\n"
"\n"
"  const lowered = descriptor.toLowerCase();\n"
"  // Empower Jace / token phrases: \"Jace planeswalker token\"\n"
"  if (/\\btoken\\b/.test(lowered)) {\n"
"    const withoutToken = lowered.replace(/\\btoken\\b/g, ' ').replace(/\\s+/g, ' ').trim();\n"
"    if (!withoutToken) return null;\n"
"    return descriptor;\n"
"  }\n"
"\n"
"  // Named type phrases: \"Army creature\", \"Jace planeswalker\" (no bare plurals like \"Clues\").\n"
"  const typed = lowered.match(\n"
"    /^([a-z][a-z' -]*?)\\s+(creature|planeswalker|artifact|enchantment|land|battle|vehicle|permanent)s?$/i,\n"
"  );\n"
"  if (!typed) return null;\n"
"  const nameOrSubtype = String(typed[1] || '').trim();\n"
"  if (!nameOrSubtype) return null;\n"
"  if (/^(?:another|target|nonland|other|each|all|any)$/i.test(nameOrSubtype)) return null;\n"
"  return descriptor;\n"
"}\n"
"\n"
)
path.write_text(text[:start] + replacement + text[end:], encoding="utf-8", newline="\n")
print("updated normalizeNamedControlSelectorText")
print(path.read_text(encoding="utf-8")[start:start+900])
