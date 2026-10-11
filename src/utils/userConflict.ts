
































const USERS_NAME_UNIQUE_VIOLATION_RE =
  /^(?:D1_ERROR: )?UNIQUE constraint failed: users\.name(?:: SQLITE_CONSTRAINT \(extended: SQLITE_CONSTRAINT_UNIQUE\))?$/;

const MAX_CAUSE_DEPTH = 25;






export function isUsernameUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  let depth = 0;

  while (
    typeof current === "object" &&
    current !== null &&
    !seen.has(current) &&
    depth < MAX_CAUSE_DEPTH
  ) {
    seen.add(current);
    const message = (current as { message?: unknown }).message;
    if (typeof message === "string" && USERS_NAME_UNIQUE_VIOLATION_RE.test(message)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
    depth += 1;
  }

  return false;
}
