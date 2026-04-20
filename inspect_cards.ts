import * as fs from 'fs';
import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser';

const cardNames = [
  "Owlbear Cub",
  "Keldon Flamesage",
  "Sunbird's Invocation",
  "Majestic Genesis",
  "Forging the Anchor",
  "Harald, King of Skemfar"
];

async function main() {
  const data = JSON.parse(fs.readFileSync('oracle-cards.json', 'utf8'));
  const cards = data.filter((c: any) => cardNames.includes(c.name));
  
  const results = cards.map((card: any) => {
    let ir;
    try {
        ir = parseOracleTextToIR(card.oracle_text, card.name);
    } catch (e) {
        return { name: card.name, error: (e as Error).message };
    }
    return {
      name: card.name,
      oracle_text: card.oracle_text,
      abilities: (ir as any).abilities?.map((a: any) => ({
        type: a.type,
        text: a.text,
        steps: a.steps?.map((s: any) => ({
          kind: s.kind,
          raw: s.raw
        }))
      })) || []
    };
  });

  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
