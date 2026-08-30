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

type TRPCClient = ReturnType<typeof useTRPCClient>;

function originalBytes(referenceId: string) {
  return fetch(referenceCanvasImagePath(referenceId));
}

export type DerivedReference = { width?: number; height?: number; hasThumbnail: boolean };

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
    if (thumbGcsUri) {
      await client.reference.discardUpload
        .mutate({ projectId, gcsUris: [thumbGcsUri] })
        .catch(() => undefined);
    }
    return null;
  }
}

export function useDerivedReferenceCopies(projectId: string) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const listOptions = trpc.reference.listByProject.queryOptions({ projectId });
  const { data: references } = useQuery(listOptions);
  const tried = useRef<Set<string>>(new Set());
  const deriving = useRef(false);
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
