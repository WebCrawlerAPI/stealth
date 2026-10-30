# @webcrawlerapi/stealth

A **zero-dependency** stealth layer for Puppeteer (or any CDP-driven browser).
It installs anti-detection patches into the page **before any page script runs**,
so fingerprints are already clean by the time the target's own JS looks at them.

Works with **both** ways of driving Chrome:

- `puppeteer.launch()` — you start the browser
- `puppeteer.connect()` — you attach to a browser that is already running

The two functions you normally need are:

- **`installStealth(page, opts)`** — patches a page
- **`installOopifHook(browser, opts)`** — patches sandboxed / out-of-process iframes

## What it patches

| Vector | Patch |
|--------|-------|
| `Function.prototype.toString` + anonymous injected globals | native-looking `toString` via a `WeakSet` cloak |
| `navigator.webdriver` | deleted + faked to `false` |
| WebDriver / Selenium / Playwright residue (`cdc_*`, `__webdriver_*`, `__selenium_*`, `__pw*`, `__playwright_*`) | removed |
| `navigator.languages / platform / hardwareConcurrency / deviceMemory / vendor / onLine` | normalized |
| `window.chrome` (`runtime`, `loadTimes`, `csi`, `app`) | faked when missing |
| `navigator.userAgentData` (`brands`, `getHighEntropyValues`) | faked |
| `navigator.plugins` / `mimeTypes` (when empty) | faked |
| `navigator.permissions.query` | notifications → `default` |
| WebGL `UNMASKED_VENDOR_WEBGL` / `UNMASKED_RENDERER_WEBGL` | spoofed (hides SwiftShader / software GL) |
| `matchMedia` pointer / hover | normalized |
| `window.outerWidth` / `outerHeight` | corrected to inner + chrome |
| `Error.prepareStackTrace` | installed if absent |

---

## Install (without npm)

There is nothing to fetch from the npm registry — the whole module is a single
dependency-free file. Use whichever fits:

### Option 1 — clone the repo

```sh
git clone https://github.com/WebCrawlerAPI/stealth.git
cp stealth/stealth.js /your/project/
```

### Option 2 — single-file download

```sh
# install.sh ships with the repo
GH_TOKEN=ghp_xxx sh install.sh            # writes ./stealth.js

# or, by hand (the repo is private → token required)
curl -fsSL \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github.raw" \
  "https://api.github.com/repos/WebCrawlerAPI/stealth/contents/stealth.js?ref=master" \
  -o stealth.js
```

Then:

```js
const stealth = require('./stealth.js');
```

No `npm install`, no transitive dependencies. (A `package.json` is included for
projects that *do* use npm, but it declares **no dependencies**.)

---

## Quick start

```js
const stealth = require('./stealth.js');

const browser = await /* your browser */;
const page = await browser.newPage();

await stealth.installStealth(page, {});   // 1. register patches (BEFORE goto)
stealth.installOopifHook(browser, {});    // 2. patch sandboxed iframes too

await page.goto(url);                     // 3. navigate
```

> Order matters: `installStealth` uses `page.evaluateOnNewDocument`, so it must
> run **before** the navigation you want patched.

---

## Usage with `launch()`

If you start the browser yourself, use the bundled helper (it needs puppeteer —
pass it in or have it resolvable):

```js
const puppeteer = require('puppeteer-core');
const stealth = require('./stealth.js');

const browser = await stealth.launch({
  puppeteer,                              // or it is required lazily
  executablePath: '/usr/bin/google-chrome',
  headless: false,
  userDataDir: '/tmp/my-profile',         // use a FRESH profile
});

const page = await stealth.newPage(browser, { origin: 'https://example.com' });
await page.goto('https://example.com');
```

`newPage()` is shorthand for `browser.newPage()` + `installStealth()` +
`installOopifHook()`.

## Usage with `connect()`

This is the case when you attach to an already-running browser (e.g. one started
with `--remote-debugging-port=9222`, or a browser on a server / remote desktop):

