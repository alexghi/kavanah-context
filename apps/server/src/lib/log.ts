export interface Logger {
  info(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
}

function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export const consoleLogger: Logger = {
  info: (message, ...rest) => console.log(`[kavannah ${stamp()}] ${message}`, ...rest),
  warn: (message, ...rest) => console.warn(`[kavannah ${stamp()}] WARN ${message}`, ...rest),
  error: (message, ...rest) => console.error(`[kavannah ${stamp()}] ERROR ${message}`, ...rest),
};

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
