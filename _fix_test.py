from pathlib import Path
import re
p = Path(r'D:/Git/MTGEDH/server/tests/on-cast-any-player-may-gain-control-cultist.unit.test.ts')
t = p.read_text(encoding='utf-8')
t2 = re.sub(
    r"const result = applyGainControlStep\(\s*\{\s*battlefield:",
    "const result = applyGainControlStep(\n      {\n        players: [{ id: 'p1' }, { id: 'p2' }],\n        battlefield:",
    t,
    count=1,
)
if t2 == t:
    raise SystemExit('replace failed')
p.write_text(t2, encoding='utf-8')
print('test fixed')
