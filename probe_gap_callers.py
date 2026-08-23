from pathlib import Path
# callers of repairGapClosureAbilitySteps across repo (excluding node_modules/dist)
for root in [Path(r'D:/Git/MTGEDH/rules-engine'), Path(r'D:/Git/MTGEDH/server/src')]:
  for p in root.rglob('*.ts'):
    if 'node_modules' in str(p) or '\\dist\\' in str(p): continue
    text = p.read_text(encoding='utf-8', errors='replace')
    if 'repairGapClosureAbilitySteps' in text:
      for i,line in enumerate(text.splitlines(),1):
        if 'repairGapClosureAbilitySteps' in line:
          print(f'{p.relative_to(r"D:/Git/MTGEDH")}:{i}:{line.strip()[:160]}')
