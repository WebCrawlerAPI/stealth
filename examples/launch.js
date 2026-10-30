'use strict';
// Launch a fresh browser with the stealth layer (no `npm install` needed if
// you already have puppeteer/puppeteer-core somewhere on NODE_PATH).
//
//   node examples/launch.js https://example.com
const puppeteer = require('puppeteer-core');
const stealth = require('../stealth.js');

const url = process.argv[2] || 'about:blank';

(async () => {
  const browser = await stealth.launch({ headless: false, puppeteer });
  const page = await stealth.newPage(browser);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('title:', JSON.stringify(await page.title()));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
