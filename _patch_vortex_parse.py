from pathlib import Path

# Parse "counter it unless you sacrifice a land" in ZoneAndRemovalActions
p = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserZoneAndRemovalActions.ts')
text = p.read_text(encoding='utf-8')

# Find a good insertion point - before plain counter spells or after counterUnlessPays
anchor = """  const counterUnlessPaysMatch = clause.match(/^counter\\s+target\\s+spell\\s+unless\\s+its\\s+controller\\s+pays\\s+(\\{[^}]+\\})$/i);
  if (counterUnlessPaysMatch) {"""

insert = """  const counterSelfUnlessSacrificeMatch = clause.match(
    /^counter\\s+(it|this spell)\\s+unless\\s+(you|its controller)\\s+sacrifices?\\s+(.+)$/i
  );
  if (counterSelfUnlessSacrificeMatch) {
    const whoText = String(counterSelfUnlessSacrificeMatch[2] || 'you').trim();
    const whatText = String(counterSelfUnlessSacrificeMatch[3] || '').trim().replace(/\\.$/, '');
    return withMeta({
      kind: 'unless_sacrifices',
      who: parsePlayerSelector(whoText),
      what: { kind: 'raw', text: whatText },
      steps: [
        withMeta({
          kind: 'counter_spell',
          target: parseObjectSelector(String(counterSelfUnlessSacrificeMatch[1] || 'this spell').trim()),
          raw: rawClause,
        }),
      ],
      raw: rawClause,
    });
  }

  """ + anchor

if anchor not in text:
    raise SystemExit('counterUnlessPays anchor missing')
if 'unless_sacrifices' in text:
    print('already has unless_sacrifices parse')
else:
    text = text.replace(anchor, insert, 1)
    p.write_text(text, encoding='utf-8')
    print('zone parse ok')

# Verify parsePlayerSelector is imported
if 'parsePlayerSelector' not in p.read_text(encoding='utf-8')[:2000]:
    # check imports
    head = Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserZoneAndRemovalActions.ts').read_text(encoding='utf-8')[:1500]
    print('HEAD IMPORTS:')
    print(head)
