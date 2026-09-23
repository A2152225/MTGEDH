import pathlib, re
p = pathlib.Path(r"D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorConditionalStepSupportHelpers.ts")
text = p.read_text(encoding="utf-8", errors="replace")
# find functions and any control-related blocks
for m in re.finditer(r"^(export )?function (\w+)|^const (\w+)\s*=", text, re.M):
    name = m.group(2) or m.group(3)
    line = text[:m.start()].count("\n")+1
    print(f"{line}:{name}")
print("---HITS---")
for i, line in enumerate(text.splitlines(), 1):
    low = line.lower()
    if any(k in low for k in ["you control", "dont control", "don't control", "control a", "control an", "army", "token you", "subtype", "type_line", "planeswalker"]):
        print(f"{i}:{line.strip()[:220]}")
