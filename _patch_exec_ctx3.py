from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorExecutionContext.ts')
text = p.read_text(encoding='utf-8')

old = """      hintUnlessDiscardsChoice || baseUnlessDiscardsChoice
      ? { unlessDiscardsChoice: hintUnlessDiscardsChoice ?? baseUnlessDiscardsChoice }
      : {}),
  };"""
new = """      hintUnlessDiscardsChoice || baseUnlessDiscardsChoice
      ? { unlessDiscardsChoice: hintUnlessDiscardsChoice ?? baseUnlessDiscardsChoice }
      : {}),
    ...(hintUnlessSacrificesChoice || baseUnlessSacrificesChoice
      ? { unlessSacrificesChoice: hintUnlessSacrificesChoice ?? baseUnlessSacrificesChoice }
      : {}),
  };"""
if old not in text:
    raise SystemExit('merge block missing')
text = text.replace(old, new, 1)

# Also top-level fields on returned context - search for unlessDiscardsChoice on return
for token in ['unlessDiscardsChoice:', 'unlessPaysManaChoice:']:
  print(token, text.count(token))

# Look for top-level assignment like unlessDiscardsChoice: hintUnlessDiscardsChoice
import re
for m in re.finditer(r'unlessDiscardsChoice:', text):
  print(repr(text[m.start()-30:m.end()+100]))

p.write_text(text, encoding='utf-8')
print('merge ok')
