from pathlib import Path
p = Path(r"D:\Git\MTGEDH\server\src\socket\undo.ts")
raw = p.read_text(encoding="utf-8")

# Use ASCII-only separator in labels to avoid encoding/font issues entirely.
# " | " is clear and won't turn into "?".
replacements = [
    ("return parts.filter(Boolean).join(' ? ') || 'Earlier game state';",
     "return parts.filter(Boolean).join(' | ') || 'Earlier game state';"),
    ("return parts.filter(Boolean).join(' ? ') || 'Earlier game state';",
     "return parts.filter(Boolean).join(' | ') || 'Earlier game state';"),
    ("return parts.filter(Boolean).join(' \u00b7 ') || 'Earlier game state';",
     "return parts.filter(Boolean).join(' | ') || 'Earlier game state';"),
    ("summary: summaryParts.filter(Boolean).join(' ? ') || 'Current game state',",
     "summary: summaryParts.filter(Boolean).join(' | ') || 'Current game state',"),
    ("summary: summaryParts.filter(Boolean).join(' ? ') || 'Current game state',",
     "summary: summaryParts.filter(Boolean).join(' | ') || 'Current game state',"),
    ("summary: summaryParts.filter(Boolean).join(' \u00b7 ') || 'Current game state',",
     "summary: summaryParts.filter(Boolean).join(' | ') || 'Current game state',"),
]

# Also catch any join with a single weird char between spaces
import re
def fix_joins(text):
    text = re.sub(
        r"return parts\.filter\(Boolean\)\.join\(' [^']* '\) \|\| 'Earlier game state';",
        "return parts.filter(Boolean).join(' | ') || 'Earlier game state';",
        text,
        count=1,
    )
    text = re.sub(
        r"summary: summaryParts\.filter\(Boolean\)\.join\(' [^']* '\) \|\| 'Current game state'",
        "summary: summaryParts.filter(Boolean).join(' | ') || 'Current game state'",
        text,
        count=1,
    )
    return text

raw2 = fix_joins(raw)
for a,b in replacements:
    if a in raw2:
        raw2 = raw2.replace(a,b)
        print("replaced exact", a.encode("unicode_escape"))

# redundant Main / Main polish
old = """    if (stepNorm === 'main' || stepNorm === phaseNorm || phaseNorm.includes(stepNorm)) {
      parts.push(phaseLabel);
    } else {
      parts.push(`${phaseLabel} / ${stepLabel}`);
    }"""
new = """    const stepIsGenericMain = stepNorm === 'main' || stepNorm === 'main1' || stepNorm === 'main2';
    if (stepIsGenericMain || stepNorm === phaseNorm || phaseNorm.includes(stepNorm) || stepNorm.includes(phaseNorm)) {
      parts.push(phaseLabel);
    } else {
      parts.push(`${phaseLabel} / ${stepLabel}`);
    }"""
if old in raw2:
    raw2 = raw2.replace(old, new, 1)
    print("main redundancy fixed")

p.write_bytes(raw2.encode("utf-8"))
for i,l in enumerate(raw2.splitlines()):
    if "parts.filter(Boolean).join" in l or "summaryParts.filter(Boolean).join" in l:
        print(i+1, repr(l.strip()))
