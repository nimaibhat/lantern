import { householdForCode } from "@/lib/scan/pairing";

// The phone checks its pairing code here before scanning.
// POST { code } -> { householdName }
export async function POST(request: Request) {
  const { code } = await request.json().catch(() => ({}));
  const household = await householdForCode(code);
  if (!household) return Response.json({ error: "That code is not valid or has expired." }, { status: 401 });
  return Response.json({ householdName: household.name });
}
