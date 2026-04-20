import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser';

const samples = [
    { name: "Aerial Surveyor-like crew", text: "Crew 2 (Tap any number of creatures you control with total power 2 or more: This Vehicle becomes an artifact creature until end of turn.)" }
];

samples.forEach(sample => {
    console.log(`--- ${sample.name} ---`);
    const ir = parseOracleTextToIR(sample.text);
    console.log(JSON.stringify(ir, null, 2));
});
