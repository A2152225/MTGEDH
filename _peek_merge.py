from pathlib import Path
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorExecutionContext.ts')
text = p.read_text(encoding='utf-8')
i = text.find('hintUnlessDiscardsChoice || baseUnlessDiscardsChoice')
print(repr(text[i-50:i+350]))
