import "server-only";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import {
  StorageProvider,
  type StorageCapabilities,
  type StorageObject,
  type UploadLimits,
  type UploadTicket,
} from "./provider";
import { SNIFF_BYTES, sniffMimeType } from "./sniff";

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
   * A key is untrusted input all the way down here, whatever validated it
   * upstream. `resolve` collapses `..`, so comparing the result against the
   * root is what actually stops an escape — checking the key for `..` first
   * would not, because encodings differ.
   */
  private pathFor(key: string): string {
    const full = resolve(this.config.root, key);
    if (!full.startsWith(this.config.root + sep)) {
      throw new Error(`storage key escapes the root: ${key}`);
    }
    return full;
  }

  async put(key: string, body: Buffer, meta: { mimeType: string }): Promise<StorageObject> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);

    // Sniffed, not echoed. A provider reporting back what it was told is the
    // hole `confirmUpload` exists to close, and this one can read the bytes.
    return {
      providerId: key,
      sizeBytes: body.byteLength,
      mimeType: sniffMimeType(body.subarray(0, SNIFF_BYTES)) ?? meta.mimeType,
    };
  }

  /** Always `null`. There is no address a browser could post to but ours. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- no direct upload, by nature
  async ticket(_key: string, _limits: UploadLimits): Promise<UploadTicket | null> {
    return null;
  }

  async stat(providerId: string): Promise<StorageObject | null> {
    const path = this.pathFor(providerId);

    let size: number;
    try {
      const info = await stat(path);
      if (!info.isFile()) return null;
      size = info.size;
    } catch (error) {
      // Only "it is not there" is an answer. Anything else — a permission
      // problem, a full disk — must not read as an absent file.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }

    const head = Buffer.alloc(SNIFF_BYTES);
    const handle = await open(path, "r");
    try {
      await handle.read(head, 0, SNIFF_BYTES, 0);
    } finally {
      await handle.close();
    }

    return {
      providerId,
      sizeBytes: size,
      mimeType: sniffMimeType(head) ?? "application/octet-stream",
    };
  }

  /**
   * Our own route, not a file URL. It does not expire; the membership check
   * happens per request instead, which is stricter than a TTL — access revoked
   * at noon stops working at noon.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- nothing expires; see `capabilities`
  async url(providerId: string, _ttlSeconds: number): Promise<string> {
    return `${this.config.servePath}/${providerId}`;
  }

  async read(providerId: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(providerId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  /** `force`, so removing a file that is already gone is not an error — the sweeper retries. */
  async remove(providerId: string): Promise<void> {
    await rm(this.pathFor(providerId), { force: true });
  }
}
