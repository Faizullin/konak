"use client";

import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A drop target and a file picker. A primitive, like `ComboBox` — no suffix.
 *
 * It knows no kind, no tRPC and no attachment: the caller passes the limits
 * down from `model/` and the words down from `next-intl`, which is what keeps
 * `components/common/` domain-free and translation-free. Nothing here validates
 * — `accept` is a filter in the file chooser and drag-and-drop ignores it
 * entirely, so the caller checks every file whatever route it arrived by.
 *
 * The target is a real `<button>` wrapping a hidden `<input type="file">`, not
 * a `div` with an `onClick`: a div cannot be reached by keyboard and announces
 * nothing.
 */
export function FileDropzone({
  accept,
  multiple = false,
  disabled = false,
  onFiles,
  label = "Drop a file here",
  browseLabel = "or choose one",
  className,
}: {
  /** The `accept` attribute. A filter, never the check. */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  label?: string;
  browseLabel?: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const hand = (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => input.current?.click()}
      onDragOver={(event) => {
        // Without both of these the browser navigates to the dropped file.
        event.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (!disabled) hand(event.dataTransfer.files);
      }}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8",
        "text-muted-foreground text-sm transition-colors",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        over && !disabled ? "border-primary bg-primary/5 text-foreground" : "border-input",
        disabled ? "cursor-not-allowed opacity-60" : "hover:border-primary/60 cursor-pointer",
        className
      )}
    >
      <Upload className="size-5" aria-hidden />
      <span className="font-medium">{label}</span>
      <span className="text-xs">{browseLabel}</span>

      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(event) => {
          hand(event.target.files);
          // Cleared so choosing the same file twice fires `change` both times.
          event.target.value = "";
        }}
      />
    </button>
  );
}
