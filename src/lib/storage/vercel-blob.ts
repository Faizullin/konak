/* eslint-disable @typescript-eslint/no-unused-vars -- Prepared, not written:
   the @vercel/blob SDK is not a dependency yet, so every method below declares the signature callers are
   typed against and throws. The parameters go when the bodies arrive. */
import "server-only";
import {
  StorageNotImplementedError,
  StorageProvider,
  type StorageCapabilities,
  type StorageObject,
  type UploadLimits,
  type UploadTicket,
} from "./provider";

/**
 * Vercel Blob. The least configuration of the four — a token and nothing else —
 * and the narrowest.
 *
 * Its direct upload does not fit `ticket()` exactly: the client calls `upload()`
 * from `@vercel/blob/client`, which asks *our* route handler for a token
 * mid-flight. So the ticket returned here points at that handler, not at Vercel,
 * and the URL is ours. The interface survives it because a ticket only promises
 * "post the bytes here", never "here is the vendor".
 *
 * `privateObjects` is false: `access: "public"` is the path the SDK is built
 * around, and an unguessable URL is obscurity, not access control. Same
 * consequence as Cloudinary — no identity documents.
 */
export type VercelBlobConfig = {
  token: string;
  /** Our own route the client asks for a token, e.g. `/api/uploads/blob`. */
  handlerPath: string;
};

export class VercelBlobStorage extends StorageProvider {
  readonly name = "vercel-blob";

  readonly capabilities: StorageCapabilities = {
    directUpload: true,
    privateObjects: false,
    signedReads: false,
  };

  constructor(private readonly config: VercelBlobConfig) {
    super();
  }

  /**
   * `put(key, body, { access: "public", contentType })` from `@vercel/blob`.
   * The result's `pathname` is the `providerId` — not the `url`, which carries
   * a random suffix and changes if the object is replaced.
   */
  put(_key: string, _body: Buffer, _meta: { mimeType: string }): Promise<StorageObject> {
    throw new StorageNotImplementedError(this.name, "put");
  }

  /**
   * Points at `config.handlerPath`, where `handleUpload` from
   * `@vercel/blob/client` mints the real token and applies
   * `allowedContentTypes` and `maximumSizeInBytes`. That handler is the one
   * place the limits are enforced; this returns the address of it.
   */
  ticket(_key: string, _limits: UploadLimits): Promise<UploadTicket | null> {
    throw new StorageNotImplementedError(this.name, "ticket");
  }

  /** `head(pathname)` → `size`, `contentType`; `null` when it throws not-found. */
  stat(_providerId: string): Promise<StorageObject | null> {
    throw new StorageNotImplementedError(this.name, "stat");
  }

  /**
   * The public CDN URL. There is no expiry to apply, so `ttlSeconds` is
   * ignored — declared by `signedReads: false` rather than left for a caller to
   * discover.
   */
  url(_providerId: string, _ttlSeconds: number): Promise<string> {
    throw new StorageNotImplementedError(this.name, "url");
  }

  /** Fetch the public URL. There is no read API beyond the CDN. */
  read(_providerId: string): Promise<Buffer | null> {
    throw new StorageNotImplementedError(this.name, "read");
  }

  /** `del(pathname)`. */
  remove(_providerId: string): Promise<void> {
    throw new StorageNotImplementedError(this.name, "remove");
  }
}
