from pathlib import Path
# How multi-clause "draws two cards, then discards" is split and parsed within modes
import re
root = Path(r'D:/Git/MTGEDH/rules-engine/src')
for name in ['oracleIRParser.ts','oracleIRParserClauseSplit.ts','oracleIRParserUtils.ts','oracleIRParserEffectText.ts']:
  p = root/name
  if not p.exists():
    continue
  text=p.read_text(encoding='utf-8',errors='replace')
  if 'then' in text and ('split' in text.lower() or 'clause' in text.lower()):
    print('FILE', name)
# find splitClauses or parseEffectText
for p in root.glob('oracleIRParser*.ts'):
  text=p.read_text(encoding='utf-8',errors='replace')
  for i,line in enumerate(text.splitlines(),1):
    if re.search(r'function (split|parse).*Clause|parseEffectSteps|splitOnThen|commaThen', line):
      print(f'{p.name}:{i}:{line[:160]}')
