from pathlib import Path

# 1) oracleIR.ts duration union
p = Path(r'rules-engine/src/oracleIR.ts')
t = p.read_text(encoding='utf-8')
old = "readonly duration: 'until_end_of_turn' | 'indefinite' | 'as_long_as_attached' | 'as_long_as_control_source';"
new = "readonly duration: 'until_end_of_turn' | 'indefinite' | 'as_long_as_attached' | 'as_long_as_control_source' | 'during_that_players_next_turn';"
idx = t.find("kind: 'gain_control'")
if idx < 0:
    raise SystemExit('gain_control missing')
chunk = t[idx:idx+500]
if old not in chunk:
    raise SystemExit('duration not near gain_control')
t = t[:idx] + chunk.replace(old, new, 1) + t[idx+500:]
p.write_text(t, encoding='utf-8')
print('oracleIR duration updated')

# 2) gain_control parser duration capture
p = Path(r'rules-engine/src/oracleIRParserSimpleActionClauses.ts')
t = p.read_text(encoding='utf-8')
old_re = r"(until\\s+end\\s+of\\s+turn|for\\s+as\\s+long\\s+as\\s+that\\s+aura\\s+is\\s+attached\\s+to\\s+it|for\\s+as\\s+long\\s+as\\s+you\\s+control\\s+[^.]+)"
new_re = r"(until\\s+end\\s+of\\s+turn|during\\s+that\\s+(?:player|opponent)['\\u2019]?s\\s+next\\s+turn|for\\s+as\\s+long\\s+as\\s+that\\s+aura\\s+is\\s+attached\\s+to\\s+it|for\\s+as\\s+long\\s+as\\s+you\\s+control\\s+[^.]+)"
# The file has the pattern in a template string - find the gainControl match block
marker = "const gainControl = clause.match("
idx = t.find(marker)
if idx < 0:
    raise SystemExit('gainControl match missing')
# Find duration assignment after this
dur_old = """      const durationRaw = String(gainControl[3] || '').trim().toLowerCase();
      const duration = /until\\s+end\\s+of\\s+turn/i.test(durationRaw)
        ? 'until_end_of_turn'
        : /aura\\s+is\\s+attached/i.test(durationRaw)
          ? 'as_long_as_attached'
          : /as\\s+long\\s+as\\s+you\\s+control/i.test(durationRaw)
            ? 'as_long_as_control_source'
            : 'indefinite';"""
dur_new = """      const durationRaw = String(gainControl[3] || '').trim().toLowerCase();
      const duration = /until\\s+end\\s+of\\s+turn/i.test(durationRaw)
        ? 'until_end_of_turn'
        : /during\\s+that\\s+(?:player|opponent)['\\u2019]?s\\s+next\\s+turn/i.test(durationRaw)
          ? 'during_that_players_next_turn'
          : /aura\\s+is\\s+attached/i.test(durationRaw)
            ? 'as_long_as_attached'
            : /as\\s+long\\s+as\\s+you\\s+control/i.test(durationRaw)
              ? 'as_long_as_control_source'
              : 'indefinite';"""
if dur_old not in t:
    raise SystemExit('duration assignment missing')
t = t.replace(dur_old, dur_new, 1)

# Update the regex alternation in the gainControl template. Read the actual line.
# Search for the duration group inside gainControl.
import re
m = re.search(r"const gainControl = clause\.match\(\s*new RegExp\(`([\s\S]*?)`,\s*'i'\s*\)\s*\);", t)
if not m:
    raise SystemExit('gainControl regex not found')
old_pat = m.group(1)
if 'during\\s+that\\s+' in old_pat.replace('\\\\','\\') or 'during\\\\s+that\\\\s+' in old_pat:
    print('duration already in regex')
else:
    needle = r"until\\s+end\\s+of\\s+turn|for\\s+as\\s+long\\s+as\\s+that\\s+aura"
    # In the file string we see double-escaped backslashes because it's inside a template in source
    # Actual source content uses single backslash in the template literal: until\s+end
    needle2 = "until\\s+end\\s+of\\s+turn|for\\s+as\\s+long\\s+as\\s+that\\s+aura"
    if needle2 not in old_pat:
        # try counting escapes
        print('OLD PAT SNIP:', repr(old_pat[old_pat.find('until'):old_pat.find('until')+120] if 'until' in old_pat else old_pat[-200:]))
        raise SystemExit('could not find duration alt in gainControl regex')
    new_pat = old_pat.replace(
        "until\\s+end\\s+of\\s+turn|for\\s+as\\s+long\\s+as\\s+that\\s+aura",
        "until\\s+end\\s+of\\s+turn|during\\s+that\\s+(?:player|opponent)['\\u2019]?s\\s+next\\s+turn|for\\s+as\\s+long\\s+as\\s+that\\s+aura",
        1,
    )
    t = t.replace(old_pat, new_pat, 1)
    print('gainControl regex updated')

# 3) take_extra_turn: accept "After that turn, that player takes an extra turn"
old_tet = """    const takeExtraTurn = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:take|takes)\\s+an?\\s+extra\\s+turn\\s+after\\s+this\\s+one\\b`, 'i')
    );
    if (takeExtraTurn) {
      return withMeta({
        kind: 'take_extra_turn',
        who: parsePlayerSelector(takeExtraTurn[1]),
        raw: rawClause,
        });
    }"""
new_tet = """    const afterThatTurnExtra = clause.match(
      /^after\\s+that\\s+turn,?\\s+(that\\s+player|that\\s+opponent|they)\\s+takes?\\s+an?\\s+extra\\s+turn\\b/i
    );
    if (afterThatTurnExtra) {
      return withMeta({
        kind: 'take_extra_turn',
        who: parsePlayerSelector(String(afterThatTurnExtra[1] || 'that player').trim()),
        raw: rawClause,
      });
    }

    const takeExtraTurn = clause.match(
      new RegExp(`^${PLAYER_SUBJECT_PREFIX}(?:take|takes)\\s+an?\\s+extra\\s+turn(?:\\s+after\\s+this\\s+one)?\\b`, 'i')
    );
    if (takeExtraTurn) {
      return withMeta({
        kind: 'take_extra_turn',
        who: parsePlayerSelector(takeExtraTurn[1]),
        raw: rawClause,
        });
    }"""
if old_tet not in t:
    raise SystemExit('takeExtraTurn block missing')
t = t.replace(old_tet, new_tet, 1)
p.write_text(t, encoding='utf-8')
print('parser updated')
