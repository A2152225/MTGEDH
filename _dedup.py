from pathlib import Path
p=Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutionTypes.ts')
text=p.read_text(encoding='utf-8')
dup = """  /** Choice for unless-sacrifices wrappers when already known. */
  readonly unlessSacrificesChoice?: 'sacrifice' | 'decline';
  /** Choice for unless-sacrifices wrappers when already known. */
  readonly unlessSacrificesChoice?: 'sacrifice' | 'decline';"""
fix = """  /** Choice for unless-sacrifices wrappers when already known. */
  readonly unlessSacrificesChoice?: 'sacrifice' | 'decline';"""
if dup in text:
  text=text.replace(dup, fix, 1)
  p.write_text(text,encoding='utf-8')
  print('deduped')
else:
  print('no exact dup')
print('count', text.count('unlessSacrificesChoice'))
