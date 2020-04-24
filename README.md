Usage
======

`npm i`

After installation you can run the app. Infura will not support the amount of requests it will spam, so you need a local node.

`ts-node ./src/app.ts --provider="http://your-node.local:8545" --block=10000000`

If you do not provide a `block` parameter, it will default to the latest block.

The VM will run and will compare the results of the VM against the receipts which are downloaded. After the block is ran, the `receiptTrie`, `logsBloom` and the `gasUsed` will be checked. Note that `stateTrie` cannot be checked unless you have full access to the complete state.