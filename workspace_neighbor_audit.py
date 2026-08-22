from pathlib import Path

def show_neighbors(path, predicates, radius=3):
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    print("====", path, "====")
    seen = set()
    for i, l in enumerate(lines):
        if any(p(l) for p in predicates):
            for j in range(max(0, i-radius), min(len(lines), i+radius+1)):
                if j in seen: continue
                seen.add(j)
                print(f"{j+1}|{lines[j]}")
            print("---")

# Status bar
show_neighbors(
    r"D:\Git\MTGEDH\client\src\components\GameStatusIndicator.tsx",
    [
        lambda l: "const turnNumber = Math.max" in l,
        lambda l: "const roundNumber =" in l,
        lambda l: "Turn + Round" in l,
        lambda l: "title={`Round" in l,
        lambda l: "{roundNumber}" == l.strip() or l.strip() == "{roundNumber}",
    ],
)

# permanentText
show_neighbors(
    r"D:\Git\MTGEDH\client\src\utils\permanentText.ts",
    [
        lambda l: "stripCreateTokenGrantedAbilities" in l,
        lambda l: "normalizeOracleFragmentForPermanentScan" in l,
    ],
)

# TableLayout strip
show_neighbors(
    r"D:\Git\MTGEDH\client\src\components\TableLayout.tsx",
    [
        lambda l: "stripCreateTokenGrantedAbilities" in l,
        lambda l: "function stripCreateTokenTypeReminders" in l,
    ],
)

# creature step utils - look for combatRoleTargetMatch
show_neighbors(
    r"D:\Git\MTGEDH\rules-engine\src\oracleIRExecutorCreatureStepUtils.ts",
    [
        lambda l: "combatRoleTargetMatch" in l,
        lambda l: "attacking(?: or blocking)" in l,
    ],
)

# undo.ts listUndoTurnPhaseTargets key bits
show_neighbors(
    r"D:\Git\MTGEDH\server\src\socket\undo.ts",
    [
        lambda l: "computeDisplayRound" in l,
        lambda l: "turnPlayerName" in l and ("?" in l or ":" in l or "label" in l),
        lambda l: "includeSteps" in l and "true" in l.lower(),
        lambda l: "summaryParts.filter" in l,
    ],
)

# backtick parity quick checks
for path in [
    r"D:\Git\MTGEDH\client\src\components\GameStatusIndicator.tsx",
    r"D:\Git\MTGEDH\client\src\utils\permanentText.ts",
    r"D:\Git\MTGEDH\server\src\socket\undo.ts",
    r"D:\Git\MTGEDH\rules-engine\src\oracleIRExecutorCreatureStepUtils.ts",
]:
    t = Path(path).read_text(encoding="utf-8")
    bt = t.count("`")
    print(path.split("MTGEDH\\")[-1], "backticks", bt, "even", bt % 2 == 0, "BOM", list(Path(path).read_bytes()[:3]))
