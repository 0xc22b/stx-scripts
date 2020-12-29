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

  const blockStats = await client.getBlockStats(bestBlockHash, ['avgfeerate', 'feerate_percentiles', 'maxfeerate', 'minfeerate']);
  console.log(blockStats);

  const block = await client.getBlock(bestBlockHash, 2);
  console.log(block.tx[0]);
}

main();
