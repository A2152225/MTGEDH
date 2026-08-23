from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorExecutionContext.ts')
text = p.read_text(encoding='utf-8')
old = """    ...(hintUnlessDiscardsChoice || baseUnlessDiscardsChoice
      ? { unlessDiscardsChoice: hintUnlessDiscardsChoice ?? baseUnlessDiscardsChoice }
      : {}),
  };"""
new = """    ...(hintUnlessDiscardsChoice || baseUnlessDiscardsChoice
      ? { unlessDiscardsChoice: hintUnlessDiscardsChoice ?? baseUnlessDiscardsChoice }
      : {}),
    ...(hintUnlessSacrificesChoice || baseUnlessSacrificesChoice
      ? { unlessSacrificesChoice: hintUnlessSacrificesChoice ?? baseUnlessSacrificesChoice }
      : {}),
  };"""
if old not in text:
    raise SystemExit('missing')
text = text.replace(old, new, 1)

# Top-level context fields - find unlessDiscardsChoice on the outer return
# Search for unlessDiscardsChoice: hintUnless
import re
matches=list(re.finditer(r'unlessDiscardsChoice:', text))
print('matches', len(matches))
for m in matches:
  print(repr(text[m.start()-60:m.end()+120]))
  print('---')

# Also add top-level if pattern like:
# unlessDiscardsChoice: hintUnlessDiscardsChoice ?? baseUnlessDiscardsChoice,
idx = text.find('unlessDiscardsChoice: hintUnlessDiscardsChoice')
print('toplevel idx', idx)

p.write_text(text, encoding='utf-8')
print('ok')
