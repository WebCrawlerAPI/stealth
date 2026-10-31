'use strict';

/**
 * @webcrawlerapi/stealth
 * Zero-dependency stealth layer for Puppeteer / any CDP-driven browser.
 *
 * Works with BOTH puppeteer.launch() and puppeteer.connect():
 *
 *   const stealth = require('./stealth.js');
 *   const page = await browser.newPage();      // or reuse an existing page
 *   await stealth.installStealth(page, {});    // BEFORE any goto()
 *   stealth.installOopifHook(browser, {});     // patches sandboxed iframes too
 *   await page.goto(url);
 *
 * There are no runtime dependencies. Puppeteer is only required if you use
 * the optional `launch()` helper, and even then it is looked up lazily or can
 * be injected via `opts.puppeteer`.
 */

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

const VERSION = '1.0.1';

/* ------------------------------------------------------------------ *
 * The in-page bootstrap. Runs inside every document before page JS.  *
 * Serialized by evaluateOnNewDocument() / addScriptToEvaluateOnNewDocument()
 * so it must be fully self-contained (no closure over this module).
 * ------------------------------------------------------------------ */
function buildInitScript(cfg) {
  cfg = cfg || {};

  // One coherent profile per OS family. The values inside a profile are chosen
  // together so the platform string, UA-CH hints, WebGL strings and geometry
  // all agree with each other *and* with the real Chrome build running the page.
  // (A Windows-only renderer like "Direct3D11" on a Linux platform is a
  // contradiction a fingerprinting script can spot, so we never mix families.)
  const PROFILES = {
    windows: {
      platform: 'Win32',
      uaPlatform: 'Windows',
      platformVersion: '10.0.0',
      architecture: 'x86',
      bitness: '64',
      renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      vendor: 'Google Inc. (Intel)',
    },
    mac: {
      platform: 'MacIntel',
      uaPlatform: 'macOS',
      platformVersion: '15.0.0',
      architecture: 'arm',
      bitness: '64',
      renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)',
      vendor: 'Google Inc. (Apple)',
    },
    linux: {
      platform: 'Linux x86_64',
      uaPlatform: 'Linux',
      platformVersion: '',
      architecture: 'x86',
      bitness: '64',
      renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6 (Core Profile) Mesa 22.0.5)',
      vendor: 'Google Inc. (Intel)',
    },
  };

  // Derive everything from the real browser so the profile can never drift
  // away from the engine that is actually running.
  const realUA = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const chromeVer = (realUA.match(/Chrome\/(\d+)/) || [])[1] || '120';
  const fullVersion = chromeVer + '.0.0.0';
  const osFamily = /Windows/i.test(realUA)
    ? 'windows'
    : /Macintosh|Mac OS X/i.test(realUA)
      ? 'mac'
      : 'linux';
  const profile = PROFILES[osFamily];

  // Optional overrides. Anything not supplied keeps the host's real value, so
  // the page never contradicts the machine it is running on.
  const renderer = cfg.renderer || profile.renderer;
  const vendor = cfg.vendor || profile.vendor;
  const languages = cfg.languages;

  const patched = new WeakSet();

  try { Object.defineProperty(window, '__stealth_ts', { value: Date.now(), configurable: true }); } catch (_) {}

  // --- native-looking Function.prototype.toString ---
  const origToString = Function.prototype.toString;
  const fakeToString = function toString() {
    if (patched.has(this)) {
      const name = (this && this.name) || '';
      return 'function ' + name + '() { [native code] }';
    }
    return origToString.call(this);
  };
  patched.add(fakeToString);
  try { Object.defineProperty(fakeToString, 'name', { value: 'toString' }); } catch (_) {}
  try { Object.defineProperty(fakeToString, 'length', { value: 0 }); } catch (_) {}
  Object.defineProperty(Function.prototype, 'toString', {
    value: fakeToString,
    writable: true,
    configurable: true,
  });

  function cloak(fn, name) {
    if (typeof fn !== 'function') return fn;
    patched.add(fn);
    try {
      if (name) Object.defineProperty(fn, 'name', { value: name, configurable: true });
      Object.defineProperty(fn, 'length', { value: fn.length, configurable: true });
    } catch (_) {}
    return fn;
  }

  function getter(obj, prop, value, name) {
    const get = cloak(function () { return value; }, 'get ' + (name || prop));
    Object.defineProperty(obj, prop, {
      get,
      set: undefined,
      enumerable: true,
      configurable: true,
    });
  }

  // --- navigator.webdriver ---
  try { delete Navigator.prototype.webdriver; } catch (_) {}
  try { getter(Navigator.prototype, 'webdriver', false, 'webdriver'); } catch (_) {}

  // --- window.chrome ---
  if (!window.chrome || typeof window.chrome !== 'object') window.chrome = {};
  if (!window.chrome.runtime) {
    Object.defineProperty(window.chrome, 'runtime', {
      value: {
        connect: cloak(function connect() {}, 'connect'),
        sendMessage: cloak(function sendMessage() {}, 'sendMessage'),
        id: undefined,
      },
      configurable: true,
    });
  }
  if (!window.chrome.loadTimes) {
    Object.defineProperty(window.chrome, 'loadTimes', {
      value: cloak(function loadTimes() {
        return { requestTime: 0, startLoadTime: 0, commitLoadTime: 0, finishLoadTime: 0, navigationType: 'Other', wasNpnNegotiated: false, npnNegotiatedProtocol: 'unknown', wasAlternateProtocolAvailable: false, connectionInfo: 'unknown' };
      }, 'loadTimes'),
      configurable: true,
    });
  }
  if (!window.chrome.csi) {
    Object.defineProperty(window.chrome, 'csi', {
      value: cloak(function csi() { return { onloadT: Date.now(), startE: Date.now(), pageT: 1, tran: 15 }; }, 'csi'),
      configurable: true,
    });
  }
  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    };
  }

  // --- navigator.languages / language (only when the caller asked for it) ---
  // Overriding these while leaving the Accept-Language request header alone
  // would make the JS view disagree with the network view.
  if (Array.isArray(languages) && languages.length) {
    try { getter(Navigator.prototype, 'languages', Object.freeze(languages.slice()), 'languages'); } catch (_) {}
    try { getter(Navigator.prototype, 'language', languages[0], 'language'); } catch (_) {}
  }

  // --- platform / vendor / hardware ---
  // These already match the real engine, so they are left untouched unless an
  // explicit override is supplied. Forcing a value the host does not actually
  // have (e.g. hardwareConcurrency 8 on a 4-core box) is itself a tell.
  if (cfg.platform) {
    try { getter(Navigator.prototype, 'platform', cfg.platform, 'platform'); } catch (_) {}
  }
  if (cfg.hardwareConcurrency) {
    try { getter(Navigator.prototype, 'hardwareConcurrency', cfg.hardwareConcurrency, 'hardwareConcurrency'); } catch (_) {}
  }
  if (cfg.deviceMemory) {
    try { getter(Navigator.prototype, 'deviceMemory', cfg.deviceMemory, 'deviceMemory'); } catch (_) {}
  }

  // --- plugins / mimeTypes (only when empty) ---
  try {
    if (!navigator.plugins || navigator.plugins.length === 0) {
      function mkMime(type, suffixes, description) {
        return { type, suffixes, description, enabledPlugin: null };
      }
      const pluginDefs = [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', mimes: [
          { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
          { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
        ]},
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', mimes: [
          { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
          { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
        ]},
      ];
      const plugins = [];
      const mimes = [];
      for (const p of pluginDefs) {
        const plugin = { name: p.name, filename: p.filename, description: p.description, length: p.mimes.length };
        p.mimes.forEach((m, i) => {
          const mm = mkMime(m.type, m.suffixes, m.description);
          mm.enabledPlugin = plugin;
          plugin[i] = mm;
          if (!mimes.some((x) => x.type === m.type)) mimes.push(mm);
        });
        plugins.push(plugin);
      }
      plugins.item = cloak(function item(i) { return this[i] || null; }, 'item');
      plugins.namedItem = cloak(function namedItem() { return null; }, 'namedItem');
      plugins.refresh = cloak(function refresh() {}, 'refresh');
      mimes.item = cloak(function item(i) { return this[i] || null; }, 'item');
      mimes.namedItem = cloak(function namedItem() { return null; }, 'namedItem');
      Object.defineProperty(plugins, 'length', { value: pluginDefs.length });
      Object.defineProperty(mimes, 'length', { value: mimes.length });
      try {
        const pProto = Object.getPrototypeOf(navigator.plugins);
        Object.defineProperty(pProto, 'item', { value: cloak(function item(i) { return this[i] || null; }, 'item'), writable: true, configurable: true });
        Object.defineProperty(pProto, 'namedItem', { value: cloak(function namedItem() { return null; }, 'namedItem'), writable: true, configurable: true });
        Object.defineProperty(pProto, 'refresh', { value: cloak(function refresh() {}, 'refresh'), writable: true, configurable: true });
        const mProto = Object.getPrototypeOf(navigator.mimeTypes);
        Object.defineProperty(mProto, 'item', { value: cloak(function item(i) { return this[i] || null; }, 'item'), writable: true, configurable: true });
        Object.defineProperty(mProto, 'namedItem', { value: cloak(function namedItem() { return null; }, 'namedItem'), writable: true, configurable: true });
      } catch (_) {}
      getter(Navigator.prototype, 'plugins', plugins, 'plugins');
      getter(Navigator.prototype, 'mimeTypes', mimes, 'mimeTypes');
    }
  } catch (_) {}

  // --- permissions ---
  try {
    const origQuery = navigator.permissions.query.bind(navigator.permissions);
    const query = cloak(function query(params) {
      if (params && params.name === 'notifications') {
        return Promise.resolve({ state: 'default', name: 'notifications', onchange: null });
      }
      return origQuery(params);
    }, 'query');
    try {
      Object.defineProperty(Permissions.prototype, 'query', { value: query, writable: true, configurable: true });
    } catch (_) {
      navigator.permissions.query = query;
    }
  } catch (_) {}

  // --- userAgentData ---
  // When the engine exposes UA-CH it is already consistent with the UA string
  // and the sec-ch-ua headers, so it is left alone. The synthetic object is only
  // built when it is genuinely missing, and then from the same profile.
  try {
    if (!navigator.userAgentData) {
      const grease = '24';
      const brands = [
        { brand: 'Chromium', version: chromeVer },
        { brand: 'Google Chrome', version: chromeVer },
        { brand: 'Not?A_Brand', version: grease },
      ];
      const fullVersionList = [
        { brand: 'Chromium', version: fullVersion },
        { brand: 'Google Chrome', version: fullVersion },
        { brand: 'Not?A_Brand', version: grease + '.0.0.0' },
      ];
      const highEntropy = {
        architecture: profile.architecture,
        bitness: profile.bitness,
        brands,
        fullVersionList,
        mobile: false,
        model: '',
        platform: profile.uaPlatform,
        platformVersion: profile.platformVersion,
        uaFullVersion: fullVersion,
        wow64: false,
      };
      const data = {
        brands, mobile: false, platform: profile.uaPlatform,
        getHighEntropyValues: cloak(function getHighEntropyValues(hints) {
          const out = { brands, mobile: false, platform: profile.uaPlatform };
          (hints || []).forEach((h) => { if (h in highEntropy) out[h] = highEntropy[h]; });
          return Promise.resolve(out);
        }, 'getHighEntropyValues'),
        toJSON: cloak(function toJSON() { return { brands, mobile: false, platform: profile.uaPlatform }; }, 'toJSON'),
      };
      getter(Navigator.prototype, 'userAgentData', data, 'userAgentData');
    }
  } catch (_) {}

  // --- WebGL vendor / renderer ---
  // Spoofing is applied only when software rendering is detected (SwiftShader /
  // llvmpipe / Mesa OffScreen) or the caller explicitly asked for it. When the
  // engine already reports a real GPU we leave it alone: swapping a real, coherent
  // renderer for a different one only creates contradictions.
  try {
    let softwareGL = false;
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl') || probe.getContext('experimental-webgl');
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const real = dbg
          ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '')
          : String(gl.getParameter(gl.RENDERER) || '');
        softwareGL = /swiftshader|llvmpipe|software|mesa offscreen|angle \(google/i.test(real);
      }
    } catch (_) {}

    if (softwareGL || cfg.renderer || cfg.vendor) {
      for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
        const Ctor = window[name];
        if (!Ctor || !Ctor.prototype) continue;
        const origGetParameter = Ctor.prototype.getParameter;
        const origGetExtension = Ctor.prototype.getExtension;
        const getParameter = cloak(function getParameter(p) {
          if (p === 37445) return vendor;
          if (p === 37446) return renderer;
          return origGetParameter.call(this, p);
        }, 'getParameter');
        const getExtension = cloak(function getExtension(n) {
          if (n === 'WEBGL_debug_renderer_info') {
            return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
          }
          return origGetExtension.call(this, n);
        }, 'getExtension');
        Object.defineProperty(Ctor.prototype, 'getParameter', { value: getParameter, writable: true, configurable: true });
        Object.defineProperty(Ctor.prototype, 'getExtension', { value: getExtension, writable: true, configurable: true });
      }
    }
  } catch (_) {}

  // --- remove automation residue globals ---
  try {
    const keys = [
      'cdc_adoQpoasnfa76pfcZLmcfl_Array', 'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
      'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
      '__webdriver_evaluate', '__selenium_evaluate', '__fxdriver_evaluate',
      '__driver_evaluate', '__webdriver_script_function', '__webdriver_script_func',
      '__webdriver_script_fn', '__webdriverFunc', '_WEBDRIVER_ELEM_CACHE',
      'domAutomation', 'domAutomationController', '__lastWatirAlert',
      '__lastWatirConfirm', '__lastWatirPrompt', '__playwright_builtins__',
      '__pwInitScripts', '__playwright__binding__', '__pwWebSocketDispatch',
      '__playwright__binding__controller__',
    ];
    for (const k of keys) {
      try {
        if (k in window) delete window[k];
        if (k in document) delete document[k];
      } catch (_) {}
    }
    try { if (navigator.webdriver) delete navigator.webdriver; } catch (_) {}
  } catch (_) {}

  // --- Error.prepareStackTrace integrity ---
  try {
    if (typeof Error.prepareStackTrace !== 'function') {
      Object.defineProperty(Error, 'prepareStackTrace', {
        value: cloak(function prepareStackTrace(err, stack) {
          return String(err) + '\n' + stack.map((s) => '    at ' + s.toString()).join('\n');
        }, 'prepareStackTrace'),
        writable: true,
        configurable: true,
      });
    }
  } catch (_) {}

  // --- matchMedia: pointer / hover ---
  try {
    const OVERRIDES = {
      'any-pointer: fine': true, 'any-pointer: coarse': false, 'any-pointer: none': false,
      'pointer: fine': true, 'pointer: coarse': false, 'pointer: none': false,
      'any-hover: hover': true, 'any-hover: none': false,
      'hover: hover': true, 'hover: none': false,
    };
    const norm = (q) => String(q).toLowerCase().replace(/\s+/g, ' ').trim().replace(/^\(/, '').replace(/\)$/, '').trim();
    const orig = window.matchMedia.bind(window);
    const matchMedia = cloak(function matchMedia(query) {
      const mql = orig(query);
      const key = norm(query);
      if (Object.prototype.hasOwnProperty.call(OVERRIDES, key)) {
        const val = OVERRIDES[key];
        try {
          Object.defineProperty(mql, 'matches', { get: cloak(function () { return val; }, 'get matches'), configurable: true });
        } catch (_) {}
      }
      return mql;
    }, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', { value: matchMedia, writable: true, configurable: true });
  } catch (_) {}

  // --- window geometry drift ---
  // outerWidth/outerHeight must be >= the inner ones. Only correct the cases
  // that are actually broken instead of forcing a value that may contradict the
  // real window manager.
  try {
    const innerH = window.innerHeight || 900;
    const innerW = window.innerWidth || 1366;
    if (!window.outerWidth || window.outerWidth < innerW) getter(window, 'outerWidth', innerW + 16, 'outerWidth');
    if (!window.outerHeight || window.outerHeight < innerH) getter(window, 'outerHeight', innerH + 88, 'outerHeight');
  } catch (_) {}
}

