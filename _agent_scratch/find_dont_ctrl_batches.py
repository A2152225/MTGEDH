import pathlib, re
root = pathlib.Path(r"D:/Git/MTGEDH/rules-engine/src")
for p in sorted(root.glob("oracleIRExecutorConditionalStepSupportBatch*.ts")) + [
    root/"oracleIRExecutorConditionalStepTypedCreatureClause.ts",
    root/"oracleIRExecutorConditionalStepExtendedClauseHelpers.ts",
    root/"oracleIRExecutorConditionalStepExtendedCommanderControl.ts",
]:
    text = p.read_text(encoding="utf-8", errors="replace")
    hits = []
    for i, line in enumerate(text.splitlines(), 1):
        if re.search(r"don.t control|do not control|countControlledMatching|you control (a|an|one)|Army|descriptor", line, re.I):
            hits.append(f"{i}:{line.strip()[:220]}")
    if hits:
        print("====", p.name, "====")
        for h in hits[:40]:
            print(h)
