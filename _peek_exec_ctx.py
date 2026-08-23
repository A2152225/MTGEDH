from pathlib import Path

# execution context builder
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorExecutionContext.ts')
text = p.read_text(encoding='utf-8')
old = """    hint?.unlessDiscardsChoice === 'discard' || hint?.unlessDiscardsChoice === 'decline'
      ? hint.unlessDiscardsChoice"""
# Show context
idx = text.find('unlessDiscardsChoice')
print(repr(text[idx-100:idx+400]))
