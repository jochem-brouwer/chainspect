import VM from "ethereumjs-vm";
import Blockchain from "./blockchain";
import BN from "bn.js";

import Common from "ethereumjs-common";
import web3 from "web3";
import { ethers } from "ethers";
import { BlockTransactionObject, Transaction } from "web3-eth";
import { IDictionary } from "../types/types";

import { StateCache, Query } from "./stateCache";
import { RunTxResult } from "ethereumjs-vm/dist/runTx";

import Bloom from "ethereumjs-vm/dist/bloom/";

const Trie = require("merkle-patricia-tree");
import { encode } from "rlp";

const fs = require("fs");

const cliProgress = require("cli-progress");
const chalk = require("chalk");

type Web3 = web3;

export class VmTrace {
  web3: Web3;
  vm: VM;
  dump: boolean;
  bar: any;
  stateCache: StateCache;

  constructor(web3: Web3) {
    this.web3 = web3;
    let common = new Common("mainnet", "muirGlacier");

    let newChain = new Blockchain(this.web3);

    this.vm = new VM({
      common: common,
      activatePrecompiles: true,
      blockchain: <any>newChain,
    });

    this.dump = true;
    this.bar = new cliProgress.SingleBar(
      {},
      cliProgress.Presets.shades_classic
    );
    this.stateCache = new StateCache(web3, this.vm.pStateManager);
  }

  public addressToBuffer(input: string): Buffer {
    let iput = input;
    if (iput.substr(0, 2) == "0x") {
      iput = iput.substr(2);
    }
    iput = iput.padStart(40, "0");
    return Buffer.from(iput, "hex");
  }

