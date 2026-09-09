import { storage } from "@/lib/storage";
import { AttachmentStatus, uploadByteLimit, type AttachmentKind } from "@/features/platform";
import { auth } from "@/server/auth";
import prisma from "@/server/db";

/**
 * What a provider without direct upload or signed reads cannot do for itself.
 *
 * Keyed by storage key because that is what `StorageProvider.url()` can build
 * for every provider. The key is unguessable, but it is not the access control:
 * membership is, checked on both verbs, so access revoked at noon stops at noon.
 */

/** The row plus the caller's right to touch it, or a Response saying why not. */
async function authorize(request: Request, key: string) {
  const attachment = await prisma.attachment.findUnique({
    where: { storageKey: key },
    select: {
      id: true,
      organizationId: true,
      kind: true,
      fileName: true,
      mimeType: true,
      status: true,
      storageKey: true,
      reservedBytes: true,
      provider: true,
      providerId: true,
      releaseAt: true,
    },
  });
  // The same answer for "no such file" and "not yours": a 403 here would
  // confirm the key exists to anyone who guessed one.
  if (!attachment) return { error: new Response("Not found", { status: 404 }) };

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return { error: new Response("Not signed in", { status: 401 }) };

  const member = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: attachment.organizationId,
        userId: session.user.id,
      },
    },
    select: { id: true },
  });
  if (!member) return { error: new Response("Not found", { status: 404 }) };

  return { attachment };
}

/**
 * Only a PENDING row within its window accepts bytes: overwriting a confirmed
 * key would leave the observed size and type describing something else.
 *
 * Size is enforced twice, because `Content-Length` is a claim like any other.
 */
export async function POST(request: Request, context: RouteContext<"/api/uploads/[...key]">) {
  const { key } = await context.params;
  const { attachment, error } = await authorize(request, key.join("/"));
  if (error) return error;

  if (attachment.status !== AttachmentStatus.PENDING) {
    return new Response("That upload was already finished", { status: 409 });
  }
  if (attachment.releaseAt && attachment.releaseAt.getTime() < Date.now()) {
    return new Response("That upload link has expired", { status: 410 });
  }

  const limit = uploadByteLimit(attachment.kind as AttachmentKind, attachment.reservedBytes);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) {
    return new Response("Too large", { status: 413 });
  }

  const body = await readAtMost(request, limit);
  if (!body) {
    return new Response("Too large", { status: 413 });
  }

  const store = await storage();
  const object = await store.put(attachment.storageKey, body, {
    mimeType: attachment.mimeType ?? "application/octet-stream",
  });

  // Nothing is written to the row here. `confirmUpload` is the one place a row
  // becomes READY, and it gets there by asking storage rather than by trusting
  // whatever this handler happened to see.
  return Response.json({ storageKey: attachment.storageKey, sizeBytes: object.sizeBytes });
}

/**
 * Counted as it arrives: a chunked request carries no `Content-Length` to check
 * first, and `arrayBuffer()` would hold every byte before refusing it.
 */
async function readAtMost(request: Request, max: number): Promise<Buffer | null> {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);

  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

export async function GET(request: Request, context: RouteContext<"/api/uploads/[...key]">) {
  const { key } = await context.params;
  const { attachment, error } = await authorize(request, key.join("/"));
  if (error) return error;

  if (attachment.status !== AttachmentStatus.READY) {
    return new Response("Not found", { status: 404 });
  }

  const store = await storage();
  const body = await store.read(attachment.providerId ?? attachment.storageKey);
  if (!body) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": attachment.mimeType ?? "application/octet-stream",
      // `attachment` rather than inline: a stored HTML or SVG file rendered in
      // our origin would run scripts with the viewer's session.
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
      // Private, and never by a shared cache — the URL is the same for everyone
      // but the right to read it is not.
      "Cache-Control": "private, no-store",
    },
  });
}
