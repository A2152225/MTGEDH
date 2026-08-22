from pathlib import Path
p = Path(r"D:\Git\MTGEDH\server\src\socket\undo.ts")
raw = p.read_text(encoding="utf-8")
if "const recentStepMinTurn =" in raw:
    print("already declared")
else:
    anchor = "  const playerCount = getPlayerCountForRound(game);\n"
    insert = (
        "  const playerCount = getPlayerCountForRound(game);\n"
        "  const liveTurnNumber = typeof (game?.state as any)?.turnNumber === 'number' && (game.state as any).turnNumber > 0\n"
        "    ? Number((game.state as any).turnNumber)\n"
        "    : undefined;\n"
        "  // Keep step detail for the current round of seats; older than that -> phase rows only.\n"
        "  const recentStepMinTurn = typeof liveTurnNumber === 'number'\n"
        "    ? liveTurnNumber - playerCount + 1\n"
        "    : undefined;\n"
    )
    # only inside listUndoTurnPhaseTargets ? first playerCount after that function
    idx = raw.find("export function listUndoTurnPhaseTargets")
    if idx < 0:
        raise SystemExit("fn not found")
    pos = raw.find(anchor, idx)
    if pos < 0:
        raise SystemExit("anchor not found in fn")
    raw = raw[:pos] + insert + raw[pos + len(anchor):]
    p.write_bytes(raw.encode("utf-8"))
    print("declaration inserted")

t = p.read_text(encoding="utf-8")
for i,l in enumerate(t.splitlines()):
    if "liveTurnNumber" in l or "const recentStepMinTurn" in l or "const playerCount = getPlayerCountForRound" in l:
        if 700 <= i+1 <= 760:
            print(f"{i+1}|{l}")
