import Web3 from "web3";
const fs = require("fs");
const argv = require("minimist")(process.argv.slice(2), {
  string: ["provider", "tx"],
});

// run with ts-node txTracer --provider=<your provider i.e. https://mainnet.infura.io/v3/YOUR-PROJECT-ID --tx=<txhash>

console.log(argv);

console.log("go");
let web3: any = new Web3(new Web3.providers.HttpProvider(argv.provider));
console.log("no");

web3.extend({
  property: "eth",
  methods: [
    {
      name: "traceTransaction",
      call: "debug_traceTransaction",
      params: 1,
    },
  ],
});

let opList: any = {
  BALANCE: true,
  EXTCODESIZE: true,
  EXTCODECOPY: true,
  EXTCODEHASH: true,
  SLOAD: true,
  SSTORE: true, // for gas
  CREATE: true,
  CALL: true,
  CALLCODE: true,
  DELEGATECALL: true,
  CREATE2: true,
  STATICCALL: true,
  SELFDESTRUCT: true,
};

function results(err: any, res: any) {
  fs.writeFileSync("traceResult.json", JSON.stringify(res));
}

async function go() {
  await web3.eth.traceTransaction(argv.tx, results);
}

go();
