from pathlib import Path
p = Path(r'D:/Git/MTGEDH/server/src/state/modules/cost-adjustments.ts')
text = p.read_text(encoding='utf-8')
if 'getActiveNextSpellCostReduction' not in text:
    # add import
    lines = text.splitlines(True)
    last_import = 0
    for i, line in enumerate(lines[:40]):
        if line.startswith('import '):
            last_import = i
    lines.insert(last_import + 1, "import { getActiveNextSpellCostReduction, consumeNextSpellCostReductionAfterCast } from './nextSpellCostReduction.js';\n")
    text = ''.join(lines)

    # In buildLiveSpellCostAdjustment, add the reduction
    # Find the function and a place to add genericReduction
    idx = text.find('export function buildLiveSpellCostAdjustment')
    print('buildLive at', idx)
    # Find return statement of that function - add before it
    # Simpler: find getCostAdjustmentForCard and patch
    fn = text[idx:idx+2500]
    print(fn[:800])
