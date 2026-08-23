from pathlib import Path
# Find effectProgram source (not node_modules)
cands = list(Path(r'D:/Git/MTGEDH').rglob('effectProgram.ts'))
for c in cands:
  if 'node_modules' not in str(c) and 'dist' not in str(c):
    print(c)
