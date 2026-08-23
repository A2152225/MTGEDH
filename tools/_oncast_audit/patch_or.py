from pathlib import Path
path = Path(r"D:\Git\MTGEDH\server\src\socket\resolution.ts")
text = path.read_bytes().decode("cp1252")

helper = '''
function matchesRequiredTypeWords(typeLineRaw: string, requiredWords: readonly any[]): boolean {
  const typeLine = String(typeLineRaw || '').toLowerCase();
  const words = (requiredWords || [])
    .map((typeWord) => String(typeWord || '').trim().toLowerCase())
    .filter(Boolean);
  if (words.length === 0) return true;
  // "Angel or Human" is OR of groups; groups themselves are AND of words.
  if (words.includes('or')) {
    const groups: string[][] = [[]];
    for (const word of words) {
      if (word === 'or') groups.push([]);
      else groups[groups.length - 1].push(word);
    }
    return groups
      .filter((group) => group.length > 0)
      .some((group) => group.every((word) => typeLine.includes(word)));
  }
  return words.every((word) => typeLine.includes(word));
}
'''

# Find a good insertion point near the first usage - look for function that contains first usage
idx = text.find("if (Array.isArray(metadata.targetFilterRequiredTypeWords) && metadata.targetFilterRequiredTypeWords.length > 0)")
print("first usage idx", idx)
# Find nearby function start
print(repr(text[idx-500:idx+200][:400]))

old1 = """  if (Array.isArray(metadata.targetFilterRequiredTypeWords) && metadata.targetFilterRequiredTypeWords.length > 0) {
    const matchesAllRequiredWords = metadata.targetFilterRequiredTypeWords.every((typeWord) => typeLine.includes(String(typeWord || '').toLowerCase()));
    if (!matchesAllRequiredWords) {
      return false;
    }
  }"""
old1_crlf = old1.replace("\n", "\r\n")
new1 = """  if (Array.isArray(metadata.targetFilterRequiredTypeWords) && metadata.targetFilterRequiredTypeWords.length > 0) {
    if (!matchesRequiredTypeWords(typeLine, metadata.targetFilterRequiredTypeWords)) {
      return false;
    }
  }"""
new1_crlf = new1.replace("\n", "\r\n")

count = text.count(old1_crlf)
print("old1 count", count)
if count < 1:
    # try without exact whitespace
    import re
    m = re.search(r"metadata\.targetFilterRequiredTypeWords\.every\(\(typeWord\) => typeLine\.includes", text)
    print("regex found", bool(m), m.start() if m else None)
    raise SystemExit("old1 not found")

# Also fix the other every() site around 3224
old2 = """&& !(targetReqs as any).targetFilterRequiredTypeWords.every((word: any) => typeLine.includes(String(word || '').toLowerCase())))"""
# We'll handle after

text2 = text.replace(old1_crlf, new1_crlf)

# Insert helper before first function that uses it - find matchesTriggeredGraveyardTargetForExert
anchor = "function matchesTriggeredGraveyardTargetForExert"
ai = text2.find(anchor)
print("anchor", ai)
if ai < 0:
    raise SystemExit("anchor not found")
helper_crlf = helper.replace("\n", "\r\n")
if "function matchesRequiredTypeWords" not in text2:
    text2 = text2[:ai] + helper_crlf + "\r\n" + text2[ai:]

# Fix site 3224
old2 = "!(targetReqs as any).targetFilterRequiredTypeWords.every((word: any) => typeLine.includes(String(word || '').toLowerCase()))"
new2 = "!matchesRequiredTypeWords(typeLine, (targetReqs as any).targetFilterRequiredTypeWords)"
if old2 not in text2:
    print("WARNING old2 not found")
else:
    text2 = text2.replace(old2, new2)
    print("patched site 3224")

path.write_bytes(text2.encode("cp1252"))
print("done resolution patch, required helper present", "function matchesRequiredTypeWords" in text2)
print("remaining every typeWord", text2.count("targetFilterRequiredTypeWords.every"))
