const axios = require('axios').default;
const { getDateTime } = require('./utils');

const BTC_ADDRESS = 'mtoqRNSz8sXLPz4hdcGGZJbgeReW616wRj';

const BTC_BALANCE_URL = 'https://stacks-node-api.krypton.blockstack.org/extended/v1/faucets/btc/';
const BTC_RETRIEVE_URL = 'https://stacks-node-api.krypton.blockstack.org/extended/v1/faucets/btc?address=';

const BTC_MIN_THRESHOLD = 0.2;
const MAINTENANCE_INTERVAL = 0.5 * 60 * 60 * 1000;

const getBtcBalance = async (btcAddress) => {
  const res = await axios.get(BTC_BALANCE_URL + btcAddress);
  return res.data.balance;
};

const retrieveBtc = async (btcAddress) => {
  const res = await axios.post(BTC_RETRIEVE_URL + btcAddress);
  return res.data.success;
};

const runLoop = async () => {
  console.log(`Do the maintenance at ${getDateTime()}.`);

  try {
    const btcBalance = await getBtcBalance(BTC_ADDRESS);
    console.log(`Btc balance is ${btcBalance}.`);

    if (btcBalance < BTC_MIN_THRESHOLD) {
      console.log(`The balance is less than the threshold: ${BTC_MIN_THRESHOLD}.`);
      const res = await retrieveBtc(BTC_ADDRESS);
      console.log(`Retrive new Btc success result is ${res}`);
    } else {
      console.log(`The balance is more than the threshold: ${BTC_MIN_THRESHOLD}.`);
    }
  } catch (error) {
    console.log(`Cannot connect to stacks api with error: ${error}`);
  }

  console.log(`Wait for ${MAINTENANCE_INTERVAL / 1000 / 60} mins for the next maintenance.`);
  setTimeout(runLoop, MAINTENANCE_INTERVAL);
};

console.log('Start running...');
runLoop();
