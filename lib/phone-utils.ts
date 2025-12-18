/**
 * Utility functions for phone number formatting and validation
 */

// Zero-width and bidi marks that often sneak in from copy/paste
const ZERO_WIDTH_REGEX = /[\u200B-\u200D\u2060\uFEFF]/g; // ZWSP, ZWNJ, ZWJ, WJ, BOM
const BIDI_MARKS_REGEX = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g; // LRE..RLO, LRI..PDI, LRM, RLM
const NBSP_REGEX = /\u00A0/g; // non-breaking space

/** Strip invisible/bidi characters that break equality/endsWith checks */
export function stripBidiAndZeroWidth(input: string | null | undefined): string {
  if (!input) return '';
  return String(input)
    .replace(NBSP_REGEX, ' ')
    .replace(ZERO_WIDTH_REGEX, '')
    .replace(BIDI_MARKS_REGEX, '')
    .trim();
}

/** Return only digits from a phone-like string */
export function onlyDigits(input: string | null | undefined): string {
  return stripBidiAndZeroWidth(input).replace(/\D/g, '');
}

/** Last 10 digits helper (useful for US matching) */
export function last10Digits(input: string | null | undefined): string {
  const d = onlyDigits(input);
  return d.length >= 10 ? d.slice(-10) : d;
}

/**
 * Format a phone number to E.164 format required by Telnyx
 * - Removes invisible/bidi marks and punctuation
 * - Defaults 10-digit numbers to +1 (US)
 * @param phoneNumber - Raw phone number (e.g., "17542947595", "754-294-7595", "(754) 294-7595", "+1-754-294-7595")
 * @returns Formatted phone number (e.g., "+17542947595") or null if invalid
 */
export function formatPhoneNumberForTelnyx(phoneNumber: string | null | undefined): string | null {
  if (!phoneNumber) return null;

  let cleaned = stripBidiAndZeroWidth(phoneNumber);

  // Remove leading/trailing quotes that might come from CSV parsing
  cleaned = cleaned.replace(/^['"`]+|['"`]+$/g, '').trim();

  // If already in correct E.164 format, return as-is
  if (isValidE164PhoneNumber(cleaned)) {
    return cleaned;
  }

  // Remove all non-digit characters (but preserve the + if it's at the start)
  const hasPlus = cleaned.startsWith('+');
  const digitsOnly = cleaned.replace(/\D/g, '');

  // Reject phone numbers that are too long (max 15 digits for E.164)
  if (digitsOnly.length > 15) {
    console.warn('[formatPhoneNumberForTelnyx] Phone number too long:', phoneNumber, '-> digits:', digitsOnly.length);
    return null;
  }

  // Handle different US phone number formats
  if (digitsOnly.length === 10) {
    // Add US country code if missing (e.g., "7542947595" -> "+17542947595")
    return `+1${digitsOnly}`;
  } else if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    // Already has US country code (e.g., "17542947595" -> "+17542947595")
    return `+${digitsOnly}`;
  } else if (digitsOnly.length > 11 && digitsOnly.length <= 15) {
    // International number with country code (e.g., "923312378492" -> "+923312378492")
    // If original had +, it's definitely international; if not but > 11 digits, assume international
    return `+${digitsOnly}`;
  } else if (digitsOnly.length >= 7 && hasPlus) {
    // Has + but fewer than expected digits - still try to format it (min 7 for small countries)
    return `+${digitsOnly}`;
  }

  // Invalid phone number (too short or doesn't meet criteria)
  return null;
}

/**
 * Validate if a phone number is in valid E.164 format
 * @param phoneNumber - Phone number to validate
 * @returns true if valid E.164 format
 */
export function isValidE164PhoneNumber(phoneNumber: string): boolean {
  // E.164 format: + followed by 7-15 digits (country code + number)
  // 7 digits minimum (e.g., +1234567 for small countries)
  // 15 digits maximum per ITU-T E.164 standard
  const e164Regex = /^\+[1-9]\d{6,14}$/;
  return e164Regex.test(stripBidiAndZeroWidth(phoneNumber));
}

/**
 * Format phone number for display (e.g., "+17542947595" -> "(754) 294-7595")
 * @param phoneNumber - E.164 formatted phone number
 * @returns Human-readable phone number
 */
export function formatPhoneNumberForDisplay(phoneNumber: string | null | undefined): string {
  if (!phoneNumber) return '';

  const digitsOnly = onlyDigits(phoneNumber);

  // US phone number formatting
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    const areaCode = digitsOnly.slice(1, 4);
    const exchange = digitsOnly.slice(4, 7);
    const number = digitsOnly.slice(7, 11);
    return `(${areaCode}) ${exchange}-${number}`;
  }

  // International or other formats - just return with + prefix
  const cleaned = stripBidiAndZeroWidth(phoneNumber);
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

/**
 * Get the best available phone number from a contact
 * @param contact - Contact object with phone1, phone2, phone3 fields
 * @returns Best available phone number in E.164 format or null
 */
export function getBestPhoneNumber(contact: { phone1?: string | null, phone2?: string | null, phone3?: string | null }): string | null {
  const phones = [contact.phone1, contact.phone2, contact.phone3].filter(Boolean);

  for (const phone of phones) {
    const formatted = formatPhoneNumberForTelnyx(phone);
    if (formatted && isValidE164PhoneNumber(formatted)) {
      return formatted;
    }
  }

  return null;
}

/**
 * Validate and format multiple phone numbers
 * @param phoneNumbers - Array of phone numbers to format
 * @returns Array of valid E.164 formatted phone numbers
 */
export function formatPhoneNumbersForTelnyx(phoneNumbers: (string | null | undefined)[]): string[] {
  return phoneNumbers
    .map(formatPhoneNumberForTelnyx)
    .filter((phone): phone is string => phone !== null && isValidE164PhoneNumber(phone));
}

/**
 * Alias for formatPhoneNumberForTelnyx - formats phone to E.164 format
 * @param phoneNumber - Raw phone number
 * @returns Formatted phone number in E.164 format or null if invalid
 */
export const formatPhoneToE164 = formatPhoneNumberForTelnyx;
