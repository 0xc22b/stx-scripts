const fs = require('fs');
const Database = require('better-sqlite3');

const { getAllSnapshots, getBlockCommits, getLeaderKeys } = require('./apis/db');
const { trimBurnBlocks, getLeaderKey, getPrevTotalBurn, getMiners } = require('./utils');
const { SORTITION_DB_FNAME } = require('./types/const');

const DPATH = process.argv[2];
const STX_ADDRESS = 'ST28WNXZJ140J09F6JQY9CFC3XYAN30V9MRAYX9WC';
const START_BLOCK_HEIGHT = 0;
const END_BLOCK_HEIGHT = -1;

const writeCsvMiningInfo = (trimmedBurnBlocks, burnBlocks, blockCommits, leaderKeys) => {

  const rows = [];

  let prevTotalBurn = getPrevTotalBurn(trimmedBurnBlocks, burnBlocks);

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
  console.log('write mining info done.');
};

const writeCsvMinerInfo = (miners) => {

  const rows = [];
  for (const k in miners) {
    const miner = { stxAddress: k, ...miners[k] };
    miner.eff = miner.nWon / (miner.burn / 100000000);
    rows.push(miner);
  }
  rows.sort((a, b) => -1 * (a.eff - b.eff));

  const texts = ['stx_address,n_mined,n_won,burn,total_burn,eff'];
  for (const row of rows) {
    texts.push(`${row.stxAddress},${row.nMined},${row.nWon},${row.burn},${row.totalBurn},${row.eff}`);
  }
  fs.writeFileSync('./data/miner-info.csv', texts.join('\n'));
  console.log('write miner info done.');
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
    throw new Error('trimmedBurnBlocks cannot be empty. Need it to generate reports');
  }

  writeCsvMiningInfo(trimmedBurnBlocks, burnBlocks, blockCommits, leaderKeys);

  const miners = getMiners(trimmedBurnBlocks, burnBlocks, blockCommits, leaderKeys);
  writeCsvMinerInfo(miners);
}

main();
