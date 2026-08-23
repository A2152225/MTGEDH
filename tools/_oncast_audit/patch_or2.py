from pathlib import Path
path = Path(r"D:\Git\MTGEDH\server\src\socket\resolution.ts")
text = path.read_bytes().decode("latin-1")

old1 = "  if (Array.isArray(metadata.targetFilterRequiredTypeWords) && metadata.targetFilterRequiredTypeWords.length > 0) {\r\n    const matchesAllRequiredWords = metadata.targetFilterRequiredTypeWords.every((typeWord) => typeLine.includes(String(typeWord || '').toLowerCase()));\r\n    if (!matchesAllRequiredWords) {\r\n      return false;\r\n    }\r\n  }"
new1 = "  if (Array.isArray(metadata.targetFilterRequiredTypeWords) && metadata.targetFilterRequiredTypeWords.length > 0) {\r\n    if (!matchesRequiredTypeWords(typeLine, metadata.targetFilterRequiredTypeWords)) {\r\n      return false;\r\n    }\r\n  }"
count = text.count(old1)
print("old1 count", count)
if count < 1:
    raise SystemExit("old1 missing")

helper = (
"function matchesRequiredTypeWords(typeLineRaw: string, requiredWords: readonly any[]): boolean {\r\n"
"  const typeLine = String(typeLineRaw || '').toLowerCase();\r\n"
"  const words = (requiredWords || [])\r\n"
"    .map((typeWord) => String(typeWord || '').trim().toLowerCase())\r\n"
"    .filter(Boolean);\r\n"
"  if (words.length === 0) return true;\r\n"
"  // \"Angel or Human\" is OR of groups; groups themselves are AND of words.\r\n"
"  if (words.includes('or')) {\r\n"
"    const groups: string[][] = [[]];\r\n"
"    for (const word of words) {\r\n"
"      if (word === 'or') groups.push([]);\r\n"
"      else groups[groups.length - 1].push(word);\r\n"
"    }\r\n"
"    return groups\r\n"
"      .filter((group) => group.length > 0)\r\n"
"      .some((group) => group.every((word) => typeLine.includes(word)));\r\n"
"  }\r\n"
"  return words.every((word) => typeLine.includes(word));\r\n"
"}\r\n\r\n"
)

anchor = "function matchesTriggeredGraveyardTargetForExert"
ai = text.find(anchor)
print("anchor", ai)
if ai < 0:
    raise SystemExit("anchor missing")

text2 = text.replace(old1, new1)
if "function matchesRequiredTypeWords" not in text2:
    text2 = text2[:ai] + helper + text2[ai:]

old2 = "!(targetReqs as any).targetFilterRequiredTypeWords.every((word: any) => typeLine.includes(String(word || '').toLowerCase()))"
new2 = "!matchesRequiredTypeWords(typeLine, (targetReqs as any).targetFilterRequiredTypeWords)"
c2 = text2.count(old2)
print("old2 count", c2)
text2 = text2.replace(old2, new2)

path.write_bytes(text2.encode("latin-1"))
print("remaining every", text2.count("targetFilterRequiredTypeWords.every"))
print("helper present", "function matchesRequiredTypeWords" in text2)
