export const SCHEDULED_TIME_REQUIRED_MESSAGE = "Choose a date and time before scheduling this post.";
export const SCHEDULED_TIME_INVALID_MESSAGE = "Choose a valid date and time before scheduling this post.";
export const SCHEDULED_TIME_PAST_MESSAGE = "Scheduled time must be in the future. Please choose a later date and time.";

const DATE_VALUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_VALUE_PATTERN = /^(\d{2}):(\d{2})$/;

export function parseLocalScheduledDateTime(dateValue: string, timeValue: string): Date | null {
  const dateMatch = DATE_VALUE_PATTERN.exec(dateValue);
  const timeMatch = TIME_VALUE_PATTERN.exec(timeValue);

  if (!dateMatch || !timeMatch) {
    return null;
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (month < 1 || month > 12 || hour > 23 || minute > 59) {
    return null;
  }

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }

  return date;
}

export function getLocalScheduledDateTimeError(
  dateValue: string,
  timeValue: string,
  now: Date = new Date(),
): string | null {
  if (!dateValue || !timeValue) {
    return SCHEDULED_TIME_REQUIRED_MESSAGE;
  }

  const scheduledFor = parseLocalScheduledDateTime(dateValue, timeValue);
  if (!scheduledFor) {
    return SCHEDULED_TIME_INVALID_MESSAGE;
  }

  if (scheduledFor <= now) {
    return SCHEDULED_TIME_PAST_MESSAGE;
  }

  return null;
}

export function parseScheduledForValue(value: string): Date | null {
  const scheduledFor = new Date(value);
  return Number.isNaN(scheduledFor.getTime()) ? null : scheduledFor;
}

export function getScheduledForValueError(value: string | undefined, now: Date = new Date()): string | null {
  if (!value) {
    return SCHEDULED_TIME_REQUIRED_MESSAGE;
  }

  const scheduledFor = parseScheduledForValue(value);
  if (!scheduledFor) {
    return "scheduledFor must be a valid ISO 8601 datetime.";
  }

  if (scheduledFor <= now) {
    return SCHEDULED_TIME_PAST_MESSAGE;
  }

  return null;
}
