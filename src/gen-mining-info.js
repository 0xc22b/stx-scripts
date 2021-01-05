const fs = require('fs');
const Database = require('better-sqlite3');

const { getAllSnapshots, getBlockCommits, getLeaderKeys } = require('./apis/db');
const { trimBurnBlocks, getPrevTotalBurn, getLeaders, getMiners } = require('./utils');
const { SORTITION_DB_FNAME, N_INSTANCES } = require('./types/const');

const DPATH = process.argv[2];
const STX_ADDRESS = 'ST29DQWMXH3NV8F9CPB8EKN01V3BKMEP6VG7G80NA';
const START_BLOCK_HEIGHT = 983 - 60;
const END_BLOCK_HEIGHT = 983 - 30;

const writeJsonMiningInfo = (trimmedBurnBlocks, burnBlocks, blockCommits, leaderKeys, miners) => {

  const blockHeights = [], blockBurns = [], burnHeaderHashes = [], burns = [];
  const start = Math.max(trimmedBurnBlocks.length - N_INSTANCES, 0);

  let prevTotalBurn = getPrevTotalBurn(trimmedBurnBlocks, burnBlocks, start);

  for (let i = start; i < trimmedBurnBlocks.length; i++) {
    const block = trimmedBurnBlocks[i];
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

  const nMined = miners[STX_ADDRESS] ? miners[STX_ADDRESS].nMined : 0;
  const nWon = miners[STX_ADDRESS] ? miners[STX_ADDRESS].nWon : 0;
  const totalBurn = miners[STX_ADDRESS] ? miners[STX_ADDRESS].totalBurn : 0;
  const burn = miners[STX_ADDRESS] ? miners[STX_ADDRESS].burn : 0;

  const data = {
    blockHeights,
    blockBurns,
    burnHeaderHashes,
    burns,
    cumulativeTotalBurn: prevTotalBurn,
    minerNMined: nMined,
    minerNWon: nWon,
    minerTotalBurn: totalBurn,
    minerBurn: burn,
  };

  fs.writeFileSync('./data/mining-info.json', JSON.stringify(data));
  console.log('writeJson done.');
};

const main = () => {

  const sortitionDb = new Database(`${DPATH}/${SORTITION_DB_FNAME}`, {
    readonly: true,
    fileMustExist: true,
  });
  const burnBlocks = getAllSnapshots(sortitionDb);
  const blockCommits = getBlockCommits(sortitionDb);
  const leaderKeys = getLeaderKeys(sortitionDb);

  const trimmedBurnBlocks = trimBurnBlocks(
    burnBlocks, START_BLOCK_HEIGHT, END_BLOCK_HEIGHT
  );
  if (trimmedBurnBlocks.length === 0) {
    throw new Error('trimmedBurnBlocks cannot be empty. Need it to find prevTotalBurn');
  }

  const miners = getMiners(trimmedBurnBlocks, burnBlocks, blockCommits, leaderKeys);

  writeJsonMiningInfo(trimmedBurnBlocks, burnBlocks, blockCommits, leaderKeys, miners);
}

main();