```js
const puppeteer = require('puppeteer-core');
const stealth = require('./stealth.js');

const browser = await puppeteer.connect({
  browserURL: 'http://127.0.0.1:9222',    // or browserWSEndpoint: 'ws://...'
});

const page = await browser.newPage();
await stealth.installStealth(page, {});   // MUST run before goto()
stealth.installOopifHook(browser, {});

await page.goto('https://example.com');
// ...do work...
await page.close();
browser.disconnect();                     // do NOT close() a browser you didn't start
```

### If the page is already loaded

`installStealth()` only affects **future** documents. When you attach to a page
that is already on the target URL, also patch the current document and reload:

```js
await stealth.installStealth(page, {});   // future navigations
await stealth.injectNow(page);            // current document
await page.reload({ waitUntil: 'domcontentloaded' });
```

---

## API

### `await installStealth(page, opts?)`
Registers the bootstrap for every document the page loads from now on.
Must be called **before** the navigation you want patched.
Returns the page.

### `installOopifHook(browser, opts?)`
Hooks `targetcreated` and injects the bootstrap into out-of-process / sandboxed
iframes (which get their own CDP target and are **not** covered by
page-level `evaluateOnNewDocument`). Idempotent. Returns the browser.

### `await injectNow(page, opts?)`
Runs the bootstrap in the page's **current** document. Use after `connect()`
when the page is already loaded, then reload.

### `await newPage(browser, opts?)`
`browser.newPage()` + `installStealth` + `installOopifHook`.

### `buildSource(opts?)`
Returns the bootstrap as a **string** — handy for a raw CDP call:

```js
await session.send('Page.addScriptToEvaluateOnNewDocument', {
  source: stealth.buildSource({}),
  runImmediately: true,
});
```

### `await humanMouse(page, points)`
Tiny human-ish mouse helper: `[{ x, y, steps?, click?, delay? }, ...]`.

### `await launch(opts?)`
Optional launcher. Requires puppeteer via `opts.puppeteer` or resolved lazily
(`puppeteer-core`, then `puppeteer`). Never touched unless you call it.

## Options (`opts`)

| Key | Default | Used by |
|-----|---------|---------|
| `webglRenderer` / `renderer` | `ANGLE (Intel, ...)` | all |
| `webglVendor` / `vendor` | `Google Inc. (Intel)` | all |
| `hardwareConcurrency` | `8` | all |
| `deviceMemory` | `8` | all |
| `platform` | `Linux x86_64` | all |
| `origin` / `permissions` | — | `newPage` |
| `puppeteer` | lazily resolved | `launch` |
| `executablePath` | `$CHROME_PATH` | `launch` |
| `headless` | `false` | `launch` |
| `userDataDir` | `~/.cache/chrome-stealth-profile` | `launch` |
| `args` | `[]` | `launch` |

---

## Verify it is working

```js
await stealth.installStealth(page, {});
await page.goto('about:blank');
console.log(await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl');
  const e = c.getExtension('WEBGL_debug_renderer_info');
  return {
    webdriver: navigator.webdriver,                          // false
    plugins: navigator.plugins.length,                        // > 0
    gl: [c.getParameter(e.UNMASKED_VENDOR_WEBGL)],            // not "SwiftShader"
  };
}));
```

## Troubleshooting

- **Still detected after `connect()`** — you probably called `goto()` before
  `installStealth()`. Install first, then navigate (or use `injectNow()` + reload).
- **Fresh vs reused profile** — a persistent profile can carry a *stale, already
  flagged* cookie for the target. Test with a brand-new `userDataDir` to rule
  that out.
- **Software WebGL** — servers with no GPU report SwiftShader. The WebGL patch
  hides this in the page, but make sure `installStealth` actually ran.
- **Sandboxed iframes** — if the challenge runs in a `<iframe sandbox>`, make
  sure `installOopifHook(browser)` was called.

## License

MIT
