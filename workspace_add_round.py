from pathlib import Path
path = Path(r"D:\Git\MTGEDH\client\src\components\GameStatusIndicator.tsx")
text = path.read_text(encoding="utf-8")
nl = "\r\n" if "\r\n" in text else "\n"
lines = text.splitlines()

out = []
inserted = False
for line in lines:
    out.append(line)
    if (not inserted) and "const priorityPlayerName = players.find(p => p.id === priority)" in line:
        out.extend([
            "  const turnNumber = Math.max(1, Number(turn) || 1);",
            "  // Display-only: one round = each seated player has had a turn.",
            "  const seatedPlayerCount = Math.max(",
            "    1,",
            "    (players || []).filter((p) => p?.id && !(p as any).spectator && !(p as any).isSpectator).length",
            "      || (players || []).length",
            "      || 1,",
            "  );",
            "  const roundNumber = Math.floor((turnNumber - 1) / seatedPlayerCount) + 1;",
        ])
        inserted = True

if not inserted:
    raise SystemExit("compute insert failed")

text2 = nl.join(out) + nl

old_ui = nl.join([
    "      {/* Turn number */}",
    "      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>",
    "        <span style={{ ",
    "          fontSize: 11, ",
    "          color: '#9ca3af', ",
    "          textTransform: 'uppercase', ",
    "          letterSpacing: '0.05em' ",
    "        }}>",
    "          Turn",
    "        </span>",
    "        <span style={{ ",
    "          fontWeight: 700, ",
    "          fontSize: 18,",
    "          color: '#fff',",
    "          minWidth: 24,",
    "          textAlign: 'center'",
    "        }}>",
    "          {turn || 1}",
    "        </span>",
    "      </div>",
])

new_ui = nl.join([
    "      {/* Turn + Round (round is display-only from cumulative turn / seated players) */}",
    "      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>",
    "        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>",
    "          <span style={{ ",
    "            fontSize: 11, ",
    "            color: '#9ca3af', ",
    "            textTransform: 'uppercase', ",
    "            letterSpacing: '0.05em' ",
    "          }}>",
    "            Turn",
    "          </span>",
    "          <span style={{ ",
    "            fontWeight: 700, ",
    "            fontSize: 18,",
    "            color: '#fff',",
    "            minWidth: 24,",
    "            textAlign: 'center'",
    "          }}>",
    "            {turnNumber}",
    "          </span>",
    "        </div>",
    "        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>",
    "          <span style={{ ",
    "            fontSize: 11, ",
    "            color: '#9ca3af', ",
    "            textTransform: 'uppercase', ",
    "            letterSpacing: '0.05em' ",
    "          }}>",
    "            Round",
    "          </span>",
    "          <span",
    "            title={`Round ${roundNumber} (turn ${turnNumber} · ${seatedPlayerCount} players)`}",
    "            style={{ ",
    "              fontWeight: 700, ",
    "              fontSize: 18,",
    "              color: '#c4b5fd',",
    "              minWidth: 24,",
    "              textAlign: 'center'",
    "            }}",
    "          >",
    "            {roundNumber}",
    "          </span>",
    "        </div>",
    "      </div>",
])

if old_ui not in text2:
    idx = text2.find("{turn || 1}")
    print("UI block not found; context:")
    print(repr(text2[max(0, idx-180):idx+80] if idx >= 0 else "no turn||1"))
    raise SystemExit("ui replace failed")

text2 = text2.replace(old_ui, new_ui, 1)
path.write_text(text2, encoding="utf-8")
print("OK")
