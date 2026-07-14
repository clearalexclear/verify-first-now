const USCC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];
const USCC_ALPHABET = "0123456789ABCDEFGHJKLMNPQRTUWXY";
const USCC_ALLOWED = new RegExp(`^[${USCC_ALPHABET}]{18}$`);
const COMMON_NON_USCC_TOKENS = new Set([
  "TELECOMMUNICATIONS",
  "CUSTOMDIALOGCONTRO",
  "REGISTERSYSTEMINFO",
]);

export function isStrictUsccCandidate(value: string | null | undefined): boolean {
  const code = (value ?? "").trim().toUpperCase();
  if (!/^[0-9A-Z]{18}$/.test(code)) return false;
  if (!USCC_ALLOWED.test(code)) return false;
  if (/^[A-Z]+$/.test(code)) return false;
  if (COMMON_NON_USCC_TOKENS.has(code)) return false;
  if (!/^[159Y][1239][0-9]{6}[0-9A-Z]{10}$/.test(code)) return false;
  const digitCount = (code.match(/[0-9]/g) ?? []).length;
  if (digitCount < 9) return false;
  return true;
}

export function validateUsccChecksum(uscc: string | null | undefined): boolean {
  const code = (uscc ?? "").trim().toUpperCase();
  if (!isStrictUsccCandidate(code)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    const value = USCC_ALPHABET.indexOf(code[i]);
    if (value < 0) return false;
    sum += value * USCC_WEIGHTS[i];
  }
  const checkIndex = (31 - (sum % 31)) % 31;
  return USCC_ALPHABET[checkIndex] === code[17];
}
