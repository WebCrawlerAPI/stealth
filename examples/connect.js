'use strict';
// Attach to an already-running browser and patch it before navigating.
//
//   node examples/connect.js ws://127.0.0.1:9222/devtools/browser/<id>
//   node examples/connect.js http://127.0.0.1:9222
//   node examples/connect.js http://127.0.0.1:9222 https://example.com
const puppeteer = require('puppeteer-core');
const stealth = require('../stealth.js');

const endpoint = process.argv[2] || 'http://127.0.0.1:9222';
const url = process.argv[3] || 'about:blank';

(async () => {
  const connectOpts = endpoint.startsWith('ws')
    ? { browserWSEndpoint: endpoint }
    : { browserURL: endpoint };

  const browser = await puppeteer.connect(connectOpts);
  try {
    const page = await browser.newPage();
    await stealth.installStealth(page, {});
    stealth.installOopifHook(browser, {});
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('title:', JSON.stringify(await page.title()));
    await page.close();
  } finally {
    browser.disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
