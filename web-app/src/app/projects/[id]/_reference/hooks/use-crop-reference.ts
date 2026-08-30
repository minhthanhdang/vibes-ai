"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC, useTRPCClient } from "@/trpc/react";
import { hashFileContent } from "@/lib/intake/content-hash";
import { editIntent, shapeAsked } from "@/lib/references/reference-version";
import type { CropRegion } from "@/lib/canvas/moodboard-crop";
import { cutFromOriginal } from "../utils/cut-reference";
import { announceCutTaken } from "../../_events/cut-taken";
import { uploadVersion } from "../utils/upload-reference";

export type CropStage = "idle" | "asking" | "cutting" | "filing";

export type CropProposal = {
  region: CropRegion;
  cropBox: number[];
  editIntent: string;
  editRationale: string;
  aspect: string | null;
  loose: string | null;
  origin: CropOrigin | null;
};

export type CropOrigin = {
  id: string;
  cropBox: number[];
  editIntent: string;
  editAspect?: unknown;
};

export function useReferenceCrop({
  projectId,
  referenceId,
}: {
  projectId: string;
  referenceId: string;
}) {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();

  const [stage, setStage] = useState<CropStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<CropProposal | null>(null);
  const [moving, setMoving] = useState(false);
  const running = useRef(false);

  const ask = useCallback(
    async (
      prompt: string,
      {
        previous,
        origin = null,
        aspect = null,
        loose = null,
      }: {
        previous?: { cropBox: number[]; editIntent: string };
        origin?: CropOrigin | null;
        aspect?: string | null;
        loose?: string | null;
      } = {},
    ) => {
      const asked = editIntent(prompt);
      if (!asked || running.current) return;

      running.current = true;
      setError(null);
      setMoving(!!previous);
      setStage("asking");
      try {
        const plan = await client.reference.planCrop.mutate({
          referenceId,
          prompt: asked,
          ...(previous && {
            previous: { cropBox: previous.cropBox, editIntent: previous.editIntent },
          }),
          ...(aspect && { aspect }),
          ...(loose && { loose }),
        });
        setProposal({
          region: plan.region,
          cropBox: plan.cropBox,
          editIntent: plan.editIntent || asked,
          editRationale: plan.editRationale,
          origin,
          aspect,
          loose: plan.loose ?? loose,
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        running.current = false;
        setStage("idle");
      }
    },
    [client, referenceId],
  );

  const keep = useCallback(async () => {
    if (!proposal || running.current) return;

    running.current = true;
    setError(null);
    setStage("cutting");
    try {
      const cut = await cutFromOriginal(referenceId, proposal.region);
      if (!cut) throw new Error("this browser could not cut the image");

      setStage("filing");
      const filed = await uploadVersion(client, projectId, {
        file: cut.file,
        contentType: cut.contentType,
        contentHash: await hashFileContent(cut.file),
        sourceReferenceId: referenceId,
        editIntent: proposal.editIntent,
        editRationale: proposal.editRationale,
        cropBox: proposal.cropBox,
        ...((proposal.aspect ?? proposal.loose) && {
          editAspect: proposal.aspect ?? proposal.loose ?? undefined,
        }),
      });

      announceCutTaken({
        referenceId: filed.id,
        frameId: referenceId,
        title: filed.title,
        keeps: proposal.editIntent,
        aspect: proposal.aspect,
        framed: proposal.loose,
        thumbUrl: filed.thumbUrl,
      });
      setProposal(null);

      await queryClient.invalidateQueries({
        queryKey: trpc.reference.versions.queryOptions({ referenceId }).queryKey,
      });
      await queryClient.invalidateQueries({
        queryKey: trpc.reference.versionLinksByProject.queryOptions({ projectId }).queryKey,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      running.current = false;
      setStage("idle");
    }
  }, [client, projectId, proposal, queryClient, referenceId, trpc]);

  const refine = useCallback(
    async (prompt: string) => {
      if (!proposal) return;
      await ask(prompt, {
        previous: proposal,
        origin: proposal.origin,
        aspect: proposal.aspect,
        loose: proposal.loose,
      });
    },
    [ask, proposal],
  );

  const adjust = useCallback(
    async (version: CropOrigin, prompt: string) => {
      const asked = shapeAsked(version.editAspect);
      await ask(prompt, {
        previous: { cropBox: version.cropBox, editIntent: version.editIntent },
        origin: version,
        aspect: asked?.shape?.label ?? null,
        loose: asked?.loose?.id ?? null,
      });
    },
    [ask],
  );

  const discard = useCallback(() => {
    if (running.current) return;
    setProposal(null);
    setError(null);
  }, []);

  return {
    ask,
    refine,
    adjust,
    keep,
    discard,
    proposal,
    stage,
    moving,
    error,
    dismissError: useCallback(() => setError(null), []),
  };
}
