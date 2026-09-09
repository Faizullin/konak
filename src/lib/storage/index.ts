import "server-only";
import { env } from "@/env.mjs";
import { StorageProvider } from "./provider";

export {
  StorageNotImplementedError,
  StorageProvider,
  type StorageCapabilities,
  type StorageObject,
  type UploadLimits,
  type UploadTicket,
} from "./provider";

/**
 * The one place a provider is chosen. Nothing else in the app names a vendor —
 * that is the whole point of the layer, and the reason picky-screen's three
 * inline Cloudinary calls became one function there.
 *
 * The import is dynamic rather than top-level so an unconfigured provider's SDK
 * is never loaded: with four static imports, choosing the filesystem would still
 * pull the AWS and Cloudinary clients into the server bundle.
 */
async function build(): Promise<StorageProvider> {
  switch (env.STORAGE_PROVIDER) {
    case "s3": {
      const { S3Storage } = await import("./s3");
      return new S3Storage({
        bucket: env.S3_BUCKET!,
        region: env.S3_REGION!,
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: Boolean(env.S3_ENDPOINT),
      });
    }
    case "cloudinary": {
      const { CloudinaryStorage } = await import("./cloudinary");
      return new CloudinaryStorage({
        cloudName: env.CLOUDINARY_CLOUD_NAME!,
        apiKey: env.CLOUDINARY_API_KEY!,
        apiSecret: env.CLOUDINARY_API_SECRET!,
      });
    }
    case "vercel-blob": {
      const { VercelBlobStorage } = await import("./vercel-blob");
      return new VercelBlobStorage({
        token: env.BLOB_READ_WRITE_TOKEN!,
        handlerPath: "/api/uploads/blob",
      });
    }
    case "filesystem": {
      const { FilesystemStorage } = await import("./filesystem");
      const { resolve } = await import("node:path");
      return new FilesystemStorage({
        root: resolve(process.cwd(), env.STORAGE_FS_ROOT),
        servePath: "/api/uploads",
      });
    }
  }
}

/**
 * The non-null assertions above are safe because `env.mjs` refuses to start
 * without the selected provider's variables. That check is there rather than
 * here so it fails at boot instead of at the first upload.
 */
let instance: Promise<StorageProvider> | null = null;

/** Memoised: one client per process, not one per request. */
export function storage(): Promise<StorageProvider> {
  instance ??= build();
  return instance;
}
