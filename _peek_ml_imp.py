from pathlib import Path
p=Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorMainLoop.ts')
text=p.read_text(encoding='utf-8')
idx=text.find('evaluateUnlessSacrificesStep')
print('count', text.count('evaluateUnlessSacrificesStep'))
print(repr(text[max(0,idx-300):idx+80]))
# check evaluateUnlessDiscardsStep import
idx2=text.find('evaluateUnlessDiscardsStep')
print('discards import context:')
print(repr(text[max(0,idx2-200):idx2+80]))
