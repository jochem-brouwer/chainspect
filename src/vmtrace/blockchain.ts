import { IDictionary } from "../types/types";
const Block = require("ethereumjs-block"); // cannot import this module.
const from_RPC = require("ethereumjs-block/from-rpc");
import Common from "ethereumjs-common";
import BN from "bn.js";

export default class Blockchain {
  blocks: IDictionary<any> = {};
  test: boolean = true;
  web3: any;

  constructor(web3: any) {
    this.web3 = web3;
  }

  putBlock(block: any, blockIsUncle: boolean) {
    let hash = block.hash;
    let number = block.number;
    let cBlock = this.convertBlock(block);

    if (!blockIsUncle) {
      this.blocks[number] = cBlock;
    }
    this.blocks[block.hash] = cBlock;
  }

  getBlock(blockHash: any, callBackFunction: Function) {
    let bhash: any = blockHash;
    if (Buffer.isBuffer(blockHash)) {
      bhash = "0x" + blockHash.toString("hex");

      callBackFunction(undefined, this.blocks[bhash]);
    } else if (BN.isBN(blockHash)) {
      // get number
      let n = blockHash.toNumber();
      callBackFunction(undefined, this.blocks[bhash]);
    }
  }

  private numToHex(num: number): string {
    let h = this.web3.utils.toBN(num.toString()).toString("hex");
    if (h == "0x0" || h == "0x00") {
      return "0x";
    } else {
      return "0x" + h;
    }
  }

  convertBlock(block: any, uncles?: any) {
    if (block.transactions) {
      if (
        block.transactions.length > 0 &&
        typeof block.transactions[0] != "string"
      ) {
        for (let i = 0; i < block.transactions.length; i++) {
          let tx = block.transactions[i];
          tx.gas = this.numToHex(tx.gas);
          tx.gasPrice = this.numToHex(tx.gasPrice);
          tx.value = this.numToHex(tx.value);
        }
      }
    }

    block.difficulty = this.numToHex(block.difficulty);
    let b = from_RPC(block, uncles);
    b._common = new Common("mainnet", "muirGlacier");

    for (let i = 0; i < b.transactions.length; i++) {
      let txn = b.transactions[i];
      txn._common = b._common;
    }

    return b;
  }

  getDetails(_: string, cb: any) {
    cb(null, {});
  }
}
