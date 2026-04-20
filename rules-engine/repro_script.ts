
import { parseOracleTextToIR } from "./src/oracleIRParser";
import { pruneRedundantProliferateReminderUnknownAbilities } from "./src/oracleIRParserPostprocess";

const texts = [
  "Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)\nDraw a card.",
  "Destroy target creature, then proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)"
];

const results = texts.map(text => {
  const ir = parseOracleTextToIR(text, "test_card");
  const before = ir.abilities.map(a => {
    const obj: any = {};
    if ("kind" in a) obj.kind = a.kind;
    if ("raw" in a) obj.raw = a.raw;
    // If kind/raw are not on the object, let\"s see what is there
    if (Object.keys(obj).length === 0) {
       obj.keys = Object.keys(a);
       if ((a as any).steps) {
         obj.stepKinds = (a as any).steps.map((s: any) => s.kind);
         obj.stepRaws = (a as any).steps.map((s: any) => s.raw);
       }
    }
    return obj;
  });
  
  pruneRedundantProliferateReminderUnknownAbilities(ir.abilities as any);
  
  const after = ir.abilities.map(a => {
    const obj: any = {};
    if ("kind" in a) obj.kind = a.kind;
    if ("raw" in a) obj.raw = a.raw;
    if (Object.keys(obj).length === 0) {
       obj.keys = Object.keys(a);
       if ((a as any).steps) {
         obj.stepKinds = (a as any).steps.map((s: any) => s.kind);
         obj.stepRaws = (a as any).steps.map((s: any) => s.raw);
       }
    }
    return obj;
  });
  
  return { text, before, after };
});

console.log(JSON.stringify(results, null, 2));

