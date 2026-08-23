from pathlib import Path
p=Path(r'D:/Git/MTGEDH/server/scripts/oncast-coverage-probe.ts')
text=p.read_text(encoding='utf-8-sig',errors='replace')
out=[]
for i,line in enumerate(text.splitlines(),1):
  if i<=150 or any(x in line.lower() for x in ['unknown','wired','grant_static','fully','irWire','is_ir']):
    out.append(f'{i}|{line[:180]}')
Path(r'D:/Git/MTGEDH/probe_coverage_probe.out.txt').write_text('\n'.join(out), encoding='utf-8')
print('wrote', len(out))
