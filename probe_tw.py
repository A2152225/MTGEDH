from pathlib import Path
hits=[]
for root in [Path(r'D:/Git/MTGEDH/rules-engine/src'), Path(r'D:/Git/MTGEDH/server/src')]:
  for p in root.rglob('*.ts'):
    if 'node_modules' in str(p) or '\\dist\\' in str(p): continue
    text=p.read_text(encoding='utf-8',errors='replace')
    if 'teamworkWasPaid' not in text: continue
    for i,line in enumerate(text.splitlines(),1):
      if 'teamworkWasPaid' in line:
        hits.append(f'{p.relative_to(r"D:/Git/MTGEDH")}:{i}|{line.strip()[:150]}')
Path(r'D:/Git/MTGEDH/probe_tw_hits.txt').write_text('\n'.join(hits),encoding='utf-8')
print(len(hits))
for h in hits[:50]:
  print(h)
