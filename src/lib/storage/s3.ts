import {
  StorageNotImplementedError,
  StorageProvider,
  type StorageCapabilities,
  type StorageObject,
  type UploadLimits,
  type UploadTicket,
} from "./provider";

/**
 * S3 and everything that speaks it — MinIO in development, Cloudflare R2 and
 * Backblaze B2 in production. One adapter for all of them, which is the reason
 * to prefer this API over a vendor's own.
 *
 * The only provider here that does every capability, so it is the one an
 * identity document can land on.
 */
export type S3Config = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Set for MinIO and R2; absent for AWS itself. */
  endpoint?: string;
  /** MinIO needs it; AWS rejects it. */
  forcePathStyle?: boolean;
};

export class S3Storage extends StorageProvider {
  readonly name = "s3";

  readonly capabilities: StorageCapabilities = {
    directUpload: true,
    privateObjects: true,
    signedReads: true,
  };

  constructor(private readonly config: S3Config) {
    super();
  }

  /**
   * `PutObjectCommand` with `Bucket`, `Key`, `Body`, `ContentType`. The response
   * carries no size, so the returned object reports `body.byteLength`.
   */
  put(_key: string, _body: Buffer, _meta: { mimeType: string }): Promise<StorageObject> {
    throw new StorageNotImplementedError(this.name, "put");
  }

  /**
   * `createPresignedPost` rather than a presigned `PUT`: the POST policy is the
   * only form that can enforce `content-length-range` and a content-type
   * condition *at S3*, so an oversized file is refused before it is stored
   * rather than found afterwards by `stat`.
   */
  ticket(_key: string, _limits: UploadLimits): Promise<UploadTicket | null> {
    throw new StorageNotImplementedError(this.name, "ticket");
  }

  /** `HeadObjectCommand` → `ContentLength` and `ContentType`; `null` on 404. */
  stat(_providerId: string): Promise<StorageObject | null> {
    throw new StorageNotImplementedError(this.name, "stat");
  }

  /** `getSignedUrl(GetObjectCommand, { expiresIn })`. */
  url(_providerId: string, _ttlSeconds: number): Promise<string> {
    throw new StorageNotImplementedError(this.name, "url");
  }

  /** `DeleteObjectCommand`. S3 does not report whether the key existed. */
  remove(_providerId: string): Promise<void> {
    throw new StorageNotImplementedError(this.name, "remove");
  }
}
