const fs = require('fs');
const Database = require('better-sqlite3');

const {
  getFollowingSnapshots, getSpecificSnapshots, getBlockCommits, getLeaderKeys,
} = require('./apis/db');
const { getMiners, mean, linear, getDateTime } = require('./utils');
const {
  SORTITION_DB_FNAME, N_INSTANCES, DEFAULT_BURN_FEE, PARTICIPATION_RATIO, N_CONFIRMATIONS,
} = require('./types/const');

const DPATH = '/tmp/stacks-testnet-f6aa0b178e2ba9d2';
const STX_ADDRESS = 'ST28WNXZJ140J09F6JQY9CFC3XYAN30V9MRAYX9WC';
const START_BLOCK_HEIGHT = 0;
const CAL_INTERVAL = 2 * 60 * 1000;

const predFile = fs.createWriteStream('./data/block-burn-preds.csv', { flags: 'a' });

const getUpdatedMiners = (sortitionDb, burnBlocks, prevTotalBurn) => {

  const blockCommits = getBlockCommits(
    sortitionDb, burnBlocks.map(b => b.burn_header_hash)
  );

  const pointedBlockHeights = [];
  for (const h in blockCommits) {
    for (const b of blockCommits[h]) {
      if (!pointedBlockHeights.includes(b.key_block_ptr)) {
        pointedBlockHeights.push(b.key_block_ptr);
      }
    }
  }
  const pointedBurnBlocks = getSpecificSnapshots(sortitionDb, pointedBlockHeights);

  const pointedBurnHeaderHashes = []
  for (const h in pointedBurnBlocks) {
    const b = pointedBurnBlocks[h];
    if (!pointedBurnHeaderHashes.includes(b.burn_header_hash)) {
      pointedBurnHeaderHashes.push(b.burn_header_hash);
    }
  }
  const leaderKeys = getLeaderKeys(sortitionDb, pointedBurnHeaderHashes);

  return getMiners(
    burnBlocks, pointedBurnBlocks, blockCommits, leaderKeys, prevTotalBurn
  );
};

const updateInfo = (sortitionDb, info, endBlockHeight = null) => {

  const anchorBlockHeight = info.blockHeights[info.blockHeights.length - 1];
  const anchorBurnHeaderHash = info.burnHeaderHashes[info.burnHeaderHashes.length - 1];

  let burnBlocks = getFollowingSnapshots(
    sortitionDb, anchorBlockHeight, anchorBurnHeaderHash
  );
  if (burnBlocks.length === 0) return info;

  if (endBlockHeight) {
    burnBlocks = burnBlocks.filter(b => b.block_height <= endBlockHeight);
  }

  const miners = getUpdatedMiners(sortitionDb, burnBlocks, info.cumulativeTotalBurn);

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
  return {
    blockHeights: [...info.blockHeights, ...blockHeights].slice(mNInstances),
    blockBurns: [...info.blockBurns, ...blockBurns].slice(mNInstances),
    burnHeaderHashes: [...info.burnHeaderHashes, ...burnHeaderHashes].slice(mNInstances),
    cumulativeTotalBurn: prevTotalBurn,
    minerNMined: info.minerNMined + nMined,
    minerNWon: info.minerNWon + nWon,
    minerBurn: info.minerBurn + burn,
    minerTotalBurn: info.minerTotalBurn + totalBurn,
  };
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
    blockBurn: info.blockBurns[info.blockBurns.length - 1],
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
  console.log(`Start a burn fee calculation at ${getDateTime()}`);

  const info = JSON.parse(fs.readFileSync('./data/mining-info.json'));
  const infoBlockHeight = info.blockHeights[info.blockHeights.length - 1];
  console.log(`Read info from the file with highest block height: ${infoBlockHeight}`);

  const sortitionDb = new Database(`${DPATH}/${SORTITION_DB_FNAME}`, {
    readonly: true,
    fileMustExist: true,
  });
  const updatedInfo = updateInfo(sortitionDb, info);
  const updatedInfoBlockHeight = updatedInfo.blockHeights[updatedInfo.blockHeights.length - 1];
  console.log(`Update the info with highest block height: ${updatedInfoBlockHeight}`);

  const {
    highestBlockHeight, blockBurn, minerNMined, minerNWon, minerBurn, minerTotalBurn,
    ratio, predBlockBurn, minerAvgBlockBurn, burnFee,
  } = calBurnFee(updatedInfo);
  console.log(`Calculate burn fee: ${burnFee}`);
  fs.writeFileSync('./config/burn-fee.txt', burnFee);
  console.log('Write calculated burn fee');

  predFile.write(`${highestBlockHeight},${blockBurn},${minerNMined},${minerNWon},${minerBurn},${minerTotalBurn},${ratio},${predBlockBurn},${minerAvgBlockBurn},${burnFee}\n`);
  console.log('Write updated info');

  if (highestBlockHeight - (N_CONFIRMATIONS * 2) > infoBlockHeight) {
    const data = updateInfo(sortitionDb, info, highestBlockHeight - N_CONFIRMATIONS);
    fs.writeFileSync('./data/mining-info.json', JSON.stringify(data));
    console.log(`Override the info as highestBlockHeight: ${highestBlockHeight} is higher enough than infoBlockHeight: ${infoBlockHeight}`);
  }

  console.log(`Finish at ${getDateTime()}`);
  setTimeout(runLoop, CAL_INTERVAL);
};

console.log('Start running...');
runLoop();
