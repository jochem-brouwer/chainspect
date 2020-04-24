//import { BigNumber } from '../../node_modules/ethers/utils/bignumber'
import BN from "bn.js";
//type BigNumber = BN

//import {Transaction} from 'web3-core';
import { BlockTransactionObject } from "web3-eth";

type BigNumber = BN;

export interface Transaction {
  hash?: string;
  to?: string;
  creates?: string;
  from?: string;
  nonce: number;
  gasLimit: BigNumber;
  gasPrice: BigNumber;
  data: string;
  value: BigNumber;
  chainId: number;
  r?: string;
  s?: string;
  v?: number;
}

/**
 * Any object that can be transformed into a `Buffer`
 */
export interface TransformableToBuffer {
  toBuffer(): Buffer;
}

export type PrefixedHexString = string;
export type BufferLike =
  | Buffer
  | TransformableToBuffer
  | PrefixedHexString
  | number;

/**
 * A block header's data.
 */
export interface BlockHeaderData {
  parentHash?: BufferLike;
  uncleHash?: BufferLike;
  coinbase?: BufferLike;
  stateRoot?: BufferLike;
  transactionsTrie?: BufferLike;
  receiptTrie?: BufferLike;
  bloom?: BufferLike;
  difficulty?: BufferLike;
  number?: BufferLike;
  gasLimit?: BufferLike;
  gasUsed?: BufferLike;
  timestamp?: BufferLike;
  extraData?: BufferLike;
  mixHash?: BufferLike;
  nonce?: BufferLike;
}

/**
 * A transaction's data.
 */
export interface TxData {
  gasLimit?: BufferLike;
  gasPrice?: BufferLike;
  to?: BufferLike;
  nonce?: BufferLike;
  data?: BufferLike;
  v?: BufferLike;
  r?: BufferLike;
  s?: BufferLike;
  value?: BufferLike;
}

/**
 * A block's data.
 */
export interface BlockData {
  header?: Buffer | PrefixedHexString | BufferLike[] | BlockHeaderData;
  transactions?: Array<Buffer | PrefixedHexString | BufferLike[] | TxData>;
  uncleHeaders?: Array<
    Buffer | PrefixedHexString | BufferLike[] | BlockHeaderData
  >;
}
