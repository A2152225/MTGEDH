from pathlib import Path
mod = Path(r'D:\Git\MTGEDH\server\src\state\modules\spellSelfTotalManaValueCostReduction.ts')
ga = Path(r'D:\Git\MTGEDH\server\src\socket\game-actions.ts')
lines = ga.read_text(encoding='utf-8').splitlines()
out = []
out.append('=== IMPORT ===')
for i,l in enumerate(lines):
  if 'spellSelfTotalManaValueCostReduction' in l:
    out.append('%d|%s'%(i+1,l))
out.append('=== BLOCK ===')
for i in range(3444, 3476):
  s=''.join(ch if ord(ch)<128 else '?' for ch in lines[i])
  out.append('%d|%s'%(i+1,s))
out.append('=== MODULE EXISTS ===')
out.append('size=%d lines=%d'%(mod.stat().st_size, len(mod.read_text(encoding='utf-8').splitlines())))
Path(r'D:\Git\MTGEDH\_tmp_reread_final.txt').write_text('\n'.join(out), encoding='utf-8')
print('ok')