import axios from 'axios';

interface ApiErrorBody {
  detail?: unknown;
}

interface ValidationIssue {
  loc?: unknown;
  msg?: unknown;
}

function validationIssueMessage(issue: ValidationIssue): string | null {
  if (typeof issue.msg !== 'string') return null;
  const location = Array.isArray(issue.loc)
    ? issue.loc.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number').join('.')
    : '';
  return location ? `${location}: ${issue.msg}` : issue.msg;
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) => validationIssueMessage(typeof item === 'object' && item !== null ? item as ValidationIssue : {}))
        .filter((message): message is string => Boolean(message));
      if (messages.length) return messages.join('\n');
    }
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
