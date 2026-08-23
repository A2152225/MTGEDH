from pathlib import Path

# Add evaluateUnlessSacrificesStep after evaluateUnlessDiscardsStep
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorPlayerStepHandlers.ts')
text = p.read_text(encoding='utf-8')

# Find end of evaluateUnlessDiscardsStep - right before evaluateUnlessPaysManaStep
marker = "export function evaluateUnlessPaysManaStep("
idx = text.find(marker)
if idx < 0:
    raise SystemExit('evaluateUnlessPaysManaStep missing')

# Check if UnlessDiscardsResult type exists nearby to mirror
type_idx = text.find('export type UnlessDiscardsResult')
print('type idx', type_idx)
# find UnlessPaysManaResult or UnlessDiscardsResult definition
import re
for m in re.finditer(r'export type Unless\w+Result', text):
    print(m.group(), 'at', m.start())
