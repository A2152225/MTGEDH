from pathlib import Path
path = Path(r"D:\Git\MTGEDH\server\src\socket\interaction.ts")
text = path.read_text(encoding="utf-8")
old = """    const splitSecondLockActive = isSplitSecondLockActive(game.state);
    const battlefield = game.state?.battlefield || [];
    
    const permIndex = battlefield.findIndex((p: any) => p?.id === permanentId && p?.controller === pid);
    if (permIndex === -1) {
      socket.emit(\"error\", {
        code: \"PERMANENT_NOT_FOUND\",
        message: \"Permanent not found or not controlled by you\",
      });
      return;
    }
    
    const permanent = battlefield[permIndex];
"""
new = """    const splitSecondLockActive = isSplitSecondLockActive(game.state);
    const battlefield = game.state?.battlefield || [];

    // Emit may send group_* / *_virtual_N ids for TokenOptimization stacks.
    // Resolve to a real battlefield permanent before looking up / tapping.
    const resolvedPermanentId =
      resolveGroupedPermanentRef(game, pid as any, String(permanentId)) || String(permanentId);
    
    const permIndex = battlefield.findIndex((p: any) => p?.id === resolvedPermanentId && p?.controller === pid);
    if (permIndex === -1) {
      socket.emit(\"error\", {
        code: \"PERMANENT_NOT_FOUND\",
        message: \"Permanent not found or not controlled by you\",
      });
      return;
    }
    
    const permanent = battlefield[permIndex];
"""
if old not in text:
    raise SystemExit("activate lookup anchor not found")
text2 = text.replace(old, new, 1)
path.write_text(text2, encoding="utf-8")
print("ok")
