const GOOGLE_COLORS = ["#4285F4", "#EA4335", "#FBBC05", "#34A853"];

function Box({
  x,
  y,
  w,
  h,
  title,
  subs = [],
  accent,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  subs?: string[];
  accent?: string;
}) {
  const cx = x + w / 2;
  const titleY = y + (subs.length ? 22 : h / 2 + 4);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} fill="currentColor" opacity={0.05} />
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={10}
        fill="none"
        stroke={accent ?? "currentColor"}
        strokeOpacity={accent ? 0.8 : 0.25}
      />
      <text x={cx} y={titleY} textAnchor="middle" fill="currentColor" fontSize={12} fontWeight={600}>
        {title}
      </text>
      {subs.map((s, i) => (
        <text
          key={s}
          x={cx}
          y={titleY + 15 + i * 13}
          textAnchor="middle"
          fill="currentColor"
          opacity={0.55}
          fontSize={10}
        >
          {s}
        </text>
      ))}
    </g>
  );
}

function ArrowDefs({ id }: { id: string }) {
  return (
    <defs>
      <marker id={id} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" opacity={0.5} />
      </marker>
    </defs>
  );
}

function Arrow({
  d,
  marker,
  dashed = false,
}: {
  d: string;
  marker: string;
  dashed?: boolean;
}) {
  return (
    <path
      d={d}
      fill="none"
      stroke="currentColor"
      strokeOpacity={0.45}
      strokeDasharray={dashed ? "4 4" : undefined}
      markerEnd={`url(#${marker})`}
    />
  );
}

function Label({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text x={x} y={y} textAnchor="middle" fill="currentColor" opacity={0.45} fontSize={9.5}>
      {text}
    </text>
  );
}

export function AgentArchitectureDiagram() {
  return (
    <svg viewBox="0 0 760 450" role="img" aria-label="Agent architecture diagram" className="w-full min-w-[640px]">
      <ArrowDefs id="agent-arrow" />

      <Box x={290} y={16} w={180} h={48} title="The brief" subs={["Let's Vibes form"]} />
      <Box x={30} y={104} w={170} h={60} title="Cloud Scheduler" subs={["ticks the vibes queue"]} accent="#4285F4" />
      <Box
        x={250}
        y={100}
        w={260}
        h={72}
        title="Orchestrator · agent 6"
        subs={["gemini-3.7-flash tool loop", "one page at a time"]}
        accent="#34A853"
      />

      <Box
        x={24}
        y={240}
        w={160}
        h={62}
        title="Analyzer · agent 2"
        subs={["reads the gallery", "gemma-4-26b-a4b-it-maas"]}
      />
      <Box x={208} y={240} w={160} h={62} title="Image editor · agent 3" subs={["cut, turn, grade"]} />
      <Box x={392} y={240} w={160} h={62} title="Imaginer" subs={["gemini-3-pro-image"]} accent="#FBBC05" />
      <Box x={576} y={240} w={160} h={62} title="Placer · agent 4" subs={["writes geometry"]} />

      <Box x={250} y={360} w={260} h={58} title="The board" subs={["N pages · designed / empty / refused"]} />
      <Box x={560} y={360} w={176} h={58} title="The deck" subs={["one slide per page, no model call"]} />

      <Arrow d="M 380 64 L 380 100" marker="agent-arrow" />
      <Arrow d="M 200 134 L 250 134" marker="agent-arrow" />
      <Label x={225} y={126} text="wakes" />

      <Arrow d="M 300 172 L 116 240" marker="agent-arrow" />
      <Arrow d="M 350 172 L 296 240" marker="agent-arrow" />
      <Arrow d="M 415 172 L 465 240" marker="agent-arrow" />
      <Arrow d="M 465 172 L 645 240" marker="agent-arrow" />
      <Label x={380} y={222} text="tool calls, round after round" />

      <Arrow d="M 380 302 L 380 360" marker="agent-arrow" />
      <Label x={432} y={336} text="pixels + geometry" />
      <Arrow d="M 510 389 L 560 389" marker="agent-arrow" />
    </svg>
  );
}

export function ProjectArchitectureDiagram() {
  return (
    <svg viewBox="0 0 760 440" role="img" aria-label="Project architecture diagram" className="w-full min-w-[640px]">
      <ArrowDefs id="proj-arrow" />

      <Box x={250} y={16} w={260} h={56} title="Browser" subs={["Next.js UI · infinite canvas"]} />
      <Box x={250} y={136} w={260} h={64} title="Next.js app server" subs={["tRPC API · Prisma · agent workers"]} />

      <rect x={20} y={266} width={720} height={150} rx={14} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeDasharray="5 5" />
      <text x={44} y={292} fill="currentColor" fontSize={12} fontWeight={600}>
        Google Cloud
      </text>
      {GOOGLE_COLORS.map((c, i) => (
        <circle key={c} cx={136 + i * 14} cy={288} r={4} fill={c} />
      ))}

      <Box
        x={44}
        y={310}
        w={160}
        h={78}
        title="Vertex AI"
        subs={["gemini-3.7-flash", "gemini-3-pro-image", "gemma-4-26b-a4b-it-maas"]}
        accent="#4285F4"
      />
      <Box x={224} y={310} w={160} h={78} title="Cloud SQL" subs={["Postgres — scenes,", "pages, job leases"]} accent="#EA4335" />
      <Box x={404} y={310} w={160} h={78} title="Cloud Storage" subs={["uploads, crops,", "renders"]} accent="#FBBC05" />
      <Box x={584} y={310} w={152} h={78} title="Cloud Scheduler" subs={["drives unattended", "runs"]} accent="#34A853" />

      <Arrow d="M 380 72 L 380 136" marker="proj-arrow" />
      <Label x={410} y={108} text="tRPC" />

      <Arrow d="M 310 200 L 130 310" marker="proj-arrow" />
      <Arrow d="M 355 200 L 302 310" marker="proj-arrow" />
      <Arrow d="M 405 200 L 480 310" marker="proj-arrow" />
      <Arrow d="M 660 310 C 665 250 560 220 510 200" marker="proj-arrow" />
      <Label x={634} y={246} text="wakes workers" />

      <Arrow d="M 510 44 C 710 60 700 220 664 310" marker="proj-arrow" dashed />
      <Label x={706} y={160} text="signed URLs" />
    </svg>
  );
}
