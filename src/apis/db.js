const ROOT_PARENT_BURN_HEADER_HASH = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

const getAllSnapshots = (sortitionDb) => {

  const blocks = {};
  const parentKeys = [];

  const snapshotsSelect = sortitionDb.prepare('SELECT * FROM snapshots');
  const result = snapshotsSelect.all();
  for (const row of result) {
    // Need to load the whole chain as some leader keys might refer to
    //if (row.block_height < START_BLOCK_HEIGHT) continue;
    if (row.pox_valid === 0) continue;
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

  const validBranches = branches.filter(b => b[b.length - 1].parent_burn_header_hash === ROOT_PARENT_BURN_HEADER_HASH);

  const branchLengths = validBranches.map(b => b.length);
  console.log(`There are ${validBranches.length} branches in snapshots with lengths: ${branchLengths}`);

  const burnBlocks = validBranches.find(b => b.length === Math.max(branchLengths));
  return burnBlocks.reverse();
}

const getFollowingSnapshots = (sortitionDb, anchorBlockHeight, anchorBurnHeaderHash) => {

  const blocks = {};
  const parentKeys = [];

  const snapshotsSelect = sortitionDb.prepare('SELECT * FROM snapshots WHERE block_height > ?');
  const result = snapshotsSelect.all(anchorBlockHeight);
  for (const row of result) {
    if (row.pox_valid === 0) continue;
    blocks[row.burn_header_hash] = row;
    parentKeys.push(row.parent_burn_header_hash);
  }

  if (!parentKeys.includes(anchorBurnHeaderHash)) {
    console.log('No new block descends from our anchor block, just use what we know now.');
    return [];
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

  const validBranches = branches.filter(b => b[b.length - 1].parent_burn_header_hash === anchorBurnHeaderHash);

  const branchLengths = validBranches.map(b => b.length);
  console.log(`There are ${validBranches.length} branches from our anchor block with lengths: ${branchLengths}`);

  const burnBlocks = validBranches.find(b => b.length === Math.max(branchLengths));
  return burnBlocks.reverse();
};

const getSpecificSnapshots = (sortitionDb, blockHeights) => {

  const blocks = {};

  const snapshotsSelect = sortitionDb.prepare(`SELECT * FROM snapshots WHERE block_height IN (${blockHeights.map(() => '?').join(',')})`);
  const result = snapshotsSelect.all(blockHeights);
  for (const row of result) {
    blocks[row.block_height] = row;
  }

  return blocks;
};

const getBlockCommits = (sortitionDb, burnHeaderHashes = null) => {

  const blockCommits = {};

  let result;
  if (burnHeaderHashes) {
    const blockCommitsSelect = sortitionDb.prepare(`SELECT * FROM block_commits WHERE burn_header_hash IN (${burnHeaderHashes.map(() => '?').join(',')})`);
    result = blockCommitsSelect.all(burnHeaderHashes);
  } else {
    const blockCommitsSelect = sortitionDb.prepare('SELECT * FROM block_commits');
    result = blockCommitsSelect.all();
  }

  for (const row of result) {
    if (!blockCommits[row.burn_header_hash]) blockCommits[row.burn_header_hash] = [];
    blockCommits[row.burn_header_hash].push(row);
  }

  return blockCommits;
};

const getLeaderKeys = (sortitionDb, burnHeaderHashes = null) => {

  const leaderKeys = {};

  let result;
  if (burnHeaderHashes) {
    const leaderKeysSelect = sortitionDb.prepare(`SELECT * FROM leader_keys WHERE burn_header_hash IN (${burnHeaderHashes.map(() => '?').join(',')})`);
    result = leaderKeysSelect.all(burnHeaderHashes);
  } else {
    const leaderKeysSelect = sortitionDb.prepare('SELECT * FROM leader_keys');
    result = leaderKeysSelect.all();
  }

  for (const row of result) {
    if (!leaderKeys[row.burn_header_hash]) leaderKeys[row.burn_header_hash] = [];
    leaderKeys[row.burn_header_hash].push(row);
  }

  return leaderKeys;
};

module.exports = {
  getAllSnapshots, getFollowingSnapshots, getSpecificSnapshots,
  getBlockCommits, getLeaderKeys,
};
