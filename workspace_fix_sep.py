from pathlib import Path
p = Path(r"D:\Git\MTGEDH\server\src\socket\undo.ts")
raw = p.read_text(encoding="utf-8")
import re

# Fix buildTurnPhaseTargetLabel join to use \u00b7 escape (ASCII-safe source)
pat = re.compile(r"return parts\.filter\(Boolean\)\.join\((['\"])(.*?)\1\) \|\| 'Earlier game state';")
m = pat.search(raw)
print("before", m.group(0).encode("unicode_escape") if m else None)
if not m:
    raise SystemExit("join not found")
raw = pat.sub(
    "return parts.filter(Boolean).join(' \\u00b7 ') || 'Earlier game state';",
    raw,
    count=1,
)

# Also fix summaryParts join if similar
pat2 = re.compile(r"summary: summaryParts\.filter\(Boolean\)\.join\((['\"])(.*?)\1\) \|\| 'Current game state'")
m2 = pat2.search(raw)
print("summary before", m2.group(0).encode("unicode_escape") if m2 else None)
if m2:
    raw = pat2.sub(
        "summary: summaryParts.filter(Boolean).join(' \\u00b7 ') || 'Current game state'",
        raw,
        count=1,
    )

# Improve redundant "Precombat Main / Main" ? treat MAIN1/MAIN2 step as redundant with phase
# Find the stepNorm === 'main' check and broaden
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
if old in raw:
    raw = raw.replace(old, new, 1)
    print("redundant main label tightened")
else:
    print("main redundancy block not exact; leaving")

p.write_bytes(raw.encode("utf-8"))

# verify source contains escape not raw weird char
t = p.read_text(encoding="utf-8")
print("has escape join", "join(' \\u00b7 ')" in t or "join(' \\u00b7 ')" in t)
# Actually in file after write, the string is join(' \u00b7 ') with backslash-u
print("literal backslash-u", "\\u00b7" in t)
for i,l in enumerate(t.splitlines()):
    if "parts.filter(Boolean).join" in l or "summaryParts.filter(Boolean).join" in l:
        print(i+1, repr(l.strip()))
