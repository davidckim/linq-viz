function getAllowedNumbers(): string[] {
  return (process.env.ALLOWED_PHONE_NUMBERS ?? '')
    .split(',')
    .map((number) => number.trim())
    .filter(Boolean);
}

export function isAllowedPhone(phoneNumber: string): boolean {
  const allowed = getAllowedNumbers();
  if (allowed.length === 0) return true;
  return allowed.includes(phoneNumber);
}
