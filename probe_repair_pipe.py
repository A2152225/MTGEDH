from pathlib import Path
import re
# Find where repairThatPlayerHandBottomThenDrawSteps is called / pipeline of repairs
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserPostprocess.ts')
text = p.read_text(encoding='utf-8', errors='replace')
lines = text.splitlines()
for i,line in enumerate(lines,1):
  if 'repairThatPlayerHandBottomThenDrawSteps' in line or 'repairMoveZoneSelectorSteps' in line or 'mapAbilitySteps' in line or 'repairChooseMode' in line or 'choose_mode' in line and 'repair' in line.lower():
    print(f'{i}|{line[:180]}')
# also find applyStepRepairs or similar pipeline near end of file / export function apply
print('==== pipeline candidates ====')
for i,line in enumerate(lines,1):
  if re.search(r'function (apply|run|postprocess|finalize).*Step|repair.*Abilit|export function postprocess', line, re.I):
    print(f'{i}|{line[:180]}')
