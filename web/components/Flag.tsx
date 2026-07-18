import { iso, code } from "@/lib/flags";

/**
 * SVG country flag (via flagcdn) — renders on every platform, unlike flag
 * emoji which Windows shows as plain letters. Unknown teams fall back to a
 * neutral badge with the team's short code.
 */
export function Flag({ team, size = 22 }: { team: string; size?: number }) {
  const c = iso(team);
  const h = Math.round(size * 0.72);
  if (!c)
    return (
      <span
        className="grid shrink-0 place-items-center rounded-[3px] border border-edge bg-soft text-[8px] font-bold text-sub"
        style={{ width: size, height: h }}
      >
        {code(team).slice(0, 2)}
      </span>
    );
  return (
    // plain <img>: external SVGs don't need next/image processing
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/${c}.svg`}
      alt={`${team} flag`}
      loading="lazy"
      className="shrink-0 rounded-[3px] border border-edge object-cover"
      style={{ width: size, height: h }}
    />
  );
}
