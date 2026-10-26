/// <reference lib="webworker" />
import { blobReadable, bufferReadable, decodeMcap } from "./decode";
import type { WorkerMessage, WorkerRequest } from "./types";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: WorkerMessage, transfer: Transferable[] = []) => ctx.postMessage(m, transfer);

async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Could not fetch the recording (HTTP ${res.status}).`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const reader = res.body.getReader();
  let buf = new Uint8Array(total || 1 << 24);
  let n = 0;
  let last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.length > buf.length) {
      const next = new Uint8Array(Math.max(buf.length * 2, n + value.length));
      next.set(buf.subarray(0, n));
      buf = next;
    }
    buf.set(value, n);
    n += value.length;
    if (Date.now() - last > 100) {
      last = Date.now();
      post({ type: "progress", bytes: n, total, phase: "Downloading" });
    }
  }
  post({ type: "progress", bytes: n, total: n, phase: "Decoding" });
  return buf.subarray(0, n);
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.type !== "open") return;
  try {
    const readable =
      req.source.kind === "file" ? blobReadable(req.source.file) : bufferReadable(await download(req.source.url));
    await decodeMcap(readable, post);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
