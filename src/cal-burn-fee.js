const fs = require('fs');
const Database = require('better-sqlite3');
const Client = require('bitcoin-core');

const {
  getFollowingSnapshots, getSpecificSnapshots, getBlockCommits, getLeaderKeys,
} = require('./apis/db');
const {
  trimBurnBlocks, getLeaders, getMiners, mean, linear, getDateTime, toFixed,
  lastIndexOfMoreThanZero,
} = require('./utils');
const {
  SORTITION_DB_FNAME, N_INSTANCES, N_CONFIRMATIONS,
  DEFAULT_BURN_FEE, MAX_BURN_FEE, TX_FEE,
} = require('./types/const');

const DPATH = process.argv[2];
const STX_ADDRESS = 'ST29DQWMXH3NV8F9CPB8EKN01V3BKMEP6VG7G80NA';
const START_BLOCK_HEIGHT = 983;
const AVG_BLOCK_INTERVAL = 7.943; // minutes
const CAL_INTERVAL = AVG_BLOCK_INTERVAL * 60 * 1000;

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

const updateInfo = (sortitionDb, info, endBlockHeight = -1) => {

  const anchorBlockHeight = info.blockHeights[info.blockHeights.length - 1];
  const anchorBurnHeaderHash = info.burnHeaderHashes[info.burnHeaderHashes.length - 1];

  let burnBlocks = getFollowingSnapshots(
    sortitionDb, anchorBlockHeight, anchorBurnHeaderHash
  );
  if (burnBlocks.length === 0) return info;

  // Here is different from gen-mining-info.js and report-mining-info.js.
  // As in those, the period is used to scope both blocks and miners,
  //   but in here, the period is used to scope the miners only.
  // For blocks, start from anchor block to the end or the block at endBlockHeight.
  if (endBlockHeight > -1) {
    burnBlocks = burnBlocks.filter(b => b.block_height <= endBlockHeight);
  }

  const blockHeights = [], blockBurns = [], burnHeaderHashes = [], burns = [];
  let prevTotalBurn = info.cumulativeTotalBurn;
  for (const block of burnBlocks) {
    const totalBurn = parseInt(block.total_burn);
    const blockBurn = totalBurn - prevTotalBurn;

    let burn = 0;
    const leaders = getLeaders(
      burnBlocks, blockCommits, leaderKeys, block.burn_header_hash
    );
    if (STX_ADDRESS in leaders) burn = leaders[STX_ADDRESS].burn;

    blockHeights.push(block.block_height);
    blockBurns.push(blockBurn);
    burnHeaderHashes.push(block.burn_header_hash);
    burns.push(burn);

    prevTotalBurn = totalBurn;
  }

  const trimmedBurnBlocks = trimBurnBlocks(
    burnBlocks, START_BLOCK_HEIGHT, endBlockHeight
  );

  let nMined, nWon, totalBurn, burn;
  if (trimmedBurnBlocks.length === 0) {
    [nMined, nWon, totalBurn, burn] = [0, 0, 0, 0];
  } else {
    const prevBlock = burnBlocks.find(b => b.block_height === START_BLOCK_HEIGHT - 1);
    const _prevTotalBurn = prevBlock ? prevBlock.total_burn : info.cumulativeTotalBurn;
    const miners = getUpdatedMiners(sortitionDb, trimmedBurnBlocks, _prevTotalBurn);

    nMined = miners[STX_ADDRESS] ? miners[STX_ADDRESS].nMined : 0;
    nWon = miners[STX_ADDRESS] ? miners[STX_ADDRESS].nWon : 0;
    totalBurn = miners[STX_ADDRESS] ? miners[STX_ADDRESS].totalBurn : 0;
    burn = miners[STX_ADDRESS] ? miners[STX_ADDRESS].burn : 0;
  }

  const mNInstances = -1 * N_INSTANCES;
  return {
    blockHeights: [...info.blockHeights, ...blockHeights].slice(mNInstances),
    blockBurns: [...info.blockBurns, ...blockBurns].slice(mNInstances),
    burnHeaderHashes: [...info.burnHeaderHashes, ...burnHeaderHashes].slice(mNInstances),
    burns: [...info.burns, ...burns].slice(mNInstances),
    cumulativeTotalBurn: prevTotalBurn,
    minerNMined: info.minerNMined + nMined,
    minerNWon: info.minerNWon + nWon,
    minerTotalBurn: info.minerTotalBurn + totalBurn,
    minerBurn: info.minerBurn + burn,
  };
};