  public async traceBlock(block: BlockTransactionObject, receipts: any) {
    return new Promise(async (resolve, reject) => {
      this.stateCache.setBlockNumber(block.number - 1);
      let thisCache = this;

      let gasTarget = block.gasUsed;
      let transactionNumber = block.transactions.length;

      let number: number = block.number;
      let prevNumber: number = number - 1;

      // INITIALIZE BLOCKS
      let start = number - 256; //number - 256;
      if (start < 0) {
        start = 0;
      }

      let promiseArray: any = [];
      let i = 0;

      console.log(
        "Downloading previous blocks and uncles (" +
          block.uncles.length +
          ") ... "
      );

      this.bar.start(256 + block.uncles.length, i);
      for (let qBlock = start; qBlock < number; qBlock++) {
        promiseArray.push(
          this.web3.eth.getBlock(qBlock).then(async function (bhashBlock: any) {
            await (<any>thisCache.vm.blockchain).putBlock(bhashBlock);
            i++;
            thisCache.bar.update(i);
          })
        );
      }

      let addressSet: IDictionary<boolean> = {};
      let targetSet: IDictionary<boolean> = {};
      let createSet: IDictionary<boolean> = {};

      let uncles: any = [];

      // check uncles
      if (block.uncles.length > 0) {
        let len = block.uncles.length;
        for (let uncle = 0; uncle < len; uncle++) {
          promiseArray.push(
            this.web3.eth
              .getUncle(block.number, uncle)
              .then(async function (uncleBlock: any) {
                await (<any>thisCache.vm.blockchain).putBlock(uncleBlock);
                addressSet[uncleBlock.miner] = true;
                i++;
                thisCache.bar.update(i);
                uncles[uncle] = uncleBlock;
              })
          );
        }
      }

      await Promise.all(promiseArray);
      this.bar.stop();

      for (let index in block.transactions) {
        let transaction: Transaction = <Transaction>block.transactions[index];
        let from: string = <string>transaction.from;
        let to: string = <string>transaction.to;
        if (to) {
          targetSet[to] = true;
        } else if (to == null) {
          let create: string = ethers.utils.getContractAddress({
            from: from,
            nonce: transaction.nonce,
          });
          createSet[create] = true;
        }
        addressSet[from] = true;
      }

      let checkBalance: IDictionary<boolean> = {};
      let checkCode: IDictionary<boolean> = {};

      for (let key in addressSet) {
        checkBalance[key] = true;
      }

      for (let key in targetSet) {
        checkBalance[key] = true;
        checkCode[key] = true;
      }

      for (let key in createSet) {
        checkBalance[key] = true;
      }

      checkBalance[block.miner] = true;
      promiseArray = [];

      let opList: Query[] = [];
      for (let address in checkBalance) {
        opList.push({
          address: address,
          op: "account",
          block: prevNumber,
        });
      }

      let codeCache: IDictionary<string> = {};

      for (let address in checkCode) {
        opList.push({
          address: address,
          op: "account",
          block: prevNumber,
        });
      }

      let contextVM = this;
      console.log("Downloading accounts and code...");
      await this.stateCache.processQueries(opList);

      let TxTracker = 0;
      let depth = 0;

      let trace: any;

      let currentETHTX: any;
      let vmstep = 0;

      let multiBar = new cliProgress.MultiBar({});

      let txBar = multiBar.create(transactionNumber, 0);
      let gasBar = multiBar.create(gasTarget, 0);

      txBar.format =
        "txn progress [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}";
      gasBar.format =
        "gas progress [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}";

      let dumpBar = true;

      let gasUsedCurrent = 0;
      let gasUsedTX = 0;
      let txGasLimit = 0;

      this.vm.on("beforeTx", async (tx: any, callback: any) => {
        currentETHTX = block.transactions[TxTracker];

        depth++;
        this.stateCache.changeDepth(1, false);

        gasUsedCurrent = gasUsedTX;
        let gasLimit = new BN(tx.gasLimit).toNumber();
        txGasLimit = gasLimit;

        callback();
      });

      this.vm.on("afterTx", (tx: RunTxResult, callback: any) => {
        if (tx.execResult.exceptionError) {
          if (receipts[TxTracker].status) {
            console.log(
              block.transactions[TxTracker].hash +
                " did not fail on chain but did fail in vmtrace"
            );
          }
          this.stateCache.changeDepth(-1, true);
        } else {
          if (!receipts[TxTracker].status) {
            console.log(
              block.transactions[TxTracker].hash +
                " did FAIL on chain but did not fail in vmtrace"
            );
          }
          this.stateCache.changeDepth(-1, false);
        }

        if (receipts[TxTracker].gasUsed.toString() == tx.gasUsed.toString()) {
          // console.log("tx " + TxTracker + " ok")
        } else {
          console.log(chalk.red("!!!!! INVALID RESULT !!!!!"));
          console.log(
            "!!! ERROR TX: " +
              TxTracker +
              " HASH: " +
              block.transactions[TxTracker].hash
          );
          console.log(
            "gas used: " +
              tx.gasUsed.toString() +
              ", target gas: " +
              receipts[TxTracker].gasUsed.toString()
          );
          console.log("dump of geth receipt gas used and status");
          console.log(receipts[TxTracker].gasUsed, receipts[TxTracker].status);
          console.log("dump of vm gas used and status");
          console.log(
            tx.gasUsed.toString(10),
            tx.execResult.exceptionError == undefined
          );
          console.log(
            "difference in gas used:" +
              (receipts[TxTracker].gasUsed - parseInt(tx.gasUsed.toString(10)))
          );
          console.log("----- DONE -----");
        }

        depth--;
        TxTracker++;
        let usedGas = tx.gasUsed.toNumber();
        gasUsedTX += usedGas;
        if (dumpBar) {
          gasBar.update(gasUsedTX);
          txBar.update(TxTracker);
        }
        callback();
      });

      let dCache: any = {};
      let log = true;

      this.vm.on("step", async function (dump: any, callback: any) {
        let txGasUsed = txGasLimit - new BN(dump.gasLeft).toNumber();
        if (dumpBar) {
          gasBar.update(gasUsedCurrent + txGasUsed);
        }

        let actualDepth = dump.depth + 1;
        if (actualDepth != depth) {
          let diff = actualDepth - depth;
          depth = actualDepth;
          if (diff < 0) {
            let result = dump.stack[dump.stack.length - 1];
            let strVersion = result.toString("hex");

            if (strVersion == "0") {
              thisCache.stateCache.changeDepth(diff, true);
            } else {
              thisCache.stateCache.changeDepth(diff, false);
            }
          } else {
            thisCache.stateCache.changeDepth(diff, false);
          }
        }

        await thisCache.vmStep(
          dump,
          callback,
          block.transactions[TxTracker],
          prevNumber,
          vmstep
        );
      });

      let ethjsBlock = (<any>thisCache.vm.blockchain).convertBlock(
        block,
        uncles
      );
      let blockLogBloom = ethjsBlock.header.bloom;

      ethjsBlock.genTxTrie(async function () {
        let r = await contextVM.vm
          .runBlock({
            block: ethjsBlock,
            skipBlockValidation: false,
            generate: true, // skip checks -> done manually afterwards (it will fail on the state root check, but we dont care about this check.)
          })
          .catch(console.log);
        multiBar.stop();

        // do the log bloom check though!
        if (r) {
          let results = {
            results: r.results,
            receipts: r.receipts,
            gasUsed: gasUsedTX,
          };
          await thisCache.verifyBlock(ethjsBlock, results);

          let bloomAfterRanBlock = thisCache.txListGetBloom(r.results);

          if (
            blockLogBloom.toString("hex") !=
            bloomAfterRanBlock.bitvector.toString("hex")
          ) {
            console.log("error: log bloom mismatch");
          } else {
            console.log("block execution OK!");
            console.log("web3 time: " + (<any>thisCache.stateCache).web3Timer);
          }
        } else {
          console.log("runBlock error");
        }

        resolve();
      });
    });
  }

