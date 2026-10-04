import type {AppErrorCode} from './ports';
export class AppFailure extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

export function failureMessage(error: unknown): string {
  return error instanceof AppFailure
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);
}
