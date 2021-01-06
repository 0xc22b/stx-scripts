const Client = require('bitcoin-core');

const { mean, percentiles, toFixed } = require('./utils');

const client = new Client({
  port: 18332, username: 'bitcoin-testnet', password: 'bitcoin-testnet',
});

const getNums = (rawMempool, id, pickedIds) => {
  if (pickedIds.includes(id)) {
    return { size: 0, fee: 0, pids: [] };
  }

  const t = rawMempool[id];

  let size = t.vsize;
  let fee = t.fees.base * 100000000;
  let pids = [];

  for (const pid of t.depends) {
    const nums = getNums(rawMempool, pid, pickedIds);
    if (nums.size > 0) {
      size += nums.size;
      fee += nums.fee;
      pids.push(pid);
      pids.push(...nums.pids);
    }
  }

  return { size, fee, pids };
};

const getTs = (rawMempool, pickedIds) => {
  const ts = [];
  for (const id in rawMempool) {
    const { size, fee, pids } = getNums(rawMempool, id, pickedIds);
    if (size > 0) ts.push({ id, size, fee, pids });
  }
  return ts;
};

const getStats = (ts) => {
  const rates = ts.map(t => t.fee / t.size);
  return { mean: mean(rates), percentiles: percentiles(rates) }
};

const main = async () => {

  let rawMempool = await client.getRawMempool(true);
  console.log('rawMempool length: ', Object.keys(rawMempool).length);

  const pickedTs = [];
  const pickedIds = [];
  let unpickedTs = [];

  let curSize = 0;
  while (true) {

    const curTs = getTs(rawMempool, pickedIds);
    curTs.sort((a, b) => {
      return (b.fee / b.size) - (a.fee / a.size);
    });

    let didFind = false;
    for (const t of curTs) {
      if (curSize + t.size > 1000000) continue;

      // No way still include picked ids
      if (pickedIds.includes(t.id)) throw new Error();
      for (const pid of t.pids) {
        if (pickedIds.includes(pid)) throw new Error();
      }

      // Pick the best, then need to recalulate the whole rest to find the next best!
      pickedTs.push(t);
      pickedIds.push(t.id);
      pickedIds.push(...t.pids);
      unpickedTs = curTs.filter(el => el !== t);
      curSize += t.size;
      didFind = true;
      break;
    }

    if (!didFind) break;
  }

  console.log('curSize: ', curSize);

  const pickedStats = getStats(pickedTs, qs = [0, 0.25, 0.5, 0.75, 1]);
  const unpickedStats = getStats(unpickedTs, qs = [0, 0.25, 0.5, 0.75, 1]);
  console.log(`Picked fee rate - min: ${toFixed(pickedStats.percentiles[0])}, 25%: ${toFixed(pickedStats.percentiles[1])}, mean: ${toFixed(pickedStats.mean)}, median: ${toFixed(pickedStats.percentiles[2])}, 75%: ${toFixed(pickedStats.percentiles[3])}, max: ${toFixed(pickedStats.percentiles[4])}`);
  console.log(`Unpicked fee rate - min: ${toFixed(unpickedStats.percentiles[0])}, 25%: ${toFixed(unpickedStats.percentiles[1])}, mean: ${toFixed(unpickedStats.mean)}, median: ${toFixed(unpickedStats.percentiles[2])}, 75%: ${toFixed(unpickedStats.percentiles[3])}, max: ${toFixed(unpickedStats.percentiles[4])}`);
};

main();