  private async verifyBlock(chainBlock: any, vmTraceBlock: any) {
    let bloomTraceBlock = this.txListGetBloom(vmTraceBlock.results);
    let expectedBloom = chainBlock.header.bloom;

    // check gas

    let gasUsedExpected = new BN(chainBlock.header.gasUsed).toNumber();

    console.log(gasUsedExpected, vmTraceBlock.gasUsed);
    if (gasUsedExpected != vmTraceBlock.gasUsed) {
      console.log(chalk.red("error"), "gas used mismatch");
    }

    if (
      expectedBloom.toString("hex") != bloomTraceBlock.bitvector.toString("hex")
    ) {
      console.log(chalk.red("error"), "log bloom mismatch");
    }

    // check receipts trie
    let rTrie = await this.txReceiptGetTrie(vmTraceBlock.receipts);
    let rTrieHash = rTrie.root;

    if (
      rTrieHash.toString("hex") != chainBlock.header.receiptTrie.toString("hex")
    ) {
      console.log(chalk.red("error"), "receipt trie mismatch");
    }
  }

  private txListGetBloom(txResults: any): Bloom {
    let bloom = new Bloom();
    for (let tx of txResults) {
      bloom.or(tx.bloom);
    }
    return bloom;
  }

  private async txReceiptGetTrie(txReceipts: any) {
    const receiptTrie = new Trie();

    for (let txId = 0; txId < txReceipts.length; txId++) {
      let trieKey = encode(txId);

      let receipt = txReceipts[txId];
      let arrEncoded = [
        receipt.status,
        receipt.gasUsed,
        receipt.bitvector,
        receipt.logs,
      ];
      let valueEncoded = encode(arrEncoded);
      await new Promise((resolve, reject) => {
        receiptTrie.put(trieKey, valueEncoded, function () {
          resolve();
        });
      });
    }
    return receiptTrie;
  }

  private prevOPSStore: boolean = false;

  private opList: any = {
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
    BLOCKHASH: true,
  };

  private bufferToAddress(input: any) {
    let addr = web3.utils.toChecksumAddress("0x" + input.toString("hex"));
    return addr;
  }

  private bnToAddress(input: any) {
    let str: string = input.toString("hex");
    let pad = str.padStart(40, "0");
    let actual = "0x" + pad;
    return actual;
  }

  private bnToStorageSlot(input: any) {
    let str: string = input.toString("hex");
    let pad = str.padStart(64, "0");
    let actual = "0x" + pad;
    return actual;
  }

