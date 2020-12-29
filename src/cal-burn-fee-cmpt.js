
/*
  cost < revenue

  cost = (btcFee + burnFee) * N (+ transferFee + exchangeFee + serverFee)
  revenue = stxReward * winChance * N

  btcFee = btcFeeRate * bytes * nTransactions
  burnFee = burn * satoshiPrice
  stxReward = (stxMints + stxGas) * stxPrice
  winChance = burn / totalBurn

  (btcFee + burnFee) * N < stxReward * winChance * N

  Risks of exchange rates
*/

//const burn = 20000; // satoshi/block
//const totalBurn = 4000000; // satoshi/block

const btcPrice = 25000; // usd/btc
const satoshiPrice = btcPrice / 100000000; // usd/satoshi
const stxPrice = 0.37; // usd/stx

const btcFeeRate = 22; // satoshi/byte
const bytes = 250; // bytes/transaction
const nTransactions = 2;

const stxMints = 1000; // stx/block
const stxGas = 0;

let btcFee = btcFeeRate * bytes * nTransactions; // satoshi/block
btcFee = btcFee * satoshiPrice; // usd/block

let stxReward = stxMints + stxGas; // stx/block
stxReward = stxReward * stxPrice; // usd/block

const getMaxTotalBurn = (burn) => {
  const totalBurn = (stxReward * burn) / (btcFee + (burn * satoshiPrice));
  return totalBurn;
};

const getMinBurnFee = (totalBurn) => {
  const burn = btcFee / ((stxReward / totalBurn) - satoshiPrice);
  return burn;
};

const main = () => {

};

main();
