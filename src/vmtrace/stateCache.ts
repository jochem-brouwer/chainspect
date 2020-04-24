const cliProgress = require("cli-progress");
const chalk = require("chalk");
import Account from "ethereumjs-account";

type QueryOp = "storage" | "code" | "account";

export type Query = {
  op: QueryOp;
  address: string;
  slot?: string;
  block: number;
};

export class StateCache {
  private web3: any;
  private stateTrie: any;
  private cache: any = {};
  private bar: any;

  public blockNumber: number = 0;
  public depth: number = 0;

  private commitedState: any;

  private DEBUG: boolean = false;

  constructor(web3: any, stateTrie: any) {
    this.web3 = web3;
    this.stateTrie = stateTrie;
    this.bar = new cliProgress.SingleBar(
      {},
      cliProgress.Presets.shades_classic
    );
    this.depth = 0;
    this.commitedState = {
      0: {
        storage: {},
        account: {},
        code: {},
      },
    };
  }

  public dumpCache(): void {
    console.log(this.cache);
  }

  public debug(newValue: boolean): void {
    this.DEBUG = newValue;
  }

  public numberToHexString(number: number): string {
    return this.numberStringToHexString(number.toString());
  }

  public numberStringToHexString(number: string): string {
    if (number.substr(0, 2) == "0x") {
      throw new Error("is already a hex string");
    }
    let str = this.web3.utils.toBN(number.toString()).toString(16);
    if (str.length % 2 == 1) {
      str = "0" + str;
    }
    return "0x" + str;
  }

  public addressToBuffer(input: string): Buffer {
    let iput = input;
    if (iput.substr(0, 2) == "0x") {
      iput = iput.substr(2);
    }
    iput = iput.padStart(40, "0");
    return Buffer.from(iput, "hex");
  }

  public setBlockNumber(number: number) {
    if (number < this.blockNumber) {
      throw "cannot decrease block number";
    }
    this.blockNumber = number;
    this.cache[this.blockNumber] = {
      nonceCache: {}, // address => nonce
      balanceCache: {}, // address => balance
      codeCache: {}, // address => code
      storageCache: {}, // address => slot => storage
    };
  }

  public changeDepth(diff: number, revert: boolean): void {
    if (diff == -1 || diff == 1) {
      if (diff == 1) {
        this.depth++;
        // overwrite any cache list.
        this.commitedState[this.depth] = {
          storage: {},
          code: {},
          account: {},
        };
      } else {
        // we are going UP. check if revert.
        if (!revert) {
          // copy account;
          let cDepth = this.depth;
          let tDepth = this.depth - 1;
          for (let key in this.commitedState[cDepth].account) {
            this.commitedState[tDepth].account[key] = this.commitedState[
              cDepth
            ].account[key];
          }
          for (let key in this.commitedState[cDepth].code) {
            this.commitedState[tDepth].code[key] = this.commitedState[
              cDepth
            ].code[key];
          }

          // storage

          for (let ctrAddr in this.commitedState[cDepth].storage) {
            if (this.commitedState[tDepth].storage[ctrAddr] == undefined) {
              // very weird to not have any storage pointer here right? -> think this is fine due to staticcall/call to own addr.

              this.commitedState[tDepth].storage[ctrAddr] = {};
            }
            for (let cKey in this.commitedState[cDepth].storage[ctrAddr]) {
              this.commitedState[tDepth].storage[ctrAddr][
                cKey
              ] = this.commitedState[cDepth].storage[ctrAddr][cKey];
            }
          }
        }
        this.depth--;
      }
    } else {
      throw new Error("depth can only go up or down");
    }
  }

  public web3Timer: number = 0;

  public async processQuery(query: Query): Promise<void> {
    let timerStart = Date.now() / 1000;
    let res = await this._processQuery(query);
    this.web3Timer += Date.now() / 1000 - timerStart;
    return res;
  }

