# Cues: gentle, repeating, scan-aware reminders

How Lantern talks to the person at home and to the family. Built on the risk engine and responder in
`monitor/actions/`. Update this file when a timing or a wording rule changes.

## Principles

- **Name first, every time.** Every cue, closing line and greeting starts with the person's name: it is the most
  personal word and it gets their attention before the rest.
- **Invite, never command.** "Patient, it's still nighttime. Let's go back to bed." Never "go to sleep", never "don't".
- **Same calm words every time.** Changing the wording between repeats confuses. Volume and tone never rise.
- **Give time first.** People are often disoriented for a few minutes after waking, and night bathroom trips are
  normal. Lantern waits before it says anything, except at the front door.
- **Hand off to a person.** A few reminders, then the family. Lantern assists caregivers; it does not replace them.
- **Only say what we know.** The room is named only when the classifier is confident.

## The cue

1. **Grace period.** After getting out of bed at night, nothing plays for `graceS` (5 min, adjustable with
   `CUE_GRACE_MIN`). The dashboard shows "giving Patient time". The front door and a long bathroom stay skip it.
2. **Glow.** The TV wakes with a low warm light.
3. **Chime, then the sentence.** A soft two-note chime (Web Audio, no file), a pause, then the cue:
   - shown big: "Patient, it's still nighttime. Let's go back to bed."
   - shown smaller and spoken after it: "You're in the kitchen. Your bed is back through the hallway."
   - a route strip under it: Kitchen > Hallway > Bedroom, built from the scan's door graph (`roomPath`).
4. **Repeat.** Every `repeatEveryS`, up to `maxCues`, with the same words. If they move, the next cue starts from
   the new room. From the second cue on, the family's recording plays when there is one, or, if it is switched on,
   the Vapi companion takes over and talks with them (`docs/vapi.md`).
5. **Back in a safe room.** The cue stops. In bed at night the screen says "Patient, good night. Sleep well." then
   fades; anywhere else safe (the TV room after leaving the kitchen) it says "Patient, thank you."
6. **Still not back.** The family gets one calm text with what happened and what to do, then a call (the Vapi agent
   when set up, which can hear "yes, I'll go"), then the backup.

Anyone can skip the waiting: the companion's help tool, or `POST /help` on the monitor, texts the family at once.

| Profile | grace | first cue | repeat | cues | family texted (gentle kinds) | urgent kinds texted |
|---|---|---|---|---|---|---|
| demo | 15 s | 3 s after glow | 10 s | 3 | 33 s after glow | 30 s after glow |
| real | 5 min | 10 s after glow | 60 s | 3 | 3 min 10 s after glow | 2 min after glow |

Gentle kinds: `kitchen-night`, `night-wandering`, `no-movement`. Urgent kinds: `exit-approach`,
`long-bathroom-stay` (no grace, the family is texted on the usual timer while cues continue).

## Where cues play

- `/routine` on the TV laptop plays every cue.
- `/routine?room=kitchen` on a laptop in the kitchen (a listener laptop works) plays a cue only while the person is
  in that room, so the voice comes from where they are.
- Night cues use a slower, lower, quieter voice. A recorded family voice always wins over text to speech.

## The day

- The idle screen is a "Now and Next" guide from the routine: the current step big, with the room's photo, and the
  next step small. It follows the clock.
- At a step's time the same chime plays and the step is spoken, name first ("Patient, breakfast is in the kitchen.").
  It repeats every 5 minutes, at most 3 times, until the person reaches that room or someone taps Done. A step more
  than an hour old is never prompted, so nothing plays in the middle of the night. Times show as "3:00 PM".
- **A message from the family.** The overview's "Say something on the TV" box shows what the caregiver types, big,
  for one minute, after the chime, read aloud as "Patient, ...". The monitor refuses while a reminder is playing, so
  two voices never overlap. The text is never logged.
- `/signs` prints a label for each scanned room, with its photo when there is one, to tape on its door.

## Time away

`GET /dwell` on the monitor: the current room, how long they have been there, how long they have been out of bed
during quiet hours, and minutes per room today. The overview shows it live.

## The family

- Texts say what happened, what Lantern already did, and one next step, in plain words. No pronouns for the person.
- When a person who was texted goes back to bed on their own, everyone texted gets "Update: Patient is back in the
  bedroom. No need to check." If they only left the risky room (the TV room at 3 AM), the update says so and that
  Lantern is still watching, without "no need to check".
- When someone taps the link, the other contact (if texted) hears that someone is on it.
- The analytics page shows last night in one paragraph. With `MORNING_SUMMARY_SMS=1` the primary contact also gets
  it by text at the end of quiet hours. Off by default, and dry run like every other message.
- The analytics page also shows which reminder usually works (first, second, third).

## Contract changes (`lib/types`)

All new fields are optional, so older screens and tests keep working.

- `RiskEvent`: `upSince` (left bed), `graceUntil`, `cues` (reminders played so far).
- `PatientState` and the `patient` live frame: `detail`, `route`, `cue`, `roomId`.
- `PatientMode`: new `note` (a message the caregiver typed).
- `risk` live frame: `graceUntil`, `cues`.

New monitor endpoints: `GET /dwell`, `POST /help`, `POST /patient/say`. `GET /analytics/summary` gains `night` and
`workedAfterCue`.

## Code

| Piece | Where |
|---|---|
| Wording (cues, closing, greeting, routine prompts, typed notes) | `lib/cues/script.ts` |
| Family texts and call script | `lib/cues/family.ts` |
| Vapi agent configs | `lib/cues/vapi.ts` |
| Routine prompt timing, calm voice pick | `lib/cues/routine.ts`, `lib/cues/voice.ts` |
| Grace, repeats, escalation, updates | `monitor/actions/responder.ts` |
| Time away | `monitor/actions/dwell.ts` |
| TV page: chime, voice, route strip, companion | `app/routine/` |
| Message box, time today, grace and reminder status | `app/dashboard/_components/` |
| Door signs | `app/signs/` |

## Not built yet

- Smart bulbs as breadcrumb lights along the route (`KASA_BULB_IP`). The route is ready; the bulb protocol is not.
- Staying quiet when a caregiver is home (their phone as a second tag).
- Editing the timings from Settings (Settings does not save yet). Use the profile and `CUE_GRACE_MIN` for now.
- The monitor's POST endpoints (`/patient/say`, `/help`, `/ack`) have no login, like the rest of the monitor: anyone
  on the home network could use them. Fine for the demo; add a shared token before a real home.
