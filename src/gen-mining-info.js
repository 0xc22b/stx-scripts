const fs = require('fs');
const Database = require('better-sqlite3');

const DPATH = '/tmp/stacks-testnet-f6aa0b178e2ba9d2';
const STX_ADDRESS = 'ST28WNXZJ140J09F6JQY9CFC3XYAN30V9MRAYX9WC';
const START_BLOCK_HEIGHT = 0;
const END_BLOCK_HEIGHT = -1;
const N_INSTANCES = 40;

const ROOT_PARENT_BURN_HEADER_HASH = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
const SORTITION_DB_FNAME = 'burnchain/db/bitcoin/regtest/sortition.db/marf';
const sortitionDb = new Database(`${DPATH}/${SORTITION_DB_FNAME}`, {
  readonly: true,
  fileMustExist: true,
});

const getSnapshots = () => {

  const blocks = {};
  const parentKeys = [];

  const snapshotsSelect = sortitionDb.prepare('SELECT * FROM snapshots');
  const result = snapshotsSelect.all();
  for (const row of result) {

    // Need to load the whole chain as some leader keys might refer to
    //if (row.block_height < START_BLOCK_HEIGHT) continue;
    if (row.pox_valid === 0) {
      console.log('Found invalid row in snapshots', row.block_height, row.burn_header_hash)
      continue;
    }

    blocks[row.burn_header_hash] = row;
    parentKeys.push(row.parent_burn_header_hash);
  }

  if (!parentKeys.includes(ROOT_PARENT_BURN_HEADER_HASH)) {
    throw new Error(`Invalid snapshots: no root block with parent hash fff...f`);
  }

  const leafKeys = [];
  for (const key in blocks) {
    if (!parentKeys.includes(key)) leafKeys.push(key);
  }

  const branches = [];
  for (const leafKey of leafKeys) {

    let currentBlock = blocks[leafKey];
    let branch = [currentBlock];

    while (true) {
      const nextBlock = blocks[currentBlock.parent_burn_header_hash];
      if (!nextBlock) break;

      branch.push(nextBlock);
      currentBlock = nextBlock;
    }
    branches.push(branch);
  }

  const branchLengths = branches.map(b => b.length);
  console.log(`There are ${branches.length} branches in snapshots with lengths: ${branchLengths}`);

  for (const branch of branches) {
    const h = branch[branch.length - 1].parent_burn_header_hash;
    if (h !== ROOT_PARENT_BURN_HEADER_HASH) {
      console.log('Found branch with no root', branch);
    }

    const missingHeights = [];
    let seq = branch[0].block_height;
    for (let i = 1; i < branch.length; i++) {
      if (branch[i].block_height !== seq - 1) missingHeights.push(i);
      seq -= 1;
    }
    if (missingHeights.length > 0) {
      console.log('Found missing height in branch', missingHeights, branch);
    }
  }

  const burnBlocks = branches.find(b => b.length === Math.max(branchLengths));
  return burnBlocks.reverse();
}

const getBlockCommits = () => {

  const blockCommits = {};

  const blockCommitsSelect = sortitionDb.prepare('SELECT * FROM block_commits');
  const result = blockCommitsSelect.all();
  for (const row of result) {
    if (!blockCommits[row.burn_header_hash]) blockCommits[row.burn_header_hash] = [];
    blockCommits[row.burn_header_hash].push(row);
  }

  return blockCommits;
};

const getLeaderKeys = () => {

  const leaderKeys = {};

  const leaderKeysSelect = sortitionDb.prepare('SELECT * FROM leader_keys');
  const result = leaderKeysSelect.all();
  for (const row of result) {
    if (!leaderKeys[row.burn_header_hash]) leaderKeys[row.burn_header_hash] = [];
    leaderKeys[row.burn_header_hash].push(row);
  }

  return leaderKeys;
};

const getLeaderKey = (burnBlocks, leaderKeys, blockCommit) => {
  const keyBlockPtr = blockCommit.key_block_ptr;
  const vtxIndex = blockCommit.key_vtxindex;
  const hash = burnBlocks[keyBlockPtr].burn_header_hash;
  return leaderKeys[hash].find(k => k.vtxindex === vtxIndex);
};

const trimBurnBlocks = (burnBlocks) => {
  let trimmedBurnBlocks = burnBlocks;

  if (START_BLOCK_HEIGHT > 0) {
    trimmedBurnBlocks = trimmedBurnBlocks.filter(b => b.block_height >= START_BLOCK_HEIGHT);
  }
  if (END_BLOCK_HEIGHT > -1) {
    trimmedBurnBlocks = trimmedBurnBlocks.filter(b => b.block_height <= END_BLOCK_HEIGHT);
  }

  return trimmedBurnBlocks;
}

const getMiners = (trimmedBurnBlocks, burnBlocks, blockCommits, leaderKeys) => {

  const miners = {};

  const prevBlockHeight = trimmedBurnBlocks[0].block_height - 1;
  const prevBlock = burnBlocks.find(b => b.block_height === prevBlockHeight);
  let prevTotalBurn = prevBlock ? prevBlock.total_burn : 0;

  for (const block of trimmedBurnBlocks) {
    const totalBurn = parseInt(block.total_burn);
    const blockBurn = totalBurn - prevTotalBurn;

    const burnHeaderHash = block.burn_header_hash;
    if (!blockCommits[burnHeaderHash]) {
      if (block.block_height > 303) {
        console.log(`Missing block commits with burn_header_hash: ${burnHeaderHash}`)
      }
      continue;
    }

    for (const blockCommit of blockCommits[burnHeaderHash]) {

      const leaderKey = getLeaderKey(burnBlocks, leaderKeys, blockCommit);
      if (!leaderKey) {
        console.log(`Missing leader key with burn_header_hash: ${burnHeaderHash}, blockCommit: ${blockCommit.key_block_ptr} and vtxindex: ${blockCommit.vtxIndex}`);
        continue;
      }

      const leaderKeyAddress = leaderKey.address;

      if (!miners[leaderKeyAddress]) {
        miners[leaderKeyAddress] = {
          nMined: 0,
          nWon: 0,
          burn: 0, // this miner's btc burn fee
          totalBurn: 0, // total burn when this miner does mine
        };
      }

      const miner = miners[leaderKeyAddress];
      miner.nMined += 1;
      if (blockCommit.txid === block.winning_block_txid) miner.nWon += 1;
      miner.burn += parseInt(blockCommit.burn_fee);
      miner.totalBurn += blockBurn;
    }

    prevTotalBurn = totalBurn;
  }

  console.log(miners);
  return miners;
}