const predictBlockBurn = (info) => {

  const { blockBurns } = info;
  const latestBlockBurn = blockBurns[blockBurns.length - 1]

  if (latestBlockBurn > blockBurns[blockBurns.length - 2]) return latestBlockBurn;

  return mean(blockBurns.slice(-3));
  //return linear(blockBurns.slice(-2));
};

const calBurnFee = async (info, btcClient) => {

  const highestBlockHeight = info.blockHeights[info.blockHeights.length - 1];
  const nBlocks = highestBlockHeight - START_BLOCK_HEIGHT + 1;
  const ratio = info.minerNMined / nBlocks;

  const remainNBlocks = (1610510400000 - Date.now()) / 1000 / 60 / AVG_BLOCK_INTERVAL;
  const remainSatoshi = await btcClient.getBalance('*', 0, true) * 100000000;

  const predBlockBurn = predictBlockBurn(info);
  const minerAvgBlockBurn = info.minerNMined > 0 ? info.minerTotalBurn / info.minerNMined : 0;

  const nLastNoBurn = info.burns.length - lastIndexOfMoreThanZero(info.burns) - 1;

  let burnFee = DEFAULT_BURN_FEE;
  if (remainNBlocks > 0) burnFee = (remainSatoshi / remainNBlocks) - TX_FEE;

  if (nLastNoBurn < Math.floor(60 / AVG_BLOCK_INTERVAL)) {
    if (remainNBlocks > 900) {
      if (predBlockBurn >= minerAvgBlockBurn * 0.8) burnFee = 0;
    } else if (remainNBlocks > 600) {
      if (predBlockBurn >= minerAvgBlockBurn * 0.9) burnFee = 0;
    } else if (remainNBlocks > 300) {
      if (predBlockBurn >= minerAvgBlockBurn) burnFee = 0;
    }
  }

  burnFee = Math.min(burnFee, MAX_BURN_FEE);

  return {
    highestBlockHeight,
    blockBurn: info.blockBurns[info.blockBurns.length - 1],
    minerNMined: info.minerNMined,
    minerNWon: info.minerNWon,
    minerTotalBurn: info.minerTotalBurn,
    minerBurn: info.minerBurn,
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

  const btcClient = new Client({
    port: 18332, username: 'bitcoin-testnet', password: 'bitcoin-testnet',
  });

  const {
    highestBlockHeight, blockBurn, minerNMined, minerNWon, minerTotalBurn, minerBurn,
    ratio, predBlockBurn, minerAvgBlockBurn, burnFee,
  } = await calBurnFee(updatedInfo, btcClient);
  console.log(`Calculate burn fee: ${burnFee}`);
  fs.writeFileSync('./config/burn-fee.txt', burnFee);
  console.log('Write calculated burn fee');

  const pctWon = minerNMined > 0 ? minerNWon / minerNMined * 100 : 0;
  const chanceWon = minerTotalBurn > 0 ? minerBurn / minerTotalBurn * 100 : 0;

  predFile.write(`${highestBlockHeight},${blockBurn},${minerNMined},${toFixed(ratio)},${minerNWon},${toFixed(pctWon)}%,${minerTotalBurn},${minerBurn},${toFixed(chanceWon)}%,${toFixed(predBlockBurn)},${toFixed(minerAvgBlockBurn)},${burnFee}\n`);
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
