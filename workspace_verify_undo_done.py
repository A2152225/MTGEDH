from pathlib import Path
gsi = Path(r"D:\Git\MTGEDH\client\src\components\GameStatusIndicator.tsx").read_text(encoding="utf-8")
print("has_Undo_Scope_header", "Undo Scope" in gsi)
print("has_Return_to_Turn", "Return to Turn / Phase" in gsi)
print("has_Current_Step", "Current Step" in gsi)
print("has_Current_Phase", "Current Phase" in gsi)
print("has_Round_status", "Turn + Round" in gsi and "const roundNumber" in gsi)
print("title_line", any("title={`Round" in l for l in gsi.splitlines()))
print("mojibake", [m for m in ["??", "??", "??", "??"] if m in gsi])
print("hourglass", "\u23f3" in gsi)
app = Path(r"D:\Git\MTGEDH\client\src\App.tsx").read_text(encoding="utf-8")
print("App_includeSteps", "includeSteps: true" in app)
undo = Path(r"D:\Git\MTGEDH\server\src\socket\undo.ts").read_text(encoding="utf-8")
print("computeDisplayRound", "computeDisplayRound" in undo)
print("stepOrderRank", "stepOrderRank" in undo)
print("dedupe_keyish", "turnNumber|phase|step" in undo or "phaseKey" in undo or "dedup" in undo.lower() or "seenKeys" in undo or "unique" in undo.lower())
print("undo_mojibake", [m for m in ["??", "??", "??", "??"] if m in undo])
print("middle_dot_join", " ? " in undo)
# find includeSteps default
for i,l in enumerate(undo.splitlines()):
    if "includeSteps" in l and ("opts" in l or "true" in l or "false" in l or "===" in l):
        if "listUndoTurnPhaseTargets" in "".join(undo.splitlines()[max(0,i-15):i+1]) or i>500:
            if 600 <= i <= 900 or "opts?.includeSteps" in l:
                print(f"{i+1}:{l.strip()}")
