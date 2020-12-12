const fs = require('fs');

const CSV_HEAD = 'block_height,total_burn,pred_total_burn,burn,won';

const getCsvRow = (obj) => {
  const predTotalBurn = obj.predTotalBurn || 'N/A';
  return `${obj.blockHeight},${obj.totalBurn},${predTotalBurn},${obj.burn},${obj.won}`;
};

const writeJson = (fpath, data) => {
  fs.writeFile(fpath, JSON.stringify(data), (error) => {
    if (error) console.log('writeJson has an error: ', error);
    else console.log('writeJson done.');
  });
};

const writeCsv = (fpath, rows) => {

  const texts = [CSV_HEAD];
  for (const row of rows) {
    texts.push(getCsvRow(row));
  }

  fs.writeFile(fpath, texts.join('\n'), (error) => {
    if (error) console.log('writeCsv has an error: ', error);
    else console.log('writeCsv done.');
  });
};

module.exports = { writeJson, writeCsv };
