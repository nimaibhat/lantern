import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ackBody, listenForAcks, readLine } from "./ntfy-acks";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("readLine finds the alert id in an ack message and ignores everything else", () => {
  assert.equal(ackBody("a1"), "ack a1");
  assert.deepEqual(readLine(JSON.stringify({ id: "m1", event: "message", message: "ack 4c85-1f3e" })), { id: "m1", alertId: "4c85-1f3e" });
  assert.deepEqual(readLine(JSON.stringify({ id: "m2", event: "message", message: "hello" })), { id: "m2", alertId: undefined });
  assert.deepEqual(readLine(JSON.stringify({ id: "k1", event: "keepalive" })), {});
  assert.deepEqual(readLine(JSON.stringify({ id: "m3", event: "message", message: "ack ../../etc" })), { id: "m3", alertId: undefined });
  assert.deepEqual(readLine("not json"), {});
});

test("the listener streams the ack topic, hands over ack ids, and stops cleanly", async () => {
  const lines: string[] = [];
  let url = "", auth: string | undefined, aborted = false;
  globalThis.fetch = (async (u: string, init: RequestInit) => {
    url = u;
    auth = (init.headers as Record<string, string>).Authorization;
    init.signal?.addEventListener("abort", () => (aborted = true));
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        // A message split across chunks, as a real stream can deliver it.
        c.enqueue(enc.encode(JSON.stringify({ id: "o1", event: "open" }) + "\n" + '{"id":"m1","event":"mess'));
        c.enqueue(enc.encode('age","message":"ack a1"}\n' + JSON.stringify({ id: "m2", event: "message", message: "hi" }) + "\n"));
        init.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;

  const acked: string[] = [];
  const stop = listenForAcks({ server: "https://ntfy.sh", topic: "lantern-ack-x", token: "tk", onAck: (id) => acked.push(id), log: (...a) => void lines.push(a.join(" ")) });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(url, "https://ntfy.sh/lantern-ack-x/json");
  assert.equal(auth, "Bearer tk");
  assert.deepEqual(acked, ["a1"]);
  stop();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(aborted, true);
  for (const l of lines) assert.doesNotMatch(l, /lantern-ack-x/); // topics are never logged
});

test("after a dropped stream it reconnects from the last message seen", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (u: string, init: RequestInit) => {
    urls.push(u);
    if (urls.length === 1) return new Response(JSON.stringify({ id: "m9", event: "message", message: "hi" }) + "\n", { status: 200 }); // then ends
    return new Response(new ReadableStream({ start: (c) => init.signal?.addEventListener("abort", () => c.close()) }), { status: 200 });
  }) as typeof fetch;
  const stop = listenForAcks({ server: "https://ntfy.sh", topic: "t", onAck: () => {}, log: () => {} });
  await new Promise((r) => setTimeout(r, 1200)); // first retry waits 1 s
  stop();
  assert.equal(urls[1], "https://ntfy.sh/t/json?since=m9");
});