const writeJsonMiningInfo = (trimmedBurnBlocks, burnBlocks, miners) => {

  const blockHeights = [], blockBurns = [], burnHeaderHashes = [];
  const start = Math.max(trimmedBurnBlocks.length - N_INSTANCES, 0);

  const prevBlockHeight = trimmedBurnBlocks[start].block_height - 1;
  const prevBlock = burnBlocks.find(b => b.block_height === prevBlockHeight);
  let prevTotalBurn = prevBlock ? prevBlock.total_burn : 0;

  for (let i = start; i < trimmedBurnBlocks.length; i++) {
    const block = trimmedBurnBlocks[i];
    const totalBurn = parseInt(block.total_burn);
    const blockBurn = totalBurn - prevTotalBurn;

    blockHeights.push(block.block_height);
    blockBurns.push(blockBurn);
    burnHeaderHashes.push(block.burn_header_hash);

    prevTotalBurn = totalBurn;
  }

  const nMined = miners[STX_ADDRESS] ? miners[STX_ADDRESS].nMined : 0;
  const nWon = miners[STX_ADDRESS] ? miners[STX_ADDRESS].nWon : 0;
  const burn = miners[STX_ADDRESS] ? miners[STX_ADDRESS].burn : 0;
  const totalBurn = miners[STX_ADDRESS] ? miners[STX_ADDRESS].totalBurn : 0;

  const data = {
    blockHeights,
    blockBurns,
    burnHeaderHashes,
    cumulativeTotalBurn: prevTotalBurn,
    minerNMined: nMined,
    minerNWon: nWon,
    minerBurn: burn,
    minerTotalBurn: totalBurn,
  };

  fs.writeFileSync('./data/mining-info.json', JSON.stringify(data));
  console.log('writeJson done.');
};

const writeCsvMiningInfo = (trimmedBurnBlocks, burnBlocks, blockCommits, leaderKeys) => {

  const rows = [];

  const prevBlockHeight = trimmedBurnBlocks[0].block_height - 1;
  const prevBlock = burnBlocks.find(b => b.block_height === prevBlockHeight);
  let prevTotalBurn = prevBlock ? prevBlock.total_burn : 0;

  let minerNMined = 0, minerNWon = 0, minerBurn = 0, minerTotalBurn = 0;
  for (const block of trimmedBurnBlocks) {
    const totalBurn = parseInt(block.total_burn);
    const blockBurn = totalBurn - prevTotalBurn;

    let burnFee = 0;

    const burnHeaderHash = block.burn_header_hash;
    if (blockCommits[burnHeaderHash]) {
      for (const blockCommit of blockCommits[burnHeaderHash]) {
        const leaderKey = getLeaderKey(burnBlocks, leaderKeys, blockCommit);
        if (leaderKey && leaderKey.address === STX_ADDRESS) {

          burnFee = parseInt(blockCommit.burn_fee);

          minerNMined += 1;
          if (blockCommit.txid === block.winning_block_txid) minerNWon += 1;
          minerBurn += burnFee;
          minerTotalBurn += blockBurn;
          break;
        }
      }
    }

    const ratio = minerNMined / (block.block_height - START_BLOCK_HEIGHT + 1);
    const minerAvgBlockBurn = minerNMined > 0 ? minerTotalBurn / minerNMined : undefined;

    rows.push({
      blockHeight: block.block_height,
      blockBurn, minerNMined, minerNWon, minerBurn, minerTotalBurn,
      ratio, minerAvgBlockBurn, burnFee,
    });
    prevTotalBurn = totalBurn;
  }

  const texts = ['block_height,block_burn,miner_n_mined,miner_n_won,miner_burn,miner_total_burn,ratio,pred_block_burn,miner_avg_block_burn,burn_fee'];
  for (const row of rows) {
    texts.push(`${row.blockHeight},${row.blockBurn},${row.minerNMined},${row.minerNWon},${row.minerBurn},${row.minerTotalBurn},${row.ratio},undefined,${row.minerAvgBlockBurn},${row.burnFee}`);
  }
  fs.writeFileSync('./data/mining-info.csv', texts.join('\n'));
  console.log('writeCsv done.');
};

const main = () => {
  const burnBlocks = getSnapshots();
  const blockCommits = getBlockCommits();
  const leaderKeys = getLeaderKeys();

  const trimmedBurnBlocks = trimBurnBlocks(burnBlocks);
  if (trimmedBurnBlocks.length === 0) {
    throw new Error('trimmedBurnBlocks cannot be empty. Need it to find prevTotalBurn');
  }

  const miners = getMiners(trimmedBurnBlocks, burnBlocks, blockCommits, leaderKeys);

  writeJsonMiningInfo(trimmedBurnBlocks, burnBlocks, miners);
  writeCsvMiningInfo(trimmedBurnBlocks, burnBlocks, blockCommits, leaderKeys);
}

main();
