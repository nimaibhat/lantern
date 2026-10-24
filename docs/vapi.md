# Vapi voice agents

Lantern uses Vapi for two voices. Both are built in code and stay off until keys are set; without them Lantern falls
back to a plain Twilio call and the browser's voice, so nothing breaks. Read `docs/cues.md` first for when each one
speaks.

| | Family call | Companion |
|---|---|---|
| Who hears it | the primary contact's phone | the person at home, on the TV page |
| When | the call step of the escalation, after the family was texted | from the second reminder, if the first did not work (`NEXT_PUBLIC_VAPI_COMPANION_FROM_CUE=1`: from the first) |
| Voice | `Elliot` (Vapi: "natural, calm") | `Zoe` (Vapi: "calm, soothing"), speed 0.9 |
| Model | `claude-haiku-5-5` (Anthropic through Vapi), short replies | same |
| Can do | answer questions from the facts, hear "yes, I'll go" or "no" | talk gently, ask the family for help |
| Code | `lib/cues/vapi.ts`, `monitor/actions/vapi.ts` | `lib/cues/vapi.ts`, `app/routine/companion.ts` |
| Turned on by | `VAPI_API_KEY` and `VAPI_PHONE_NUMBER_ID` | `NEXT_PUBLIC_VAPI_PUBLIC_KEY` and `NEXT_PUBLIC_VAPI_COMPANION=1` |

## Setup (the person adding the keys)

1. In the [Vapi dashboard](https://dashboard.vapi.ai), copy the **private** API key and the **public** key.
2. **Phone numbers > Import** a Twilio number. Free Vapi numbers can only receive calls, and the family call is
   outbound. Copy the imported number's **ID** (not the number itself).
3. In `.env.local` (never committed):
   ```
   VAPI_API_KEY=<private key>
   VAPI_PHONE_NUMBER_ID=<phone number id>
   NEXT_PUBLIC_VAPI_PUBLIC_KEY=<public key>
   NEXT_PUBLIC_VAPI_COMPANION=1
   ```
   The private key is read only by the monitor. Only the public key may have the `NEXT_PUBLIC_` prefix.
4. Restart `npm run dev:monitor` and `npm run dev`. The monitor logs `vapi live` instead of `vapi off`.
5. On the TV laptop, open `/routine`, tap "Tap to start" and allow the microphone. That way no permission prompt
   appears in the middle of the night.

## Trying it

- **Family call**: run the monitor with `DEMO_HOUR=3`, set `CAREGIVER_PHONE_NUMBER` to your own phone, then walk the
  simulator bedroom > hallway > kitchen and stay. With the demo profile the text comes about 48 s after reaching the
  kitchen and the call 45 s later. Say "yes, I'll go check": the dashboard shows the call acknowledged and the backup
  is never texted. Say "I can't": the backup is texted at once.
- **Companion**: same walk with `/routine?preview=1` open. The first reminder is the scripted voice; from the second
  the companion talks. Answer it. Walk to the bedroom in the simulator and it says "Rosa, good night. Sleep well." and
  hangs up. Say "I fell": the monitor logs `help asked` and texts the family immediately.

## How it fits together

- **The family call** is a `POST https://api.vapi.ai/call` with the whole assistant inline (`familyCallRequest`). The
  monitor then reads `GET /call/:id` every 5 s for up to 4 minutes. When the call ends, Vapi's call analysis fills
  `analysis.structuredData.canCheck` from the transcript:
  - `canCheck` true: the alert is acknowledged and the others are told someone is on it.
  - `canCheck` false, no answer or voicemail: the backup is texted straight away.
  - No outcome: the normal timers carry on.

  Polling means no public webhook or tunnel is needed for the demo.
- **The companion** starts a web call with `@vapi-ai/web` (pinned to 2.7.1, loaded only when a call starts). Its one
  tool, `ask_family_for_help`, has no server URL, so Vapi hands it to the browser, which posts to the monitor's
  `POST /help`. When the person moves, the screen quietly tells the agent the new room (`add-message`). When they
  reach a safe room, the screen has the agent say the closing line and end the call.
- **Using a dashboard assistant instead**: set `VAPI_FAMILY_ASSISTANT_ID`. Its prompt can use `{{name}}`,
  `{{situation}}`, `{{since}}`, `{{room}}` and `{{reminders}}`. Add the same structured data schema (`canCheck`
  boolean) to its analysis plan, or the call outcome will read as unknown.

## Safety and privacy

- Recording is off on both agents (`artifactPlan.recordingEnabled: false`). Vapi still processes the audio and keeps
  transcripts under its own retention. Say so to the family before turning the companion on.
- Both prompts say the agent is automated and never claims to be a person or a relative. The family agent gives no
  medical advice and says to call 911 for an emergency. The companion invites, never orders, and never argues.
- The companion is opt-in, starts only after a scripted reminder, and ends after 4 minutes or 45 s of silence. If it
  fails to start (no microphone, no network, bad key), the scripted voice plays instead.
- Phone numbers are never logged; errors from Vapi are scrubbed of numbers the same way as Twilio's.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Monitor says `vapi off` | `VAPI_API_KEY` or `VAPI_PHONE_NUMBER_ID` missing, or `VAPI_DRY_RUN=1` |
| `Vapi 400` on the call | the phone number id is wrong, or the number is a free Vapi number (inbound only) |
| Call works but is never acknowledged | a dashboard assistant without the `canCheck` schema; or the call ended with no clear answer |
| Companion never starts | `NEXT_PUBLIC_VAPI_COMPANION` is not `1`, the microphone was denied, or only the first reminder has played |
| A model or voice error from Vapi | set `VAPI_MODEL` or the voice id variables to values Vapi lists in its dashboard |
