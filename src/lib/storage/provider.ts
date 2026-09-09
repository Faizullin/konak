/**
 * Where the bytes of an `Attachment` live.
 *
 * An adapter by the architecture's own test — it knows no business rule and
 * would be swapped whole for another vendor. What a *kind* of file requires of
 * a provider is the domain's question and lives in
 * `features/platform/model/attachment.ts`, because `lib/` may not import a
 * feature.
 *
 * See `plans/file-uploads.md` for why the interface is shaped this way. The
 * short version is in `capabilities` below: these four providers differ more
 * than a common interface suggests, and pretending otherwise is what produces
 * a passport scan on a public URL.
 */

/** What a provider can do. Read before use rather than assumed. */
export type StorageCapabilities = {
  /**
   * The client may send bytes straight to the provider, so they never pass
   * through this server. A filesystem cannot, and never will.
   */
  directUpload: boolean;
  /**
   * An object can be stored so that knowing its URL is not enough to open it.
   * False for the providers whose delivery is a public CDN by default.
   */
  privateObjects: boolean;
  /** A read URL can be issued that stops working. */
  signedReads: boolean;
};

/** What is actually stored, as the provider reports it — never as a caller claimed. */
export type StorageObject = {
  /**
   * The provider's own name for the object.
   *
   * Not always the key it was given: Cloudinary answers with a `public_id` of
   * its own choosing, which is why the row stores this separately from
   * `storageKey`.
   */
  providerId: string;
  sizeBytes: number;
  mimeType: string;
};

/** Everything a browser needs to upload without touching this server. */
export type UploadTicket = {
  url: string;
  /** Fields a multipart form must carry, when the provider wants them. */
  fields?: Record<string, string>;
  /** The HTTP method the client should use. */
  method: "POST" | "PUT";
  expiresAt: Date;
};

export type UploadLimits = {
  maxBytes: number;
  /** An allowlist. A denylist is not a security control. */
  mimeTypes: readonly string[];
};

/**
 * Thrown by a provider method that is declared but not yet written.
 *
 * A distinct class so it is greppable and so a caller can tell "this provider
 * cannot do that" from "this provider is not finished". Nothing calls these
 * yet — the adapters are prepared, not wired.
 */
export class StorageNotImplementedError extends Error {
  constructor(provider: string, method: string) {
    super(`${provider}.${method}() is prepared but not implemented — see plans/file-uploads.md`);
    this.name = "StorageNotImplementedError";
  }
}

export abstract class StorageProvider {
  /** Recorded on the row, so a stored object can be found again after a switch. */
  abstract readonly name: string;

  abstract readonly capabilities: StorageCapabilities;

  /**
   * Bytes through this server. **Every provider supports this**, which is what
   * makes the interface honest: the direct path is an optimisation, the slow
   * path is the contract.
   */
  abstract put(key: string, body: Buffer, meta: { mimeType: string }): Promise<StorageObject>;

  /**
   * Bytes straight from the browser, or `null` when this provider has no such
   * mechanism. A caller that gets `null` posts to our own route handler instead
   * — one branch, in one place.
   */
  abstract ticket(key: string, limits: UploadLimits): Promise<UploadTicket | null>;

  /**
   * What is there now. The confirm step reads this and writes the **observed**
   * size and type onto the row, which is the whole reason a caller's claims are
   * never trusted. `null` when nothing was uploaded.
   */
  abstract stat(providerId: string): Promise<StorageObject | null>;

  /**
   * A URL to read the object with. Expires when `capabilities.signedReads`; a
   * caller should not assume it is safe to store.
   */
  abstract url(providerId: string, ttlSeconds: number): Promise<string>;

  /**
   * The bytes back, through this server.
   *
   * Needed because a provider that cannot sign a read URL has to be served by
   * us, and the route serving it must not know which provider it is talking to.
   * Buffered rather than streamed: `KIND_LIMITS` caps a file at 20 MB, so the
   * memory is bounded, and a streaming variant can be added the day something
   * larger is allowed.
   */
  abstract read(providerId: string): Promise<Buffer | null>;

  abstract remove(providerId: string): Promise<void>;
}
