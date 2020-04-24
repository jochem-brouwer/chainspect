import { VmTrace } from "./vmtrace/vmtrace";
import Web3 from "web3";

const cliProgress = require("cli-progress");
const argv = require("minimist")(process.argv.slice(2), {
  string: ["provider"],
});

let ethProvider = new Web3(new Web3.providers.HttpProvider(argv.provider));

let vmTrace = new VmTrace(ethProvider);

ethProvider.extend({
  property: "eth",
  methods: [
    {
      name: "getRawTransaction",
      call: "eth_getRawTransactionByHash",
      params: 1,
    },
  ],
});

ethProvider.extend({
  property: "eth",
  methods: [
    {
      name: "traceTransaction",
      call: "debug_traceTransaction",
      params: 1,
    },
  ],
});

let blockNumber = argv.block || "latest";

ethProvider.eth.getBlock(blockNumber, true).then(async (block) => {
  console.log("Block tracer: Block " + blockNumber);
  let receipts: any = [];
  let promises: any = [];

  console.log("Downloading block receipts... ");
  let bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

  bar.start(block.transactions.length, 0);
  let progress = 0;

  for (let i = 0; i < block.transactions.length; i++) {
    promises.push(
      ethProvider.eth
        .getTransactionReceipt(block.transactions[i].hash)
        .then(async function (r: any) {
          receipts[i] = r;
          progress++;
          bar.update(progress);
        })
    );
  }

  await Promise.all(promises);
  bar.stop();

  let benchmarkTime = Date.now() / 1000;
  await vmTrace.traceBlock(block, receipts);
  console.log(
    "Trace took: " + (Date.now() / 1000 - benchmarkTime) + " seconds"
  );
});
