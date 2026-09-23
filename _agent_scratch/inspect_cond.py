import pathlib, re
root = pathlib.Path(r"D:/Git/MTGEDH/rules-engine/src")
# Find evaluateCondition / tryEvaluate / control check helpers used by conditional steps
for name in [
 "oracleIRExecutorConditionalStepSupport.ts",
 "oracleIRExecutorConditionalStepSupportHelpers.ts",
 "oracleIRExecutorConditionalStepSupportExtended.ts",
 "oracleIRExecutorMainLoopLateSteps.ts",
]:
    p = root / name
    if not p.exists():
        print("MISSING", name); continue
    text = p.read_text(encoding="utf-8", errors="replace")
    print("====", name, "size", len(text), "====")
    # print function names
    for m in re.finditer(r"^export function (\w+)", text, re.M):
        print(" fn", m.group(1), "at", text[:m.start()].count("\n")+1)
    for pat in ["you control", "don't control", "Army", "token", "planeswalker", "subtype", "controller"]:
        if pat.lower() in text.lower():
            print(" contains", pat)