/* ------------------------------------------------------------------ *
 * Public API                                                          *
 * ------------------------------------------------------------------ */

function resolveConfig(opts) {
  opts = opts || {};
  // Only carry explicit overrides. Defaults are resolved in-page from the real
  // browser (see buildInitScript) so the profile cannot contradict the engine.
  return {
    renderer: opts.webglRenderer || opts.renderer,
    vendor: opts.webglVendor || opts.vendor,
    hardwareConcurrency: opts.hardwareConcurrency,
    deviceMemory: opts.deviceMemory,
    platform: opts.platform,
    languages: opts.languages,
  };
}

/** Serialized source string for CDP `Page.addScriptToEvaluateOnNewDocument`. */
function buildSource(opts) {
  const cfg = resolveConfig(opts);
  return '(' + buildInitScript.toString() + ')(' + JSON.stringify(cfg) + ');';
}

const INSTALLED = Symbol.for('@webcrawlerapi/stealth.installed');

/**
 * Install the stealth bootstrap into a page. Call BEFORE the first goto().
 * Compatible with puppeteer.launch(), puppeteer.connect(), and any object
 * exposing `evaluateOnNewDocument(fn, arg)`.
 *
 * @returns {Promise<any>} the same page
 */
async function installStealth(page, opts) {
  if (!page || typeof page.evaluateOnNewDocument !== 'function') {
    throw new TypeError('installStealth(page): page must expose evaluateOnNewDocument()');
  }
  opts = opts || {};
  const cfg = resolveConfig(opts);
  await page.evaluateOnNewDocument(buildInitScript, cfg);
  await fixUserAgent(page, opts);
  try { page[INSTALLED] = true; } catch (_) {}
  return page;
}

