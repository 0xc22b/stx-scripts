const fs = require('fs');
const Database = require('better-sqlite3');

const { getAllSnapshots, getBlockCommits, getLeaderKeys } = require('./apis/db');
const { trimBurnBlocks, getPrevTotalBurn, getMiners } = require('./utils');
const { SORTITION_DB_FNAME, N_INSTANCES } = require('./types/const');

const DPATH = '/home/wit/stacks-krypton-dir';
const STX_ADDRESS = 'ST28WNXZJ140J09F6JQY9CFC3XYAN30V9MRAYX9WC';
const START_BLOCK_HEIGHT = 0;
const END_BLOCK_HEIGHT = -1;

const writeJsonMiningInfo = (trimmedBurnBlocks, burnBlocks, miners) => {

  const blockHeights = [], blockBurns = [], burnHeaderHashes = [];
  const start = Math.max(trimmedBurnBlocks.length - N_INSTANCES, 0);

  let prevTotalBurn = getPrevTotalBurn(trimmedBurnBlocks, burnBlocks, start);

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

  writeJsonMiningInfo(trimmedBurnBlocks, burnBlocks, miners);
}

main();
