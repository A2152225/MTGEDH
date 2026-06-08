import fs from 'node:fs';

const d = JSON.parse(
  fs.readFileSync('D:/Git/MTGEDH/server/scripts/out/remaining-legal-ir-gaps.json', 'utf8'),
);
const entries = d.entries
  .sort((a, b) => a.card.localeCompare(b.card))
  .map((e) => ({
    card: e.card,
    set: e.set,
    event: e.event,
    gap: e.gap.replace(/\s+/g, ' ').trim(),
  }));

const canvas = `import { useMemo, useState } from 'react';
import {
  Card,
  CardBody,
  CardHeader,
  H1,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  TextInput,
  useHostTheme,
} from 'cursor/canvas';

const GAPS = ${JSON.stringify(entries)} as const;

export default function RemainingLegalIrGaps() {
  const theme = useHostTheme();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GAPS;
    return GAPS.filter(
      (e) =>
        e.card.toLowerCase().includes(q) ||
        e.set.toLowerCase().includes(q) ||
        e.event.toLowerCase().includes(q) ||
        e.gap.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <Stack gap={16}>
      <H1>Remaining legal trigger IR gaps</H1>
      <Text color={theme.textSecondary}>
        Non-silver / non-UN-set cards · ${entries.length} triggers · batch 36 snapshot
      </Text>
      <Row gap={12}>
        <Stat label="Triggers with gaps" value="${entries.length}" />
        <Stat label="Unique patterns" value="${entries.length}" />
        <Stat label="Full audit gaps" value="609" />
      </Row>
      <TextInput
        label="Filter"
        value={query}
        onChange={setQuery}
        placeholder="Card, set, event, or effect text"
      />
      <Card>
        <CardHeader title={\`Showing \${filtered.length} of \${GAPS.length}\`} />
        <CardBody padding={0}>
          <Table
            columns={[
              { key: 'card', header: 'Card', width: '18%' },
              { key: 'set', header: 'Set', width: '6%' },
              { key: 'event', header: 'Event', width: '14%' },
              { key: 'gap', header: 'Uncovered effect text', width: '62%' },
            ]}
            rows={filtered.map((e) => ({
              key: e.card + e.event + e.gap.slice(0, 24),
              ...e,
            }))}
          />
        </CardBody>
      </Card>
    </Stack>
  );
}
`;

fs.writeFileSync(
  'C:/Users/A2/.cursor/projects/d-Git-MTGEDH/canvases/remaining-legal-ir-gaps.canvas.tsx',
  canvas,
);
console.log(`Wrote canvas with ${entries.length} entries`);