/**
 * Headless Chrome announces itself as "HeadlessChrome/<ver>" in both the
 * `User-Agent` request header and navigator.userAgent. The header is set by the
 * network stack, so the in-page patches can't touch it; it has to go through
 * the CDP UA override (page.setUserAgent).
 *
 * The UA is read from the running browser (browser.userAgent()) instead of
 * being hardcoded, so the Chrome version always matches the real engine and
 * never goes stale when the bundled Chrome is upgraded.
 *
 *   opts.userAgent       explicit UA, used as is
 *   opts.fixUserAgent    set to false to skip
 *
 * No-op when the browser UA has no "HeadlessChrome" token (headful, connect()).
 */
async function fixUserAgent(page, opts) {
  opts = opts || {};
  if (opts.fixUserAgent === false || typeof page.setUserAgent !== 'function') return page;
  try {
    let ua = opts.userAgent;
    if (!ua) {
      const browser = typeof page.browser === 'function' ? page.browser() : null;
      if (!browser || typeof browser.userAgent !== 'function') return page;
      const current = await browser.userAgent();
      if (!/HeadlessChrome/.test(current)) return page;
      ua = current.replace('HeadlessChrome', 'Chrome');
    }
    await page.setUserAgent(ua);
  } catch (_) {}
  return page;
}

