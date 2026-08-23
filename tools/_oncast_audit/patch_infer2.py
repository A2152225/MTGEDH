from pathlib import Path
path = Path(r"D:\Git\MTGEDH\server\src\state\modules\inferTriggeredAbilityTargetMetadata.ts")
text = path.read_bytes().decode("utf-8")

needle = "    else if (lower.includes('target artifact or enchantment')) targetType = 'artifact or enchantment';\r\n    else if (lower.includes('target noncreature artifact')) targetType = 'noncreature artifact';"
insert = "    else if (lower.includes('target artifact or enchantment')) targetType = 'artifact or enchantment';\r\n    else if (/target artifact, enchantment, or land\\b/.test(lower) || /target artifact, land, or enchantment\\b/.test(lower) || /target enchantment, artifact, or land\\b/.test(lower)) {\r\n      targetType = 'artifact, enchantment, or land';\r\n    }\r\n    else if (lower.includes('target noncreature artifact')) targetType = 'noncreature artifact';"
if needle not in text:
    raise SystemExit("needle1 not found")
text = text.replace(needle, insert, 1)

# Insert up-to-N block before the targetConstraint section
marker = "  let targetConstraint: 'opponent' | 'you' | undefined;\r\n"
up_to = """  // Non-GY \"up to N target\" / \"N target\" counts (GY branch already sets these when applicable).
  if (requiresTarget && minTargets === undefined && maxTargets === undefined) {
    if (lower.includes('any number of target')) {
      minTargets = 0;
      maxTargets = 99;
    } else if (/\\bup to one target\\b/.test(lower)) {
      minTargets = 0;
      maxTargets = 1;
    } else if (/\\bup to two target\\b/.test(lower)) {
      minTargets = 0;
      maxTargets = 2;
    } else if (/\\bup to three target\\b/.test(lower)) {
      minTargets = 0;
      maxTargets = 3;
    } else if (/\\bup to four target\\b/.test(lower)) {
      minTargets = 0;
      maxTargets = 4;
    } else if (/\\btwo target\\b/.test(lower)) {
      minTargets = 2;
      maxTargets = 2;
    }
  }

"""
# convert up_to to CRLF
up_to_crlf = up_to.replace("\n", "\r\n")
if marker not in text:
    raise SystemExit("constraint marker not found")
if "up to four target" in text and "Non-GY" in text:
    print("already patched up-to?")
else:
    text = text.replace(marker, up_to_crlf + marker, 1)

path.write_bytes(text.encode("utf-8"))
print("patched inferrer")
