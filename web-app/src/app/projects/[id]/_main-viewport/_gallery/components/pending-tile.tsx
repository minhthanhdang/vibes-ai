import type { PendingUpload } from "../types";

export function PendingTile({ file, previewUrl }: PendingUpload) {
  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-dashed border-current/20">
      <div className="relative aspect-[4/3] bg-current/5">
        {previewUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={previewUrl} alt="" className="h-full w-full object-cover opacity-30" />
        ) : null}
        <span className="absolute inset-0 grid place-items-center text-xs opacity-70">
          Uploading…
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1 px-3 py-2 text-xs opacity-50">
        <span className="truncate font-medium">{file.name}</span>
      </div>
    </li>
  );
}