  private async vmStep(
    vmState: any,
    cb: Function,
    tx: any,
    block: number,
    vmstep: number
  ) {
    let opcode: any = vmState.opcode;
    let DEBUG = false;

    if (this.opList[opcode.name]) {
      let stackPos0 = vmState.stack[vmState.stack.length - 1];
      let stackPos1 = vmState.stack[vmState.stack.length - 2];
      if (opcode.name == "BALANCE") {
        let addrStr = this.bnToAddress(stackPos0);
        await this.stateCache.processQuery({
          op: "account",
          address: addrStr,
          block: block,
        });
      } else if (opcode.name == "EXTCODESIZE") {
        let addrStr = this.bnToAddress(stackPos0);
        await this.stateCache.processQuery({
          op: "code",
          address: addrStr,
          block: block,
        });
      } else if (opcode.name == "EXTCODECOPY") {
        let addrStr = this.bnToAddress(stackPos0);
        await this.stateCache.processQuery({
          op: "code",
          address: addrStr,
          block: block,
        });
      } else if (opcode.name == "EXTCODEHASH") {
        let addrStr = this.bnToAddress(stackPos0);
        await this.stateCache.processQuery({
          op: "code",
          address: addrStr,
          block: block,
        });
      } else if (opcode.name == "SLOAD") {
        if (DEBUG) {
          console.log(
            "SLOAD - TEST",
            stackPos0,
            vmState.depth,
            this.bufferToAddress(vmState.address),
            "step: " + vmstep
          );
          this.prevOPSStore = true;
        }

        await this.stateCache.processQuery({
          op: "storage", // -> this might STILL BE GOING WRONG (delegate calls to addr 0 !?)
          address: this.bufferToAddress(vmState.address),
          slot: this.bnToStorageSlot(stackPos0),
          block: block,
        });
      } else if (opcode.name == "SSTORE") {
        if (DEBUG && stackPos0.toString(16) == "") {
          //console.log("PRE-SSTORE QUERY")
        }
        await this.stateCache.processQuery({
          op: "storage",
          address: this.bufferToAddress(vmState.address),
          slot: this.bnToStorageSlot(stackPos0),
          block: block,
        });
        if (DEBUG && stackPos0.toString(16)) {
          console.log(
            "SSTORE",
            stackPos0.toString("hex").padStart(64, "0"),
            stackPos1.toString("hex").padStart(64, "0"),
            vmState.depth,
            this.bufferToAddress(vmState.address),
            "step: " + vmstep
          );
        }
      } else if (opcode.name == "CREATE") {
        let currentAddress =
          "0x" + vmState.address.toString("hex").padStart(40, "0");
        let nonce = vmState.account.nonce;

        let internal_tx = {
          from: currentAddress,
          nonce: nonce,
        };

        let deployAddress = ethers.utils.getContractAddress(internal_tx);

        await this.stateCache.processQuery({
          op: "account",
          address: deployAddress,
          block: block,
        });
      } else if (opcode.name == "CALL") {
        // load target balance + nonce + code
        let addrStr = this.bnToAddress(stackPos1);
        await this.stateCache.processQuery({
          op: "account",
          address: addrStr,
          block: block,
        });
        await this.stateCache.processQuery({
          op: "code",
          address: addrStr,
          block: block,
        });
      } else if (opcode.name == "CALLCODE") {
        // load target balance + nonce + code
        let addrStr = this.bnToAddress(stackPos1);
        await this.stateCache.processQuery({
          op: "account",
          address: addrStr,
          block: block,
        });
        await this.stateCache.processQuery({
          op: "code",
          address: addrStr,
          block: block,
        });
      } else if (opcode.name == "DELEGATECALL") {
        // load target balance + nonce + code
        let addrStr = this.bnToAddress(stackPos1);
        await this.stateCache.processQuery({
          op: "account",
          address: addrStr,
          block: block,
        });
        await this.stateCache.processQuery({
          op: "code",
          address: addrStr,
          block: block,
        });
        if (DEBUG) {
          //console.log(opcode.name, addrStr)
          //this.callOpStackDump(opcode.name, vmState.stack, vmState.depth, vmstep)
        }
      } else if (opcode.name == "CREATE2") {
        // calculate target addr from the KECCAK formula and load balance/nonce/code

        let offset = new BN(vmState.stack[vmState.stack.length - 2]).toNumber();
        let len = new BN(vmState.stack[vmState.stack.length - 3]).toNumber();
        let salt = vmState.stack[vmState.stack.length - 4].toArrayLike(
          Buffer,
          "be",
          32
        );

        let codeBuffer = vmState.memory.slice(offset, offset + len);

        let currentAddress =
          "0x" + vmState.address.toString("hex").padStart(40, "0");

        let create2address = ethers.utils.getCreate2Address({
          initCode: codeBuffer,
          from: currentAddress,
          salt: salt,
        });

        await this.stateCache.processQuery({
          op: "account",
          address: create2address,
          block: block,
        });
      } else if (opcode.name == "STATICCALL") {
        // load target balance + nonce + code
        let addrStr = this.bnToAddress(stackPos1);
        await this.stateCache.processQuery({
          op: "account",
          address: addrStr,
          block: block,
        });
        await this.stateCache.processQuery({
          op: "code",
          address: addrStr,
          block: block,
        });
      } else if (opcode.name == "SELFDESTRUCT") {
        let addrStr = this.bnToAddress(stackPos0);
        await this.stateCache.processQuery({
          op: "account",
          address: addrStr,
          block: block,
        });
      } else if (opcode.name == "BLOCKHASH") {
        //console.log("!!! BLOCK HASH CODE !!!") -> should work; previous blocks are loaded in the mock Blockchain
      }
    }
    this.stateCache.debug(false);
    cb();
  }
}
