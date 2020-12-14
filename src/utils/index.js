const trimBurnBlocks = (burnBlocks, startBlockHeight, endBlockHeight) => {
  let trimmedBurnBlocks = burnBlocks;

  if (startBlockHeight > 0) {
    trimmedBurnBlocks = trimmedBurnBlocks.filter(b => b.block_height >= startBlockHeight);
  }
  if (endBlockHeight > -1) {
    trimmedBurnBlocks = trimmedBurnBlocks.filter(b => b.block_height <= endBlockHeight);
  }

  return trimmedBurnBlocks;
}

const getLeaderKey = (burnBlocks, leaderKeys, blockCommit) => {
  const keyBlockPtr = blockCommit.key_block_ptr;
  const vtxIndex = blockCommit.key_vtxindex;
  const hash = burnBlocks[keyBlockPtr].burn_header_hash;
  return leaderKeys[hash].find(k => k.vtxindex === vtxIndex);
};

const getMiners = (trimmedBurnBlocks, burnBlocks, blockCommits, leaderKeys, prevTotalBurn = null) => {

  const miners = {};

  if (!prevTotalBurn) {
    const prevBlockHeight = trimmedBurnBlocks[0].block_height - 1;
    const prevBlock = burnBlocks.find(b => b.block_height === prevBlockHeight);
    prevTotalBurn = prevBlock ? prevBlock.total_burn : 0;
  }

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
        console.log(`Missing leader key with burn_header_hash: ${burnHeaderHash}, blockCommit: ${blockCommit.key_block_ptr} and vtxindex: ${blockCommit.key_vtxIndex}`);
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

  return miners;
}

const mean = (numbers) => {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) {
    total += numbers[i];
  }
  return total / number.length;
};

/**
 * https://github.com/simple-statistics/simple-statistics/blob/master/src/linear_regression.js
 * [Simple linear regression](http://en.wikipedia.org/wiki/Simple_linear_regression)
 * is a simple way to find a fitted line
 * between a set of coordinates. This algorithm finds the slope and y-intercept of a regression line
 * using the least sum of squares.
 *
 * @param {Array<Array<number>>} data an array of two-element of arrays,
 * like `[[0, 1], [2, 3]]`
 * @returns {Object} object containing slope and intersect of regression line
 * @example
 * linearRegression([[0, 0], [1, 1]]); // => { m: 1, b: 0 }
 */
function linearRegression(data) {

  let m, b;
  // Store data length in a local variable to reduce
  // repeated object property lookups
  const dataLength = data.length;

  //if there's only one point, arbitrarily choose a slope of 0
  //and a y-intercept of whatever the y of the initial point is
  if (dataLength === 1) {
    m = 0;
    b = data[0][1];
  } else {
    // Initialize our sums and scope the `m` and `b`
    // variables that define the line.
    let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
    // Use local variables to grab point values
    // with minimal object property lookups
    let point, x, y;

    // Gather the sum of all x values, the sum of all
    // y values, and the sum of x^2 and (x*y) for each
    // value.
    //
    // In math notation, these would be SS_x, SS_y, SS_xx, and SS_xy
    for (let i = 0; i < dataLength; i++) {
      point = data[i];
      x = point[0];
      y = point[1];
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumXY += x * y;
    }

    // `m` is the slope of the regression line
    m = (dataLength * sumXY - sumX * sumY) / (dataLength * sumXX - sumX * sumX);
    // `b` is the y-intercept of the line.
    b = sumY / dataLength - (m * sumX) / dataLength;
  }

  // Return both values as an object.
  return { m: m, b: b };
}

const linear = (numbers) => {
  const data = numbers.map((n, i) => [i, n]);
  const { m, b } = linearRegression(data);
  return m * numbers.length + b;
};

const getDateTime = () => {
  const dateObj = new Date();

  const date = ('0' + dateObj.getDate()).slice(-2);
  const month = ('0' + (dateObj.getMonth() + 1)).slice(-2);
  const year = dateObj.getFullYear();
  const hours = dateObj.getHours();
  const minutes = dateObj.getMinutes();
  const seconds = dateObj.getSeconds();

  return year + '-' + month + '-' + date + ' ' + hours + ':' + minutes + ':' + seconds;
};

module.exports = { trimBurnBlocks, getLeaderKey, getMiners, mean, linear, getDateTime };
