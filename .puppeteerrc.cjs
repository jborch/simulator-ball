// Puppeteer downloads its Chrome into the project (not the user's home), so the server finds it
// whichever account it runs under (e.g. a Windows service). Used by the RTSP camera streams.
const { join } = require('node:path');

module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
  // Only the full Chrome (new headless mode, better GPU support) is used.
  'chrome-headless-shell': { skipDownload: true },
};
