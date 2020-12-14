const fs = require('fs');
const Database = require('better-sqlite3');
const { mean, linear } = require('./utils');

const DPATH = '/tmp/stacks-testnet-f6aa0b178e2ba9d2';
const STX_ADDRESS = 'ST28WNXZJ140J09F6JQY9CFC3XYAN30V9MRAYX9WC';
const START_BLOCK_HEIGHT = 0;
const DEFAULT_BURN_FEE = 20000;
const PARTICIPATION_RATIO = 0.33;
const CAL_INTERVAL = 2 * 60 * 1000;
const N_INSTANCES = 40;

const SORTITION_DB_FNAME = 'burnchain/db/bitcoin/regtest/sortition.db/marf';
const sortitionDb = new Database(`${DPATH}/${SORTITION_DB_FNAME}`, {
  readonly: true,
  fileMustExist: true,
});

const predFile = fs.createWriteStream('./data/block-burn-preds.csv', { flags: 'a' });

const getSnapshots = (anchorBlockHeight, anchorBurnHeaderHash) => {

  const blocks = {};
  const parentKeys = [];

  const snapshotsSelect = sortitionDb.prepare('SELECT * FROM snapshots WHERE block_height > ?');
  const result = snapshotsSelect.all(anchorBlockHeight);
  for (const row of result) {

    if (row.pox_valid === 0) {
      console.log('Found invalid row in snapshots', row.block_height, row.burn_header_hash)
      continue;
    }

    blocks[row.burn_header_hash] = row;
    parentKeys.push(row.parent_burn_header_hash);
  }

  if (!parentKeys.includes(anchorBurnHeaderHash)) {
    console.log(`No new block descends from our anchor block, just use what we know now.`);
    return null;
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

  for (const branch of branches) {
    const h = branch[branch.length - 1].parent_burn_header_hash;
    if (h !== anchorBurnHeaderHash) {
      console.log('Found branch with no root with our anchor block', branch);
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

  const validBranches = branches.filter(b => b[b.length - 1].parent_burn_header_hash === anchorBurnHeaderHash)

  const branchLengths = validBranches.map(b => b.length);
  console.log(`There are ${validBranches.length} branches from our anchor block with lengths: ${branchLengths}`);

  const burnBlocks = validBranches.find(b => b.length === Math.max(branchLengths));
  return burnBlocks.reverse();
};

const getPointedSnapshots = (blockHeights) => {

  const blocks = {};

  const snapshotsSelect = sortitionDb.prepare(`SELECT * FROM snapshots WHERE block_height IN (${blockHeights.map(() => '?').join(',')})`);
  const result = snapshotsSelect.all(blockHeights);
  for (const row of result) {
    blocks[row.block_height] = row;
  }

  return blocks;
};

const getBlockCommits = (burnHeaderHashes) => {

  const blockCommits = {};

  const blockCommitsSelect = sortitionDb.prepare(`SELECT * FROM block_commits WHERE burn_header_hash IN (${burnHeaderHashes.map(() => '?').join(',')})`);
  const result = blockCommitsSelect.all(burnHeaderHashes);
  for (const row of result) {
    if (!blockCommits[row.burn_header_hash]) blockCommits[row.burn_header_hash] = [];
    blockCommits[row.burn_header_hash].push(row);
  }

  return blockCommits;
};

const getLeaderKeys = (burnHeaderHashes) => {

  const leaderKeys = {};

  const leaderKeysSelect = sortitionDb.prepare(`SELECT * FROM leader_keys WHERE burn_header_hash IN (${burnHeaderHashes.map(() => '?').join(',')})`);
  const result = leaderKeysSelect.all(burnHeaderHashes);
  for (const row of result) {
    if (!leaderKeys[row.burn_header_hash]) leaderKeys[row.burn_header_hash] = [];
    leaderKeys[row.burn_header_hash].push(row);
  }

  return leaderKeys;
}

const getLeaderKey = (burnBlocks, leaderKeys, blockCommit) => {
  const keyBlockPtr = blockCommit.key_block_ptr;
  const vtxIndex = blockCommit.key_vtxindex;
  const hash = burnBlocks[keyBlockPtr].burn_header_hash;
  return leaderKeys[hash].find(k => k.vtxindex === vtxIndex);
};

const getMiners = (burnBlocks, prevTotalBurn) => {

  const blockCommits = getBlockCommits(burnBlocks.map(b => b.burn_header_hash));

  const pointedBlockHeights = [];
  for (const h in blockCommits) {
    for (const b of blockCommits[h]) {
      if (!pointedBlockHeights.includes(b.key_block_ptr)) {
        pointedBlockHeights.push(b.key_block_ptr);
      }
    }
  }
  const pointedBurnBlocks = getPointedSnapshots(pointedBlockHeights);

  const pointedBurnHeaderHashes = []
  for (const h in pointedBurnBlocks) {
    const b = pointedBurnBlocks[h];
    if (!pointedBurnHeaderHashes.includes(b.burn_header_hash)) {
      pointedBurnHeaderHashes.push(b.burn_header_hash);
    }
  }
  const leaderKeys = getLeaderKeys(pointedBurnHeaderHashes);

  const miners = {};

  for (const block of burnBlocks) {
    const totalBurn = parseInt(block.total_burn);
    const blockBurn = totalBurn - prevTotalBurn;

    const burnHeaderHash = block.burn_header_hash;
    if (!blockCommits[burnHeaderHash]) {
      console.log(`Missing block commits with burn_header_hash: ${burnHeaderHash}`)
      continue;
    }

    for (const blockCommit of blockCommits[burnHeaderHash]) {

      const leaderKey = getLeaderKey(pointedBurnBlocks, leaderKeys, blockCommit);
      if (!leaderKey) {
        console.log(`Missing leader key with burn_header_hash: ${burnHeaderHash}, blockCommit: ${blockCommit.key_block_ptr} and vtxindex: ${blockCommit.key_vtxindex}`);
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
};

const updateInfo = (info) => {

  const anchorBlockHeight = info.blockHeights[info.blockHeights.length - 1];
  const anchorBurnHeaderHash = info.burnHeaderHashes[info.burnHeaderHashes.length - 1];

  const burnBlocks = getSnapshots(anchorBlockHeight, anchorBurnHeaderHash);
  if (!burnBlocks) return info;

  const miners = getMiners(burnBlocks, info.cumulativeTotalBurn);

  const blockHeights = [], blockBurns = [], burnHeaderHashes = [];
  let prevTotalBurn = info.cumulativeTotalBurn;
  for (const block of burnBlocks) {
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

  const mNInstances = -1 * N_INSTANCES;
  const updatedInfo = {
    blockHeights: [...info.blockHeights, ...blockHeights].slice(mNInstances),
    blockBurns: [...info.blockBurns, ...blockBurns].slice(mNInstances),
    burnHeaderHashes: [...info.burnHeaderHashes, ...burnHeaderHashes].slice(mNInstances),
    cumulativeTotalBurn: prevTotalBurn,
    minerNMined: info.minerNMined + nMined,
    minerNWon: info.minerNWon + nWon,
    minerBurn: info.minerBurn + burn,
    minerTotalBurn: info.minerTotalBurn + totalBurn,
  };

  console.log(updatedInfo);
  return updatedInfo;
}

const calBurnFee = (info) => {

  const highestBlockHeight = info.blockHeights[info.blockHeights.length - 1];
  const ratio = info.minerNMined / (highestBlockHeight - START_BLOCK_HEIGHT + 1);

  let burnFee = DEFAULT_BURN_FEE;
  let predBlockBurn, minerAvgBlockBurn;
  if (ratio >= PARTICIPATION_RATIO) {

    const blockBurns = info.blockBurns;

    predBlockBurn = blockBurns[blockBurns.length - 1];
    //predBlockBurn = mean(blockBurns.slice(-2));
    //predBlockBurn = linear(blockBurns.slice(-2));

    // Assume minerNMined always > 0 as ratio is valid.
    minerAvgBlockBurn = info.minerTotalBurn / info.minerNMined;
    if (predBlockBurn < minerAvgBlockBurn) burnFee = DEFAULT_BURN_FEE;
    else burnFee = 0;
  }

  return {
    highestBlockHeight,
    minerNMined: info.minerNMined,
    minerNWon: info.minerNWon,
    minerBurn: info.minerBurn,
    minerTotalBurn: info.minerTotalBurn,
    ratio,
    predBlockBurn,
    minerAvgBlockBurn,
    burnFee,
  };
}

const runLoop = async () => {

  let info = JSON.parse(fs.readFileSync('./data/mining-info.json'));
  updatedInfo = updateInfo(info);

  const {
    highestBlockHeight, minerNMined, minerNWon, minerBurn, minerTotalBurn,
    ratio, predBlockBurn, minerAvgBlockBurn, burnFee,
  } = calBurnFee(updatedInfo);
  fs.writeFileSync('./config/burn-fee.txt', burnFee);

  predFile.write(`${highestBlockHeight},${minerNMined},${minerNWon},${minerBurn},${minerTotalBurn},${ratio},${predBlockBurn},${minerAvgBlockBurn},${burnFee}\n`);

  setTimeout(runLoop, CAL_INTERVAL);
};

console.log('Start running...');
runLoop();
