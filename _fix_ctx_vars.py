from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorExecutionContext.ts')
text = p.read_text(encoding='utf-8')
print('hintUnlessSacrificesChoice def', 'const hintUnlessSacrificesChoice' in text)
print('baseUnlessSacrificesChoice def', 'const baseUnlessSacrificesChoice' in text)
# show around hintUnlessDiscards
i=text.find('hintUnlessDiscardsChoice')
print(repr(text[i-50:i+500]))
print('====')
i2=text.find('baseUnlessDiscardsChoice')
print(repr(text[i2-50:i2+400]))
