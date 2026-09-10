"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useErrorHandlers, useRefusalText } from "@/lib/errors";
import { uploadWithProgress, type UploadTarget } from "@/lib/upload";
import { trpc } from "@/utils/trpc";
import {
  refuseAttachment,
  subjectInput,
  type AttachmentKind,
  type SubjectRef,
} from "@/features/platform";

/**
 * The only thing that knows an upload has three steps.
 *
 * A hook rather than a component because progress, abort and retry belong to
 * the *transfer*, not to the pixels: a dialog that unmounts mid-upload must
 * abort, and a panel showing three rows in flight needs one owner of that
 * array. Two surfaces can then render the same upload differently without
 * either owning the state machine.
 *
 * **The ticket-or-`null` branch lives here and nowhere else.** A screen that
 * uploads a passport and one that uploads a room photograph differ by a `kind`
 * prop, whichever provider is configured.
 */

export type UploadState = "queued" | "uploading" | "confirming" | "done" | "failed" | "cancelled";

export type UploadItem = {
  /** Client-side, because there is no row until `requestUpload` answers. */
  id: string;
  fileName: string;
  sizeBytes: number;
  state: UploadState;
  /** 0 to 1. Stays at 0 for a provider that cannot report length. */
  progress: number;
  storageKey?: string;
  attachmentId?: number;
  /** When the reservation lapses, so `retry` knows which call to make. */
  expiresAt?: Date;
  error?: string;
};

export function useAttachmentUpload({
  organizationId,
  subject,
  kind,
}: {
  organizationId: number;
  subject: SubjectRef;
  kind: AttachmentKind;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const { handleError } = useErrorHandlers();
  const refusalText = useRefusalText();
  const utils = trpc.useUtils();

  const requestUpload = trpc.platform.requestUpload.useMutation();
  const confirmUpload = trpc.platform.confirmUpload.useMutation();

  // Kept outside state: aborting must not wait for a render, and the `File`
  // itself is not serialisable into anything a re-render should carry.
  const controllers = useRef(new Map<string, AbortController>());
  const files = useRef(new Map<string, File>());

  const patch = useCallback((id: string, next: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...next } : item)));
  }, []);

  const invalidate = useCallback(() => {
    utils.platform.listAttachments.invalidate();
    utils.platform.storageUsage.invalidate();
  }, [utils]);

  /** One file, from a reservation that already exists or from a new one. */
  const run = useCallback(
    async (id: string, reuse?: { storageKey: string; ticket: UploadTarget | null }) => {
      const file = files.current.get(id);
      if (!file) return;

      const controller = new AbortController();
      controllers.current.set(id, controller);

      try {
        let target: UploadTarget;
        let storageKey: string;

        if (reuse) {
          storageKey = reuse.storageKey;
          target = reuse.ticket ?? { url: `/api/uploads/${storageKey}`, method: "POST" };
        } else {
          const reserved = await requestUpload.mutateAsync({
            organizationId,
            ...subjectInput(subject),
            kind,
            fileName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          });
          storageKey = reserved.storageKey;
          patch(id, {
            storageKey,
            attachmentId: reserved.attachmentId,
            expiresAt: reserved.expiresAt,
          });
          // The branch, once: a ticket for a provider that has one, our own
          // route for a provider that does not.
          target = reserved.ticket ?? { url: reserved.uploadUrl, method: "POST" };
        }

        patch(id, { state: "uploading", progress: 0, error: undefined });
        await uploadWithProgress(file, target, {
          signal: controller.signal,
          onProgress: (progress) => patch(id, { progress }),
        });

        patch(id, { state: "confirming", progress: 1 });
        await confirmUpload.mutateAsync({ organizationId, storageKey });

        patch(id, { state: "done" });
        invalidate();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          // No cleanup call: the reservation lapses on its own after
          // `UPLOAD_WINDOW_MS` and the sweep releases the quota. A delete
          // mutation here would race the sweeper for no gain.
          patch(id, { state: "cancelled" });
          return;
        }
        const app = handleError(error, { toast: false });
        patch(id, { state: "failed", error: app?.message });
      } finally {
        controllers.current.delete(id);
      }
    },
    [confirmUpload, handleError, invalidate, kind, organizationId, patch, requestUpload, subject]
  );

  /**
   * Serially, and deliberately. `requestUpload` reserves quota per file, so N
   * files chosen at once would hold N reservations before the first byte moved
   * and the last would be refused for space the first is not yet using.
   */
  const upload = useCallback(
    async (chosen: File[]) => {
      const queued: UploadItem[] = [];

      for (const file of chosen) {
        const id = crypto.randomUUID();
        // Checked here with the same pure rule the router uses, so the wording
        // matches and an obviously wrong file never costs a round trip.
        const refusal = refuseAttachment({ kind, sizeBytes: file.size, mimeType: file.type });

        files.current.set(id, file);
        queued.push({
          id,
          fileName: file.name,
          sizeBytes: file.size,
          state: refusal ? "failed" : "queued",
          progress: 0,
          ...(refusal ? { error: refusalText(refusal) } : {}),
        });
      }

      setItems((current) => [...current, ...queued]);

      for (const item of queued) {
        if (item.state !== "failed") await run(item.id);
      }
    },
    [kind, refusalText, run]
  );

  const cancel = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
  }, []);

  /**
   * Re-transfer against the same reservation while its window holds, and ask
   * for a new one once it has lapsed. The row decides which, so this reads it
   * rather than guessing.
   */
  const retry = useCallback(
    async (id: string) => {
      const item = items.find((candidate) => candidate.id === id);
      if (!item) return;

      const holds = item.storageKey && item.expiresAt && item.expiresAt.getTime() > Date.now();
      await run(id, holds ? { storageKey: item.storageKey!, ticket: null } : undefined);
    },
    [items, run]
  );

  /** Drops the finished rows; anything still moving stays. */
  const clear = useCallback(() => {
    setItems((current) => current.filter((item) => item.state !== "done"));
  }, []);

  const isUploading = useMemo(
    () => items.some((item) => item.state === "uploading" || item.state === "confirming"),
    [items]
  );

  return { items, upload, cancel, retry, clear, isUploading };
}
