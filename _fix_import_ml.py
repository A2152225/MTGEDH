from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorMainLoop.ts')
text = p.read_text(encoding='utf-8')
# Fix broken nested import
bad = '''import {
import { evaluateAnyPlayerMayStep } from './oracleIRExecutorAnyPlayerMayStep';
  applyAddManaStep,'''
good = '''import { evaluateAnyPlayerMayStep } from './oracleIRExecutorAnyPlayerMayStep';
import {
  applyAddManaStep,'''
if bad not in text:
    # show around line 110
    lines = text.splitlines()
    for i in range(105, 120):
        print(f'{i+1}: {lines[i]}')
    raise SystemExit('bad import pattern not found')
text = text.replace(bad, good, 1)
p.write_text(text, encoding='utf-8')
print('fixed import')
