import {
  StorageNotImplementedError,
  StorageProvider,
  type StorageCapabilities,
  type StorageObject,
  type UploadLimits,
  type UploadTicket,
} from "./provider";

/**
 * Cloudinary. A CDN with transformation built in — the right answer for room
 * photographs, and the wrong one for a passport scan.
 *
 * Two traits shape this adapter and neither is visible from the interface:
 *
 * 1. **It renames what it stores.** The upload response carries a `public_id`
 *    of Cloudinary's choosing, so `providerId` is what addresses the object
 *    afterwards and the key we asked for is only a hint.
 * 2. **Delivery is public by default.** `privateObjects` is therefore `false`
 *    here, which is what stops `KIND_REQUIRES` from letting an identity
 *    document be configured onto it. Cloudinary does sell authenticated
 *    delivery; turning it on is a config change *and* a change to this flag,
 *    deliberately not a runtime guess.
 */
export type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  /** The folder every key is written under. */
  folder?: string;
};

export class CloudinaryStorage extends StorageProvider {
  readonly name = "cloudinary";

  readonly capabilities: StorageCapabilities = {
    directUpload: true,
    privateObjects: false,
    signedReads: true,
  };

  constructor(private readonly config: CloudinaryConfig) {
    super();
  }

  /**
   * `cloudinary.uploader.upload_stream` with `resource_type: "auto"`, fed from
   * the buffer. Returns `public_id` as `providerId` and the `bytes` and
   * `format` Cloudinary reports — never what the caller claimed.
   */
  put(_key: string, _body: Buffer, _meta: { mimeType: string }): Promise<StorageObject> {
    throw new StorageNotImplementedError(this.name, "put");
  }

  /**
   * A signed upload preset: `api_sign_request` over `{ timestamp, folder,
   * public_id }`, posted by the browser to the upload endpoint. The size and
   * type limits belong on the **preset** in the Cloudinary console; the values
   * passed here are for the client-side check only, so `confirmUpload` still
   * has to `stat`.
   */
  ticket(_key: string, _limits: UploadLimits): Promise<UploadTicket | null> {
    throw new StorageNotImplementedError(this.name, "ticket");
  }

  /** `cloudinary.api.resource(public_id)` → `bytes`, `format`. */
  stat(_providerId: string): Promise<StorageObject | null> {
    throw new StorageNotImplementedError(this.name, "stat");
  }

  /**
   * `cloudinary.url(public_id, { sign_url: true, type: "authenticated" })`. On
   * a public delivery type the TTL is decoration — which is the whole reason
   * `privateObjects` is false above.
   */
  url(_providerId: string, _ttlSeconds: number): Promise<string> {
    throw new StorageNotImplementedError(this.name, "url");
  }

  /** `cloudinary.uploader.destroy(public_id)`. */
  remove(_providerId: string): Promise<void> {
    throw new StorageNotImplementedError(this.name, "remove");
  }
}
