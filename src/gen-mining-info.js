const Database = require('better-sqlite3');
const { writeJson, writeCsv } = require('./utils');

const DPATH = '/tmp/stacks-testnet-f6aa0b178e2ba9d2';
const STX_ADDRESS = 'ST28WNXZJ140J09F6JQY9CFC3XYAN30V9MRAYX9WC';

const ANCHOR_BLOCK_HEIGHT = 0;
const ROOT_PARENT_BURN_HEADER_HASH = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
const SORTITION_DB_FNAME = 'burnchain/db/bitcoin/regtest/sortition.db/marf';

const sortitionDb = new Database(`${DPATH}/${SORTITION_DB_FNAME}`, {
  readonly: true,
  fileMustExist: true,
});

const snapshotsSelect = sortitionDb.prepare('SELECT * FROM snapshots');
const blockCommitsSelect = sortitionDb.prepare('SELECT * FROM block_commits');
const leaderKeysSelect = sortitionDb.prepare('SELECT * FROM leader_keys');

const getSnapshots = () => {

  const blocks = {};
  const parentKeys = [];

  const result = snapshotsSelect.all();
  for (const row of result) {

    // Need to load the whole chain as some leader keys might refer to
    //if (row.block_height < ANCHOR_BLOCK_HEIGHT) continue;
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

  const result = blockCommitsSelect.all();
  for (const row of result) {
    if (!blockCommits[row.burn_header_hash]) blockCommits[row.burn_header_hash] = [];
    blockCommits[row.burn_header_hash].push(row);
  }

  return blockCommits;
};

const getLeaderKeys = () => {

  const leaderKeys = {};

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

const getMiners = (burnBlocks, blockCommits, leaderKeys) => {

  const miners = {};

  let prevTotalBurn = 0;
  let _burnBlocks = burnBlocks;
  if (ANCHOR_BLOCK_HEIGHT > 0) {
    prevTotalBurn = parseInt(burnBlocks[ANCHOR_BLOCK_HEIGHT - 1].total_burn);
    _burnBlocks = burnBlocks.slice(ANCHOR_BLOCK_HEIGHT);
  }

  for (const block of _burnBlocks) {
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

const writeJsonMiningInfo = (burnBlocks, miners) => {

  if (!miners[STX_ADDRESS]) return;

  const blockHeights = [], totalBurns = [];
  for (let i = burnBlocks.length - 1; i >= Math.max(burnBlocks.length - 40, 0); i--) {
    blockHeights.push(burnBlocks[i].block_height);
    totalBurns.push(burnBlocks[i].total_burn);
  }

  const data = {
    blockHeights,
    totalBurns,
    minerNMined: miners[STX_ADDRESS].nMined,
    minerTotalBurn: miners[STX_ADDRESS].totalBurn,
  };
  writeJson('./data/mining-info.json', data);
};

const writeCsvMiningInfo = (burnBlocks, blockCommits, leaderKeys, miners) => {

  if (!miners[STX_ADDRESS]) return;

  const rows = [];

  let prevTotalBurn = 0;
  for (const block of burnBlocks) {
    const totalBurn = parseInt(block.total_burn);
    const blockBurn = totalBurn - prevTotalBurn;

    let burn = 0, won = 0;

    const burnHeaderHash = block.burn_header_hash;
    if (blockCommits[burnHeaderHash]) {
      for (const blockCommit of blockCommits[burnHeaderHash]) {
        const leaderKey = getLeaderKey(burnBlocks, leaderKeys, blockCommit);
        if (leaderKey && leaderKey.address === STX_ADDRESS) {
          burn = parseInt(blockCommit.burn_fee);
          if (blockCommit.txid === block.winning_block_txid) won = 1;
          break;
        }
      }
    }

    rows.push({
      blockHeight: block.block_height,
      totalBurn: blockBurn,
      burn,
      won,
    });
    prevTotalBurn = totalBurn;
  }

  writeCsv('./data/mining-info.csv', rows);
};

const main = () => {
  const burnBlocks = getSnapshots();
  const blockCommits = getBlockCommits();
  const leaderKeys = getLeaderKeys();
  const miners = getMiners(burnBlocks, blockCommits, leaderKeys);

  writeJsonMiningInfo(burnBlocks, miners);
  writeCsvMiningInfo(burnBlocks, blockCommits, leaderKeys, miners);
}

main();
