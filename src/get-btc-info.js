const Client = require('bitcoin-core');

const client = new Client({
  port: 18332, username: 'bitcoin-testnet', password: 'bitcoin-testnet',
});

const main = async () => {
  //const info = await client.getBlockchainInfo();
  //console.log(info);

  const bestBlockHash = await client.getBestBlockHash();
  console.log(bestBlockHash);

  //const blockCount = await client.getBlockCount();
  //console.log(blockCount);

  //const chainTips = await client.getChainTips();
  //console.log(chainTips);

  //const memPoolInfo = await client.getMempoolInfo();
  //console.log(memPoolInfo);

  // Maybe it's an ancester of a high fee transaction
  // Maybe it's picked randomly to fill in the rest of the block
  const blockStats = await client.getBlockStats(bestBlockHash, ['avgfeerate', 'feerate_percentiles', 'maxfeerate', 'minfeerate']);
  console.log(blockStats);

  // On testnet, around 1 satoshi/bytes
  const mempoolInfo = await client.getMempoolInfo();
  const mempoolMinFee = mempoolInfo['mempoolminfee']; // BTC/kB
  console.log(`Min fee in mempool: ${mempoolMinFee * 100000000 / 1000} satoshi/byte`);

  const block = await client.getBlock(bestBlockHash, 2);
  console.log(block.tx[0]);
}

main();
