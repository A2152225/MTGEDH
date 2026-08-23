from pathlib import Path
import re
for p in Path(r'D:/Git/MTGEDH/rules-engine/src').glob('oracleIRExecutor*.ts'):
  text=p.read_text(encoding='utf-8',errors='replace')
  if re.search(r'function applySacrifice|case \'sacrifice\'', text):
    for i,line in enumerate(text.splitlines(),1):
      if re.search(r'applySacrifice|case \'sacrifice\'', line):
        print(f'{p.name}:{i}|{line.strip()[:140]}')
