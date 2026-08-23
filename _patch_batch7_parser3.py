from pathlib import Path

p = Path(r'rules-engine/src/oracleIRParserSimpleActionClauses.ts')
t = p.read_text(encoding='utf-8')

# 1) gainControl duration alt (doubled backslashes in file)
old_alt = "until\\\\s+end\\\\s+of\\\\s+turn|for\\\\s+as\\\\s+long\\\\s+as\\\\s+that\\\\s+aura"
new_alt = (
    "until\\\\s+end\\\\s+of\\\\s+turn|"
    "during\\\\s+that\\\\s+(?:player|opponent)['\\\\u2019]?s\\\\s+next\\\\s+turn|"
    "for\\\\s+as\\\\s+long\\\\s+as\\\\s+that\\\\s+aura"
)
idx = t.find('const gainControl = clause.match')
pos = t.find(old_alt, idx)
if pos < 0:
    if 'during\\\\s+that\\\\s+(?:player|opponent)' in t[idx:idx+800]:
        print('regex already patched')
    else:
        raise SystemExit('old_alt missing')
else:
    t = t[:pos] + new_alt + t[pos+len(old_alt):]
    print('regex patched')

# 2) duration assignment — file uses single backslash in /regex/ literals
old_dur_needle = "const durationRaw = String(gainControl[3] || '').trim().toLowerCase();"
didx = t.find(old_dur_needle)
if didx < 0:
    raise SystemExit('durationRaw missing')
# Replace the duration ternary block
block_end = t.find("return withMeta({\n        kind: 'gain_control'", didx)
block = t[didx:block_end]
print('DUR BLOCK:', repr(block[:400]))
if 'during_that_players_next_turn' in block:
    print('duration already patched')
else:
    new_block = """const durationRaw = String(gainControl[3] || '').trim().toLowerCase();
      const duration = /until\\s+end\\s+of\\s+turn/i.test(durationRaw)
        ? 'until_end_of_turn'
        : /during\\s+that\\s+(?:player|opponent)['\\u2019]?s\\s+next\\s+turn/i.test(durationRaw)
          ? 'during_that_players_next_turn'
          : /aura\\s+is\\s+attached/i.test(durationRaw)
            ? 'as_long_as_attached'
            : /as\\s+long\\s+as\\s+you\\s+control/i.test(durationRaw)
              ? 'as_long_as_control_source'
              : 'indefinite';
      """
    t = t[:didx] + new_block + t[block_end:]
    print('duration patched')

# 3) take_extra_turn — doubled backslashes in RegExp template
tidx = t.find('const takeExtraTurn = clause.match')
if tidx < 0:
    raise SystemExit('takeExtraTurn missing')
# Find end of this if block
end_marker = "kind: 'take_extra_turn',\n        who: parsePlayerSelector(takeExtraTurn[1]),\n        raw: rawClause,\n        });\n    }"
eidx = t.find(end_marker, tidx)
if eidx < 0:
    raise SystemExit('takeExtraTurn end missing')
eidx = eidx + len(end_marker)
old_block = t[tidx:eidx]
print('TET old starts', repr(old_block[:120]))

insert = """const afterThatTurnExtra = clause.match(
      /^after\\s+that\\s+turn,?\\s+(that\\s+player|that\\s+opponent|they)\\s+takes?\\s+an?\\s+extra\\s+turn\\b/i
    );
    if (afterThatTurnExtra) {
      return withMeta({
        kind: 'take_extra_turn',
        who: parsePlayerSelector(String(afterThatTurnExtra[1] || 'that player').trim()),
        raw: rawClause,
      });
    }

    """

# Also relax the existing takeExtraTurn to make after-this-one optional
relaxed = old_block.replace(
    "(?:take|takes)\\\\s+an?\\\\s+extra\\\\s+turn\\\\s+after\\\\s+this\\\\s+one\\\\b",
    "(?:take|takes)\\\\s+an?\\\\s+extra\\\\s+turn(?:\\\\s+after\\\\s+this\\\\s+one)?\\\\b",
    1,
)
if relaxed == old_block:
    # try single
    relaxed = old_block.replace(
        "(?:take|takes)\\s+an?\\s+extra\\s+turn\\s+after\\s+this\\s+one\\b",
        "(?:take|takes)\\s+an?\\s+extra\\s+turn(?:\\s+after\\s+this\\s+one)?\\b",
        1,
    )
print('relaxed changed?', relaxed != old_block)

if 'afterThatTurnExtra' in t:
    print('afterThatTurn already present')
else:
    t = t[:tidx] + insert + relaxed + t[eidx:]
    print('take_extra_turn patched')

p.write_text(t, encoding='utf-8')
print('OK written')
