// Tagged console logs, e.g. [sim] kitchen. Never pass phone numbers or keys.
export type Logger = (tag: string, ...args: unknown[]) => void;

export const log: Logger = (tag, ...args) => console.log(`[${tag}]`, ...args);
