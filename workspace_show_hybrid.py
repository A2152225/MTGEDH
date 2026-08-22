from pathlib import Path
lines = Path(r"D:\Git\MTGEDH\server\src\socket\undo.ts").read_text(encoding="utf-8").splitlines()
for i,l in enumerate(lines):
    if "recentStepMinTurn" in l or "useStepForEntry" in l:
        for j in range(max(0,i-3), min(len(lines), i+4)):
            print(f"{j+1}|{lines[j]}")
        print("---")
