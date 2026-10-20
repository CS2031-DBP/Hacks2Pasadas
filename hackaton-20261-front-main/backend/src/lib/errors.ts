export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly headers: Record<string, string> = {},
    public readonly controlledScenario = false,
  ) {
    super(message);
  }
}
