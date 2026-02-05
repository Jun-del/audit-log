export type LogErrorFn = (message: string, error: unknown) => void;

export function sanitizeError(error: unknown): Record<string, unknown> | string {
  if (error instanceof Error) {
    const maybeCode = (error as { code?: unknown }).code;
    const code = typeof maybeCode === "string" ? maybeCode : undefined;
    return {
      name: error.name,
      message: error.message,
      code,
    };
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}
