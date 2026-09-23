import pathlib
p = pathlib.Path(r"D:/Git/MTGEDH/rules-engine/src/oracleIRExecutorConditionalStepExtendedClauseHelpers.ts")
text = p.read_text(encoding="utf-8", errors="replace")
# extract objectHasType
idx = text.find("function objectHasType")
print(text[idx:idx+1200])
print("====")
# also check isToken helpers
for needle in ["isToken", "token:", ".token", "name ===", "perm?.name"]:
  pass
idx2 = text.find("function objectHasType")
# read isToken from permanent utils
