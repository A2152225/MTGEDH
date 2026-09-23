import pathlib, re
p = pathlib.Path(r"D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorConditionalStepSupportExtended.ts")
text = p.read_text(encoding="utf-8", errors="replace")
print("SIZE", len(text))
for m in re.finditer(r"^(export )?function (\w+)|from ['\"]([^'\"]+)['\"]", text, re.M):
    print(m.group(0)[:120])
print("---CONTROL---")
for i, line in enumerate(text.splitlines(), 1):
    if re.search(r"control|Army|token|batch|tryEvaluate", line, re.I):
        print(f"{i}:{line.strip()[:200]}")
