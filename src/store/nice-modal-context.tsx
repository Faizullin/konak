"use client";

import NiceModal from "@ebay/nice-modal-react";

/**
 * The modal registry, and its provider as a client component in its own right.
 *
 * `NiceModal.Provider` is a property of a client module's default export, and a
 * Server Component cannot use one as JSX — the reference does not survive the
 * boundary. Naming it here makes it an ordinary client component the dashboard
 * layout can mount inside `NextIntlClientProvider`, which is where it has to be:
 * a modal renders where its provider sits, and every dialog here reads
 * `useTranslations`.
 */
export const NiceModalProvider = NiceModal.Provider;

export default NiceModal;
