// The contract each owner's module implements. See PROJECT_PLAN.md 1.3.

import type { HomeModel } from "@/lib/types";
import type { Bus } from "./bus";
import type { Config } from "./config";
import type { Logger } from "./log";
import type { Store } from "./store";

export interface Req {
  body: unknown; // parsed JSON; validate before use
  query: URLSearchParams;
  params: Record<string, string>; // from :name segments, e.g. /ack/:alertId
}

// Return a value to send it as JSON. Throw HttpError for a client error.
export type Handler = (req: Req) => unknown | Promise<unknown>;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface ModuleCtx {
  http: { get(path: string, h: Handler): void; post(path: string, h: Handler): void };
  bus: Bus;
  store: Store;
  cfg: Config;
  log: Logger;
  world(): HomeModel; // current home model, provided by the world module
}

// register may return a stop function for anything it keeps open (a socket, a stream); the monitor calls it on close.
export type Stop = () => void;

export interface MonitorModule {
  name: string;
  register(ctx: ModuleCtx): void | Stop | Promise<void | Stop>;
}
