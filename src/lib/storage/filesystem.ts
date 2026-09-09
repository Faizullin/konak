import {
  StorageNotImplementedError,
  StorageProvider,
  type StorageCapabilities,
  type StorageObject,
  type UploadLimits,
  type UploadTicket,
} from "./provider";

/**
 * A directory on disk. The development default, and a sound answer for a
 * single-box deployment — a hotel with one server and a backup job.
 *
 * The only provider that cannot do direct upload, and the reason `ticket()`
 * returns `null` instead of throwing: the caller falls back to posting at our
 * own route handler, which is a branch it already has to have.
 *
 * `privateObjects` is true in the strongest sense — nothing serves this
 * directory but us, so reads pass through a route handler that checks
 * membership first. It must sit **outside** `public/`, or Next serves it to
 * anyone and every guarantee here is void.
 */
export type FilesystemConfig = {
  /** Absolute, and outside `public/`. */
  root: string;
  /** The route that streams a stored file back, e.g. `/api/uploads`. */
  servePath: string;
};

export class FilesystemStorage extends StorageProvider {
  readonly name = "filesystem";

  readonly capabilities: StorageCapabilities = {
    directUpload: false,
    privateObjects: true,
    signedReads: false,
  };

  constructor(private readonly config: FilesystemConfig) {
    super();
  }

  /**
   * `mkdir` the key's directory, then `writeFile`. The key is checked against
   * `isUnguessableStorageKey` by the caller, and resolved against `root` with a
   * prefix assertion here — a key containing `..` must not escape the root,
   * whatever validated it upstream.
   */
  put(_key: string, _body: Buffer, _meta: { mimeType: string }): Promise<StorageObject> {
    throw new StorageNotImplementedError(this.name, "put");
  }

  /** Always `null`. There is no address a browser could post to but ours. */
  async ticket(_key: string, _limits: UploadLimits): Promise<UploadTicket | null> {
    return null;
  }

  /**
   * `stat()` for the size. The mime type is not on disk, so it comes from the
   * row — the one place this provider cannot observe what it stores, and worth
   * knowing before choosing it for anything a stranger uploads.
   */
  stat(_providerId: string): Promise<StorageObject | null> {
    throw new StorageNotImplementedError(this.name, "stat");
  }

  /**
   * `${servePath}/${providerId}`, which is a route handler and not a file URL.
   * It does not expire; the check happens per request instead, which is
   * stricter than a TTL — access revoked at noon stops working at noon.
   */
  url(_providerId: string, _ttlSeconds: number): Promise<string> {
    throw new StorageNotImplementedError(this.name, "url");
  }

  /** `rm` with `force`, so removing a file that is already gone is not an error. */
  remove(_providerId: string): Promise<void> {
    throw new StorageNotImplementedError(this.name, "remove");
  }
}