  private async _processQuery(query: Query): Promise<void> {
    // precheck
    let dump = false;
    // TODO: EXPLICIT QUERY.SLOT LENGTH CHECKS

    if (query.op == "code") {
      query.op = "account";
    }

    let key = query.address.toLowerCase();
    let cache = query.op;
    let qslot;
    let qslotDebug = false;
    if (cache != "storage") {
      let cDepth = this.depth;
      for (let depth = cDepth; depth >= 0; depth--) {
        if (this.commitedState[depth][cache][key]) {
          return;
        }
      }
    } else {
      qslot = Buffer.from(
        (<string>query.slot).substr(2).padStart(64, "0"),
        "hex"
      ); // TODO: THIS WORKS - MAKE THIS LESS HACKISH
      let cDepth = this.depth;
      for (let depth = cDepth; depth >= 0; depth--) {
        if (
          this.commitedState[depth].storage[key] &&
          this.commitedState[depth].storage[key][<string>query.slot]
        ) {
          if (qslotDebug) {
            console.log(chalk.red("key cache found"));
          }
          return;
        }
      }
    }
    // NOTE: these are not dumped in commmitedState at this point so they are never "saved".

    // postcheck
    if (query.op == "account") {
      let nonce: any;
      let balance: any;
      let code: any;
      let thisCache = this;
      let nonceFn = async function () {
        nonce = await thisCache.processNonce(query);
      };
      let balanceFn = async function () {
        balance = await thisCache.processBalance(query);
      };
      let codeFn = async function () {
        code = await thisCache.processCode(query);
      };
      await Promise.all([nonceFn(), balanceFn(), codeFn()]);

      let account = {
        balance: this.numberStringToHexString(balance),
        nonce: this.numberToHexString(nonce),
      };

      await this.putAccount(this.addressToBuffer(query.address), account); //this.stateTrie.putAccount(this.addressToBuffer(query.address), account)
      await this.stateTrie
        .putContractCode(
          this.addressToBuffer(query.address),
          Buffer.from(code.substr(2), "hex")
        )
        .catch(console.log);
    } else if (query.op == "storage") {
      let storage = await this.processStorage(query);
      let storageBuffer = Buffer.from(storage.substr(2), "hex");
      let storageBufferSafe = this.removeZeroBytes(storageBuffer);
      await this.stateTrie.putContractStorage(
        this.addressToBuffer(query.address),
        qslot,
        storageBufferSafe
      );
    } else {
      throw new Error(query.op + ": operation not found");
    }

    if (cache != "storage") {
      this.commitedState[this.depth][cache][key] = true;
    } else {
      if (this.commitedState[this.depth].storage[key] == undefined) {
        this.commitedState[this.depth].storage[key] = {};
      }
      this.commitedState[this.depth].storage[key][<string>query.slot] = true;
    }
  }

  private removeZeroBytes(input: Buffer): Buffer {
    let len = input.length;
    let byte;
    for (byte = 0; byte < len; byte++) {
      if (input[byte] != 0) {
        break;
      }
    }
    return input.slice(byte, len);
  }

  public async processQueries(queries: Query[]) {
    let out: string[] = [];
    let promiseList = [];
    let thisCache = this;
    let done = 0;
    this.bar.start(queries.length, 0);
    let timerStart = Date.now() / 1000;
    for (let i = 0; i < queries.length; i++) {
      promiseList.push(
        (async function () {
          await thisCache._processQuery(queries[i]);
          done++;
          thisCache.bar.update(done);
        })().catch(console.log)
      );
    }

    await Promise.all(promiseList);
    this.web3Timer += Date.now() / 1000 - timerStart;
    thisCache.bar.stop();
    return out;
  }

  private async processNonce(query: Query) {
    if (this.cache[query.block]) {
      let cache = this.cache[query.block].nonceCache;
      if (cache[query.address]) {
        return cache[query.address];
      }
    } else {
      throw "cache not initialized for block number";
    }
    let nonce = await this.web3.eth.getTransactionCount(
      query.address,
      query.block
    );
    this.cache[query.block].nonceCache[query.address] = nonce;
    return nonce;
  }

  private async processBalance(query: Query) {
    if (this.cache[query.block]) {
      let cache = this.cache[query.block].balanceCache;
      if (cache[query.address]) {
        return cache[query.address];
      }
    } else {
      throw "cache not initialized for block number";
    }
    let balance = await this.web3.eth.getBalance(query.address, query.block);
    this.cache[query.block].balanceCache[query.address] = balance;
    return balance;
  }

  private async processCode(query: Query) {
    if (this.cache[query.block]) {
      let cache = this.cache[query.block].codeCache;
      if (cache[query.address]) {
        return cache[query.address];
      }
    } else {
      throw "cache not initialized for block number";
    }
    return await this.web3.eth.getCode(query.address, query.block);
  }

  private async processStorage(query: Query) {
    if (this.cache[query.block]) {
      let cache = this.cache[query.block].storageCache;
      if (cache[query.address]) {
        let slot: string = <string>query.slot;
        if (cache[query.address][slot]) {
          return cache[query.address][slot];
        }
      } else {
        cache[query.address] = {};
      }
    } else {
      throw "cache not initialized for block number";
    }
    return await this.web3.eth.getStorageAt(
      query.address,
      query.slot,
      query.block
    );
  }

  private async putAccount(address: Buffer, account: any) {
    let currentAccount = await this.stateTrie.getAccount(address);
    if (account.codeHash == undefined) {
      account.codeHash = currentAccount.codeHash;
    }

    await this.stateTrie.putAccount(address, new Account(account));
  }
}
