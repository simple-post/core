export const normalizeBaseUrl = (baseUrl) => (baseUrl || 'https://app.simplepost.social').replace(/\/+$/, '');

// The Scheduler API only accepts UTC `Z` timestamps, so offset and zone-less
// ISO strings are converted before sending.
export const normalizeScheduledFor = (value) => {
  const parsed = new Date(value || '');
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Scheduled For must be a valid date and time.');
  }
  return parsed.toISOString();
};
