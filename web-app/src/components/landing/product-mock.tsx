"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens, springs } from "@/lib/motion/tokens";

const SCENES = ["brief", "run", "board"] as const;
type Scene = (typeof SCENES)[number];

const SCENE_MS = 4200;

const SCENE_CAPTIONS: Record<Scene, string> = {
  brief: "1 · Say what the board is for",
  run: "2 · Walk away — agents design every page",
  board: "3 · Come back to a finished board",
};

const TILE_HUES = [12, 32, 48, 145, 205, 255, 315];

function tileStyle(hue: number) {
  return {
    background: `linear-gradient(135deg, hsl(${hue} 80% 72%), hsl(${hue + 40} 75% 60%))`,
  };
}

function BriefScene() {
  const reduce = useReducedMotion();
  const fields = [
    { label: "Purpose", value: "Six-page wedding welcome set" },
    { label: "Vibe", value: "Warm and filmic" },
    { label: "Pages", value: "6 · A4 landscape" },
  ];

  return (
    <motion.div
      className="flex h-full flex-col justify-center gap-3 p-6"
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } } }}
    >
      {fields.map((f) => (
        <motion.div
          key={f.label}
          variants={{
            hidden: { opacity: 0, y: reduce ? 0 : motionTokens.distance.sm },
            visible: { opacity: 1, y: 0, transition: springs.gentle },
          }}
          className="rounded-lg border border-current/10 px-4 py-3"
        >
          <div className="text-[10px] uppercase tracking-wider opacity-50">{f.label}</div>
          <div className="text-sm">{f.value}</div>
        </motion.div>
      ))}
      <motion.div
        variants={{
          hidden: { opacity: 0, scale: motionTokens.scale.press },
          visible: { opacity: 1, scale: 1, transition: springs.bouncy },
        }}
        className="rainbow-bar mt-1 w-fit rounded-full px-4 py-2 text-sm font-medium text-white"
      >
        Let&apos;s Vibes
      </motion.div>
    </motion.div>
  );
}

function RunScene() {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className="grid h-full grid-cols-3 gap-3 p-6"
      initial="hidden"
      animate="visible"
      variants={{ visible: { transition: { staggerChildren: 0.09 } } }}
    >
      {[0, 1, 2].map((page) => (
        <div key={page} className="flex flex-col gap-2 rounded-lg border border-current/10 p-2">
          <div className="text-[10px] opacity-40">Page {page + 1}</div>
          <div className="grid flex-1 grid-cols-2 content-start gap-1.5">
            {TILE_HUES.slice(0, 4 + (page % 2)).map((hue, i) => (
              <motion.div
                key={i}
                variants={{
                  hidden: { opacity: 0, scale: reduce ? 1 : 0.5 },
                  visible: { opacity: 1, scale: 1, transition: springs.snappy },
                }}
                className={`rounded ${i % 3 === 0 ? "col-span-2 h-10" : "h-8"}`}
                style={tileStyle(hue + page * 25)}
              />
            ))}
          </div>
        </div>
      ))}
    </motion.div>
  );
}

function BoardScene() {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className="flex h-full items-center justify-center p-6"
      initial={{ opacity: 0, scale: reduce ? 1 : motionTokens.scale.subtle }}
      animate={{ opacity: 1, scale: 1 }}
      transition={springs.gentle}
    >
      <div className="grid w-full grid-cols-3 gap-3">
        {[0, 1, 2, 3, 4, 5].map((page) => (
          <div
            key={page}
            className="flex h-24 flex-col gap-1 overflow-hidden rounded-lg border border-current/10 p-1.5"
          >
            <div className="h-3 w-2/3 rounded-sm" style={tileStyle(TILE_HUES[page % TILE_HUES.length])} />
            <div className="grid flex-1 grid-cols-3 gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={i === 1 ? "col-span-2 rounded" : "rounded"}
                  style={tileStyle(TILE_HUES[(page + i + 2) % TILE_HUES.length] + 15)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

const SCENE_PANELS: Record<Scene, React.ComponentType> = {
  brief: BriefScene,
  run: RunScene,
  board: BoardScene,
};

export function ProductMock() {
  const [scene, setScene] = useState<Scene>("brief");
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      setScene((s) => SCENES[(SCENES.indexOf(s) + 1) % SCENES.length]);
    }, SCENE_MS);
    return () => clearInterval(id);
  }, [reduce]);

  return (
    <div className="overflow-hidden rounded-2xl border border-current/10 bg-background shadow-2xl shadow-black/10">
      <div className="flex items-center gap-1.5 border-b border-current/10 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
        <span className="size-2.5 rounded-full bg-[#febc2e]" />
        <span className="size-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 text-xs opacity-40">vibes — six pages, unattended</span>
      </div>

      <div className="h-64 sm:h-72">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={scene}
            className="h-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: motionTokens.duration.fast }}
          >
            {(() => {
              const ScenePanel = SCENE_PANELS[scene];
              return <ScenePanel />;
            })()}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between border-t border-current/10 px-4 py-2.5">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={scene}
            className="text-xs opacity-60"
            initial={{ opacity: 0, y: reduce ? 0 : motionTokens.distance.xs }}
            animate={{ opacity: 0.6, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -motionTokens.distance.xs }}
            transition={{ duration: motionTokens.duration.fast }}
          >
            {SCENE_CAPTIONS[scene]}
          </motion.span>
        </AnimatePresence>
        <div className="flex gap-1.5">
          {SCENES.map((s) => (
            <button
              key={s}
              aria-label={SCENE_CAPTIONS[s]}
              onClick={() => setScene(s)}
              className={`size-1.5 rounded-full transition-opacity ${
                s === scene ? "rainbow-bar" : "bg-current opacity-20"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
