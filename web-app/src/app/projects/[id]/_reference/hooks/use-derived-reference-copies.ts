"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readImageForUpload } from "@/lib/intake/thumbnail";
import {
  needsDerivedCopy,
  referencesOwedCopies,
  type DerivableReference,
} from "@/lib/intake/reference-derived";
import { referenceCanvasImagePath } from "@/server/references/display";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { uploadThumbnail } from "../utils/upload-reference";

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

/// The standing version of the same job, for every row that is owed one rather
/// than for the ones a turn just filed.
///
/// A picture the assistant drew is derived by the turn that drew it, and that
/// was the only moment it was ever offered: a turn that broke on a later round,
/// a tab closed while the bytes were coming back, or a download that simply
/// failed all leave a row whose every tile is a full-resolution PNG for as long
/// as the project lasts. This runs wherever the project is open, so the next
/// visit finishes what the turn could not.
///
/// Mounted beside the workspace rather than inside the assistant's column,
/// which collapses — the same reason the cut and discard listeners are there.
/// The list read is the one the strip and the grid already poll, so subscribing
/// to it costs no round trip. One picture at a time, and a row that fails is
/// left alone for the rest of the session.
export function useDerivedReferenceCopies(projectId: string) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const listOptions = trpc.reference.listByProject.queryOptions({ projectId });
  const { data: references } = useQuery(listOptions);
  const tried = useRef<Set<string>>(new Set());
  const deriving = useRef(false);
  /// What the list holds *now*, read inside the run rather than closed over: a
  /// turn that draws a picture while a picture is being derived would otherwise
  /// be skipped by the guard below and wait for the change after it.
  const latest = useRef(references);
  const queryKey = listOptions.queryKey;

  useEffect(() => {
    latest.current = references;
  }, [references]);

  useEffect(() => {
    if (deriving.current || !referencesOwedCopies(references, tried.current).length) return;

    deriving.current = true;
    void (async () => {
      let landed = false;
      for (
        let owed = referencesOwedCopies(latest.current, tried.current);
        owed.length;
        owed = referencesOwedCopies(latest.current, tried.current)
      ) {
        for (const reference of owed) {
          tried.current.add(reference.id);
          const derived = await deriveReferenceCopies(client, projectId, reference).catch(
            () => null,
          );
          landed ||= derived !== null;
        }
      }
      deriving.current = false;
      if (landed) await queryClient.invalidateQueries({ queryKey });
    })();
  }, [references, client, projectId, queryClient, queryKey]);
}
