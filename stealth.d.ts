export interface StealthOptions {
  /** WebGL UNMASKED_RENDERER_WEBGL value to report. */
  webglRenderer?: string;
  /** WebGL UNMASKED_VENDOR_WEBGL value to report. */
  webglVendor?: string;
  /** navigator.hardwareConcurrency override. */
  hardwareConcurrency?: number;
  /** navigator.deviceMemory override. */
  deviceMemory?: number;
  /** navigator.platform override. */
  platform?: string;
  /** Launch only: injected puppeteer instance. */
  puppeteer?: unknown;
  /** Launch only: chrome executable. */
  executablePath?: string;
  /** Launch only. */
  headless?: boolean;
  /** Launch only: profile dir. */
  userDataDir?: string;
  /** Launch only: extra chrome args. */
  args?: string[];
  /** Explicit User-Agent for the page. Default: browser UA with "HeadlessChrome" replaced by "Chrome". */
  userAgent?: string;
  /** Set to false to skip the User-Agent fix. Default true. */
  fixUserAgent?: boolean;
  /** newPage only: origin for overridePermissions. */
  origin?: string;
  /** newPage only: permissions to grant. */
  permissions?: string[];
}

/** Minimal structural types so the module has no puppeteer dependency. */
export interface PageLike {
  evaluateOnNewDocument(fn: unknown, arg?: unknown): Promise<unknown>;
  evaluate(fnOrSource: unknown): Promise<unknown>;
  mouse: {
    move(x: number, y: number, opts?: { steps?: number }): Promise<void>;
    down(): Promise<void>;
    up(): Promise<void>;
  };
}

export interface BrowserLike {
  on(event: string, listener: (target: any) => void): unknown;
  newPage(): Promise<PageLike>;
  defaultBrowserContext?(): { overridePermissions(origin: string, permissions: string[]): Promise<void> };
}

export declare const VERSION: string;
export declare const UA: string;
export declare function buildInitScript(cfg?: StealthOptions): void;
export declare function buildSource(opts?: StealthOptions): string;
export declare function installStealth(page: PageLike, opts?: StealthOptions): Promise<PageLike>;
export declare function fixUserAgent(page: PageLike, opts?: StealthOptions): Promise<PageLike>;
export declare function injectNow(page: PageLike, opts?: StealthOptions): Promise<PageLike>;
export declare function installOopifHook(browser: BrowserLike, opts?: StealthOptions): BrowserLike;
export declare function newPage(browser: BrowserLike, opts?: StealthOptions): Promise<PageLike>;
export declare function humanMouse(page: PageLike, points: Array<{ x: number; y: number; steps?: number; click?: boolean; delay?: number }>): Promise<void>;
export declare function getPuppeteer(injected?: unknown): any;
export declare function launch(opts?: StealthOptions): Promise<BrowserLike>;