/**
 * Also inject the bootstrap into documents that are ALREADY loaded (useful when
 * you attach with connect() to a page that is already on the target URL).
 * The patches will not re-run on navigation unless installStealth() is used too.
 */
async function injectNow(page, opts) {
  if (!page || typeof page.evaluate !== 'function') {
    throw new TypeError('injectNow(page): page must expose evaluate()');
  }
  await page.evaluate(buildSource(opts));
  return page;
}

/**
 * Patch out-of-process / sandboxed iframes (DataDome's challenge runs there).
 * These get their own CDP target and are NOT covered by page-level
 * evaluateOnNewDocument.
 */
function installOopifHook(browser, opts) {
  if (!browser || typeof browser.on !== 'function') {
    throw new TypeError('installOopifHook(browser): browser must expose on()');
  }
  opts = opts || {};
  if (browser.__stealthOopifHooked) return browser;
  browser.__stealthOopifHooked = true;

  const source = buildSource(opts);
  browser.on('targetcreated', async (target) => {
    let type = 'unknown';
    try { type = target.type(); } catch (_) {}
    if (type === 'browser' || type === 'page' || type === 'service_worker') return;
    let session;
    try {
      session = await target.createCDPSession();
      await session.send('Page.enable').catch(() => {});
      await session.send('Page.addScriptToEvaluateOnNewDocument', { source, runImmediately: true }).catch(() => {});
      await session.send('Runtime.runIfWaitingForDebugger').catch(() => {});
    } catch (_) {}
  });
  return browser;
}

