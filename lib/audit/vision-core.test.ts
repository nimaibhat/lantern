import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheKey, hazardsForPhoto, hazardsForRoom, imageType, MAX_PER_ROOM, memoryCache, type AskOne, type Hazard, type MergeRoom } from "./vision-core";

const jpeg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from([n])]);
const rug: Hazard = { title: "Loose rug", detail: "Edge curls up.", fix: "Remove it.", severity: "high" };
const cord: Hazard = { title: "Cord across the path", detail: "Trip risk.", fix: "Cover it.", severity: "low" };
const quiet = () => {};

// A fake model that counts calls and answers by photo.
function fakeAsk(answers: (Hazard[] | Error | undefined)[]) {
  let i = 0;
  const ask: AskOne = async () => {
    const a = answers[i++];
    if (a instanceof Error) throw a;
    return a;
  };
  return { ask, calls: () => i };
}

test("image type from the bytes, not the file name", () => {
  assert.equal(imageType(jpeg(1)), "image/jpeg");
  assert.equal(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(imageType(Buffer.from("<html>not found</html>")), undefined);
  assert.equal(imageType(Buffer.alloc(0)), undefined);
});

test("a bad photo returns [] without calling the model", async () => {
  const m = fakeAsk([[rug]]);
  assert.deepEqual(await hazardsForPhoto(Buffer.from("not an image"), "Hallway", m.ask, memoryCache(), quiet), []);
  assert.equal(m.calls(), 0);
});

test("an API error returns [] and is not cached, so a retry can succeed", async () => {
  const cache = memoryCache();
  const m = fakeAsk([new Error("overloaded"), [rug]]);
  assert.deepEqual(await hazardsForPhoto(jpeg(1), "Hallway", m.ask, cache, quiet), []);
  assert.deepEqual(await hazardsForPhoto(jpeg(1), "Hallway", m.ask, cache, quiet), [rug]);
  assert.equal(m.calls(), 2);
});

test("a re-run costs no new API call", async () => {
  const cache = memoryCache();
  const m = fakeAsk([[rug]]);
  await hazardsForPhoto(jpeg(1), "Hallway", m.ask, cache, quiet);
  assert.deepEqual(await hazardsForPhoto(jpeg(1), "Hallway", m.ask, cache, quiet), [rug]);
  assert.equal(m.calls(), 1);
  assert.notEqual(cacheKey(jpeg(1), "Hallway"), cacheKey(jpeg(2), "Hallway"));
  assert.notEqual(cacheKey(jpeg(1), "Hallway"), cacheKey(jpeg(1), "Kitchen"));
});

test("a room: photos checked in parallel, the same hazard reported once, each tied to its photo", async () => {
  const m = fakeAsk([[rug], [rug, cord], undefined]);
  const items = await hazardsForRoom(
    { id: "hallway", name: "Hallway", center: { x: 1, y: 2 } },
    [{ path: "a.jpg", jpeg: jpeg(1) }, { path: "b.jpg", jpeg: jpeg(2) }, { path: "c.jpg", jpeg: jpeg(3) }],
    m.ask,
    memoryCache(),
    quiet,
  );
  assert.deepEqual(items.map((i) => [i.title, i.photoPath]), [["Loose rug", "a.jpg"], ["Cord across the path", "b.jpg"]]);
  assert.ok(items.every((i) => i.roomId === "hallway" && i.source === "vision" && i.location?.x === 1));
});

const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `${i}.jpg`, jpeg: jpeg(i) }));

test("a room keeps at most a handful of findings, most serious first, without the merge step", async () => {
  const many = Array.from({ length: 8 }, (_, i): Hazard => ({ ...cord, title: `Thing ${i}`, severity: i === 7 ? "high" : "low" }));
  const items = await hazardsForRoom({ id: "r", name: "Room" }, photos(1), fakeAsk([many]).ask, memoryCache(), quiet);
  assert.equal(items.length, MAX_PER_ROOM);
  assert.equal(items[0].title, "Thing 7");
});

test("the merge step decides the room's list, ties each item to its photo, and is cached", async () => {
  let merges = 0;
  const merge: MergeRoom = async (_, found) => {
    merges++;
    return [{ ...found[0], title: "Grab bars needed", photo: 1 }];
  };
  const cache = memoryCache();
  const run = () => hazardsForRoom({ id: "bath", name: "Bathroom" }, photos(2), fakeAsk([[rug], [rug, cord]]).ask, cache, quiet, merge);
  const items = await run();
  assert.deepEqual(items.map((i) => [i.title, i.photoPath]), [["Grab bars needed", "1.jpg"]]);
  await run();
  assert.equal(merges, 1);
});

test("a failed merge falls back to the plain list", async () => {
  const merge: MergeRoom = async () => {
    throw new Error("overloaded");
  };
  const items = await hazardsForRoom({ id: "r", name: "Room" }, photos(2), fakeAsk([[rug], [rug, cord]]).ask, memoryCache(), quiet, merge);
  assert.deepEqual(items.map((i) => i.title), ["Loose rug", "Cord across the path"]);
});
