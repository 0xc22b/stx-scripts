const fs = require('fs');
const Database = require('better-sqlite3');

const { getAllSnapshots, getBlockCommits, getLeaderKeys } = require('./apis/db');
const {
  trimBurnBlocks, getLeaderKey, getPrevTotalBurn, getMiners, toFixed,
} = require('./utils');
const { SORTITION_DB_FNAME } = require('./types/const');

const DPATH = process.argv[2];
const STX_ADDRESS = 'ST28WNXZJ140J09F6JQY9CFC3XYAN30V9MRAYX9WC';
const START_BLOCK_HEIGHT = 983;
const END_BLOCK_HEIGHT = -1;

const writeCsvMiningInfo = (trimmedBurnBlocks, burnBlocks, blockCommits, leaderKeys) => {

  const rows = [];

  let prevTotalBurn = getPrevTotalBurn(trimmedBurnBlocks, burnBlocks);

  let minerNMined = 0, minerNWon = 0, minerTotalBurn = 0, minerBurn = 0;
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
          minerTotalBurn += blockBurn;
          minerBurn += burnFee;
          break;
        }
      }
    }

    const ratio = minerNMined / (block.block_height - START_BLOCK_HEIGHT + 1);
    const minerAvgBlockBurn = minerNMined > 0 ? minerTotalBurn / minerNMined : undefined;

    rows.push({
      blockHeight: block.block_height,
      blockBurn, minerNMined, minerNWon, minerTotalBurn, minerBurn,
      ratio, minerAvgBlockBurn, burnFee,
    });
    prevTotalBurn = totalBurn;
  }

  const texts = ['block_height,block_burn,miner_n_mined,mined_ratio,miner_n_won,pct_won,miner_total_burn,miner_burn,chance_won,pred_block_burn,miner_avg_block_burn,burn_fee'];
  for (const row of rows) {

    const pctWon = row.minerNMined > 0 ? row.minerNWon / row.minerNMined * 100 : 0;
    const chanceWon = row.minerTotalBurn > 0 ? row.minerBurn / row.minerTotalBurn * 100 : 0;

    texts.push(`${row.blockHeight},${row.blockBurn},${row.minerNMined},${toFixed(row.ratio)},${row.minerNWon},${toFixed(pctWon)}%,${row.minerTotalBurn},${row.minerBurn},${toFixed(chanceWon)}%,undefined,${toFixed(row.minerAvgBlockBurn)},${row.burnFee}`);
  }
  fs.writeFileSync('./data/mining-info.csv', texts.join('\n'));
  console.log('write mining info done.');
};

const writeCsvMinerInfo = (miners) => {

  const rows = [];
  for (const k in miners) {

    const miner = miners[k];

    const pctWon = miner.nMined > 0 ? miner.nWon / miner.nMined * 100 : 0;
    const chanceWon = miner.totalBurn > 0 ? miner.burn / miner.totalBurn * 100 : 0;
    const eff = miner.burn > 0 ? miner.nWon / (miner.burn / 100000000) : 0;

    rows.push({ stxAddress: k, ...miner, pctWon, chanceWon, eff });
  }
  rows.sort((a, b) => -1 * (a.eff - b.eff));

  const texts = ['stx_address,n_mined,n_won,pct_won,total_burn,burn,chance_won,eff'];
  for (const row of rows) {
    texts.push(`${row.stxAddress},${row.nMined},${row.nWon},${toFixed(row.pctWon)}%,${row.totalBurn},${row.burn},${toFixed(row.chanceWon)}%,${toFixed(row.eff)}`);
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
