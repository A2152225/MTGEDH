from pathlib import Path
p = Path(r"D:\Git\MTGEDH\server\src\socket\undo.ts")
raw = p.read_text(encoding="utf-8")
old = 'const targets = listUndoTurnPhaseTargets(game, events, { includeSteps, limit: 40 });'
new = 'const targets = listUndoTurnPhaseTargets(game, events, { includeSteps, limit: 200 });'
if old not in raw:
    raise SystemExit('handler limit anchor missing')
raw = raw.replace(old, new, 1)
# also raise default in listUndoTurnPhaseTargets from 40 to 200 for consistency
old2 = 'const limit = Math.max(1, Math.min(200, Number(opts?.limit || 40)));'
new2 = 'const limit = Math.max(1, Math.min(200, Number(opts?.limit || 200)));'
if old2 in raw:
    raw = raw.replace(old2, new2, 1)
else:
    print('default limit anchor missing or already changed')
p.write_bytes(raw.encode('utf-8'))
print('undo limits updated')

# bump scroll area a bit so 200 is usable
gsi = Path(r"D:\Git\MTGEDH\client\src\components\GameStatusIndicator.tsx")
t = gsi.read_text(encoding='utf-8')
t2 = t.replace('maxHeight: 180,', 'maxHeight: 320,', 1)
if t2 == t:
    print('maxHeight not found or already changed')
else:
    gsi.write_bytes(t2.encode('utf-8'))
    print('UI maxHeight 180 -> 320')
