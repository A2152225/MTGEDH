import { parseOracleTextToIR } from './src/oracleIRParser';

const inputs = [
    {
        name: 'Experimental Augury',
        text: 'Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)\nDraw a card.'
    },
    {
        name: 'Spread the Sickness',
        text: 'Destroy target creature, then proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)'
    }
];

const results = inputs.map(input => ({
    name: input.name,
    ir: parseOracleTextToIR(input.text, input.name)
}));

console.log(JSON.stringify(results, null, 2));