/** Convenience: open a page and patch it in one call. */
async function newPage(browser, opts) {
  if (!browser || typeof browser.newPage !== 'function') {
    throw new TypeError('newPage(browser): browser must expose newPage()');
  }
  opts = opts || {};
  const context = typeof browser.defaultBrowserContext === 'function' ? browser.defaultBrowserContext() : null;
  if (context && opts.origin && typeof context.overridePermissions === 'function') {
    await context.overridePermissions(opts.origin, opts.permissions || []).catch(() => {});
  }
  const page = await browser.newPage();
  await installStealth(page, opts);
  installOopifHook(browser, opts);
  return page;
}

async function humanMouse(page, points) {
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    await page.mouse.move(p.x, p.y, { steps: p.steps || 12 });
    if (p.click) { await page.mouse.down(); await page.mouse.up(); }
    await new Promise((r) => setTimeout(r, p.delay == null ? 40 : p.delay));
  }
}

/** Lazily resolve a puppeteer module (never required unless launch() is used). */
function getPuppeteer(injected) {
  if (injected) return injected;
  for (const name of ['puppeteer-core', 'puppeteer']) {
    try { return require(name); } catch (_) {}
  }
  throw new Error('launch() needs puppeteer; pass opts.puppeteer or install puppeteer/puppeteer-core');
}

/** Optional launcher. Requires puppeteer only when actually called. */
async function launch(opts) {
  opts = opts || {};
  const puppeteer = getPuppeteer(opts.puppeteer);
  const os = require('os');
  const path = require('path');
  const args = opts.args || [];
  const browser = await puppeteer.launch({
    executablePath: opts.executablePath || process.env.CHROME_PATH || undefined,
    headless: opts.headless != null ? opts.headless : false,
    userDataDir: opts.userDataDir || path.join(os.homedir(), '.cache', 'chrome-stealth-profile'),
    defaultViewport: opts.viewport || { width: 1366, height: 900 },
    protocolTimeout: opts.protocolTimeout || 180000,
    ignoreDefaultArgs: ['--enable-automation', '--headless'],
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1366,900',
      '--lang=en-US',
      ...args,
    ],
  });
  return browser;
}

module.exports = {
  VERSION,
  UA,
  buildInitScript,
  buildSource,
  installStealth,
  fixUserAgent,
  injectNow,
  installOopifHook,
  newPage,
  humanMouse,
  getPuppeteer,
  launch,
};
