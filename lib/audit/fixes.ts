// Suggested product and rough cost for each kind of finding, so the report reads like a shopping list.
// Prices are rough US retail ranges, for planning only.

import type { AuditItem } from "@/lib/types";

export interface Fix {
  product: string;
  costUsd: [number, number];
}

const RULES: { match: RegExp; fix: Fix }[] = [
  { match: /door.*(narrow|limit)|cannot get|404\.2/i, fix: { product: "Offset (swing-clear) door hinges", costUsd: [20, 45] } },
  { match: /grab bar|toilet/i, fix: { product: "Wall-mounted grab bar or toilet safety frame", costUsd: [30, 90] } },
  { match: /bathtub|tub/i, fix: { product: "Non-slip mat and tub transfer bench", costUsd: [40, 120] } },
  { match: /stair/i, fix: { product: "Second handrail and contrasting stair-edge tape", costUsd: [60, 300] } },
  { match: /stove|oven|knob/i, fix: { product: "Stove knob covers or an automatic stove shut-off", costUsd: [15, 250] } },
  { match: /front door|keys|coat|exit|wander/i, fix: { product: "Door chime and a cloth door cover", costUsd: [20, 40] } },
  { match: /rug|runner|mat/i, fix: { product: "Rug gripper tape, or remove the rug", costUsd: [0, 15] } },
  { match: /cord|cable/i, fix: { product: "Cord cover along the wall", costUsd: [10, 20] } },
  { match: /light|dark/i, fix: { product: "Plug-in motion night lights", costUsd: [15, 30] } },
  { match: /mirror/i, fix: { product: "Cover or remove the mirror", costUsd: [0, 10] } },
  { match: /bed/i, fix: { product: "Move the bed; add a bed assist rail", costUsd: [0, 60] } },
  { match: /hall|walking path|route/i, fix: { product: "Clear the path; add a hallway handrail", costUsd: [0, 150] } },
  { match: /turning space/i, fix: { product: "Rearrange or remove furniture", costUsd: [0, 0] } },
  { match: /medication|cleaning|sharp|knife/i, fix: { product: "Locking cabinet or drawer latches", costUsd: [10, 40] } },
];

export function fixFor(item: Pick<AuditItem, "title" | "detail" | "code">): Fix | undefined {
  const text = `${item.title} ${item.code ?? ""}`;
  return RULES.find((r) => r.match.test(text))?.fix ?? RULES.find((r) => r.match.test(item.detail))?.fix;
}

export const formatCost = ([lo, hi]: [number, number]) => (hi === 0 ? "free" : lo === hi ? `$${lo}` : `$${lo} to $${hi}`);
