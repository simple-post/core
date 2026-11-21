const TWO_DAYS_MS = 48 * 60 * 60_000;

export function setupReminderDueAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + TWO_DAYS_MS);
}

// The key versions the consent copy as well as limiting delivery to one reminder per user.
export function setupReminderKey(userId: string): string {
  return `setup-reminder/v1/${userId}`;
}
