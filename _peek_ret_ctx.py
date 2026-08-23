from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorExecutionContext.ts')
text = p.read_text(encoding='utf-8')
# find return { of buildOracleIRExecutionContext
idx = text.find('unlessPaysManaChoice:')
print('count top-ish', text.count('unlessPaysManaChoice:'))
for token in ['unlessPaysManaChoice:', 'unlessPaysLifeChoice:', 'unlessDiscardsChoice:', 'unlessSacrificesChoice:']:
  print(token, text.count(token))
# show return object portion with unless
i = text.find('hintUnlessPaysManaChoice ??')
print(repr(text[i-200:i+500]))
