import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheKey, hazardsForPhoto, hazardsForRoom, imageType, memoryCache, type AskOne, type Hazard } from "./vision-core";

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
