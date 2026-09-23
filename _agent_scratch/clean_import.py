from pathlib import Path
p = Path(r"D:/Git/MTGEDH/rules-engine/test/empowerJaceRuntime.unit.test.ts")
t = p.read_text(encoding="utf-8")
t = t.replace("import { lowerEmpowerJaceKeywordAbilities } from '../src/oracleIRParserPostprocessEmpowerJaceKeyword';\nimport { parseOracleTextToIR } from '../src/oracleIRParser';\n", "import { lowerEmpowerJaceKeywordAbilities } from '../src/oracleIRParserPostprocessEmpowerJaceKeyword';\n")
p.write_text(t, encoding="utf-8", newline="\n")
print("cleaned imports")
