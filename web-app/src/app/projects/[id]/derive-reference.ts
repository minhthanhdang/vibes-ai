"use client";

import { readImageForUpload } from "@/lib/thumbnail";
import { needsDerivedCopy, type DerivableReference } from "@/lib/reference-derived";
import { referenceCanvasImagePath } from "@/server/references/display";
import type { useTRPCClient } from "@/trpc/react";
import { uploadThumbnail } from "./upload-reference";

/// Making the grid-sized copy of a reference nobody uploaded.
///
/// An image imported from a web page is fetched by the server, so the browser
/// never held its bytes and the row landed without the two things a decode
/// gives: the pixel size, and the thumbnail every surface actually draws. Both
/// are still recoverable, because our *own* copy of the image is same-origin —
/// the streaming route exists so the export canvas is readable, and readable is
/// exactly what a downscale needs too.
///
/// So the bytes come back once, here, in exchange for every later load of that
/// photo being a 640px JPEG instead of a photograph. It is the same trade the
/// dropzone makes for free, paid a second later.

type TRPCClient = ReturnType<typeof useTRPCClient>;

/// The original, explicitly — not the `variant=thumb` URL the board asks for.
/// That one answers with the original today and with the thumbnail the moment
/// this lands, and a thumbnail of a thumbnail is how a photo quietly loses half
/// its resolution.
function originalBytes(referenceId: string) {
  return fetch(referenceCanvasImagePath(referenceId));
}

export type DerivedReference = { width?: number; height?: number; hasThumbnail: boolean };

/// Returns what the row holds *after* the attempt, so a caller waiting on the
/// pixel size can place the photo with it. Every step is allowed to fail
/// without failing the import: the reference exists either way, and what is
/// lost is bandwidth rather than the photo.
export async function deriveReferenceCopies(
  client: TRPCClient,
  projectId: string,
  reference: { id: string } & DerivableReference,
): Promise<DerivedReference | null> {
  if (!needsDerivedCopy(reference)) return null;

  let decoded;
  try {
    const response = await originalBytes(reference.id);
    if (!response.ok) return null;
    decoded = await readImageForUpload(await response.blob());
  } catch {
    return null;
  }

  /// A format the browser cannot decode leaves both fields empty, and there is
  /// nothing to write — the same outcome the dropzone has for such a file.
  if (decoded.width === undefined) return null;

  const thumbGcsUri = decoded.thumbnail
    ? await uploadThumbnail(client, projectId, decoded.thumbnail)
    : undefined;

  try {
    const stored = await client.reference.attachDerived.mutate({
      projectId,
      referenceId: reference.id,
      width: decoded.width,
      height: decoded.height,
      thumbGcsUri,
    });
    return {
      width: stored.width ?? undefined,
      height: stored.height ?? undefined,
      hasThumbnail: stored.hasThumbnail,
    };
  } catch {
    /// The object is in the bucket with nothing pointing at it. `attachDerived`
    /// is the only thing that could have claimed it, so it is discarded here for
    /// the same reason `uploadReference` discards a failed one.
    if (thumbGcsUri) {
      await client.reference.discardUpload
        .mutate({ projectId, gcsUris: [thumbGcsUri] })
        .catch(() => undefined);
    }
    return null;
  }
}
