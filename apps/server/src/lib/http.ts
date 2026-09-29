import type { Response } from "express";
import type { ApiError } from "@kavannah/shared";

/** Sends the shared ApiError shape. */
export function sendError(res: Response, status: number, code: string, message: string, details?: unknown): void {
  const body: ApiError = { error: details === undefined ? { code, message } : { code, message, details } };
  res.status(status).json(body);
}
