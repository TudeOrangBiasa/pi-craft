import {
  FileFinder as FileFinderClass,
  type FileFinderApi,
  type InitOptions,
  type Result,
} from "@ff-labs/fff-node";

// waitForScan() also resolves on timeout, so this bounds startup rather than
// guaranteeing a complete index.
const SCAN_TIMEOUT_MS = 15_000;

export interface PickerOptions {
  basePath: string;
  enableHomeDirScanning?: boolean;
  enableFsRootScanning?: boolean;
}

/** Opens every picker in this pi process — the cwd picker and the aux pickers —
 * on the same frecency/history databases. */
export class FilePickerFactory {
  private dbDisabled = false;
  private readonly frecencyDbPath: string;
  private readonly historyDbPath: string;
  private readonly onDbFailure?: (error: string) => void;

  constructor(opts: {
    frecencyDbPath: string;
    historyDbPath: string;
    onDbFailure?: (error: string) => void;
  }) {
    this.frecencyDbPath = opts.frecencyDbPath;
    this.historyDbPath = opts.historyDbPath;
    this.onDbFailure = opts.onDbFailure;
  }

  /** True once the databases were given up on, so pickers open without them. */
  get databasesDisabled(): boolean {
    return this.dbDisabled;
  }

  /** Opens a scanned, ready-to-use picker. Throws if it cannot be created. */
  async create(options: PickerOptions): Promise<FileFinderApi> {
    const result = this.openWithDbFallback(FileFinderClass, options);

    if (result.ok === false) {
      throw new Error(
        `Failed to create FFF file picker for ${options.basePath}: ${result.error}`,
      );
    }

    await result.value.waitForScan(SCAN_TIMEOUT_MS);
    return result.value;
  }

  private openWithDbFallback(
    FileFinder: typeof FileFinderClass,
    options: PickerOptions,
  ): Result<FileFinderApi> {
    const init: InitOptions = { ...options, aiMode: true };
    if (this.dbDisabled) return FileFinder.create(init);

    const result = FileFinder.create({
      ...init,
      frecencyDbPath: this.frecencyDbPath,
      historyDbPath: this.historyDbPath,
    });
    if (result.ok === false) {
      // A failure here is usually transient (broken lock, corruption) and
      // self-heals on restart, so drop the databases instead of leaving pi
      // without a picker.
      const dbLess = FileFinder.create(init);
      if (dbLess.ok === false) return result; // db error is the more useful one
      this.dbDisabled = true;
      this.onDbFailure?.(result.error);
      return dbLess;
    }
    return result;
  }
}
