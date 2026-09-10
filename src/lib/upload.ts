/**
 * Bytes from the browser to wherever the ticket points.
 *
 * The counterpart of `lib/storage/`, standing to it as `lib/auth-client.ts`
 * stands to `server/auth.ts`. It knows a URL, a method and a `File`, and
 * nothing about attachments, kinds or quota — which is why it is `lib/` and not
 * a feature.
 *
 * **`XMLHttpRequest`, not `fetch`, and deliberately.** `fetch` cannot report
 * upload progress: there is no `upload.onprogress` on it and request streaming
 * is not usable here. This is the one place in the app where XHR is the right
 * tool. Modernising it produces a progress bar that jumps from 0 to 100.
 */

/** `UploadTicket` minus `expiresAt` — the transport does not care when a ticket dies. */
export type UploadTarget = {
  url: string;
  method: "POST" | "PUT";
  /** Present for a multipart POST (S3's presigned POST, Cloudinary's preset). */
  fields?: Record<string, string>;
};

/**
 * A transfer that reached a server and was refused, as distinct from one that
 * never left.
 *
 * `lib/errors.ts` recognises it **by shape** — `name` plus a numeric `status` —
 * rather than importing this module, for the same reason it does that for tRPC
 * and Better Auth: `errors.ts` is reached by every route, and an import here
 * would put XHR code in the chunk every page loads.
 */
export class UploadTransferError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "UploadTransferError";
    this.status = status;
  }
}

export type UploadOptions = {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

/**
 * One function for all three destinations, without a branch at the call site:
 * `fields` present means a multipart POST, `fields` absent means the file as
 * the whole body, and our own route handler is just another URL.
 */
export function uploadWithProgress(
  file: File,
  target: UploadTarget,
  options: UploadOptions = {}
): Promise<void> {
  const { onProgress, signal } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }

    const request = new XMLHttpRequest();
    request.open(target.method, target.url, true);

    request.upload.onprogress = (event) => {
      // `lengthComputable` is false for a stream; reporting 0 forever is more
      // honest than inventing a fraction.
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(event.loaded / event.total);
      }
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(1);
        resolve();
        return;
      }
      reject(new UploadTransferError(request.status, request.statusText || "Upload failed"));
    };

    // Status 0: the request never arrived — offline, DNS, or a missing CORS
    // header on a provider's bucket, which is the usual cause when a direct
    // upload's progress never moves.
    request.onerror = () => reject(new UploadTransferError(0, "Upload failed"));
    request.ontimeout = () => reject(new UploadTransferError(0, "Upload timed out"));

    const abort = () => request.abort();
    signal?.addEventListener("abort", abort, { once: true });
    request.onloadend = () => signal?.removeEventListener("abort", abort);
    request.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));

    if (target.fields) {
      const form = new FormData();
      for (const [name, value] of Object.entries(target.fields)) form.append(name, value);
      // Last, and it must be: S3 ignores every field that follows the file.
      form.append("file", file);
      request.send(form);
    } else {
      request.send(file);
    }
  });
}
