const ADDRESS_KEYS = new Set([
  "address_line1",
  "address_line2",
  "address_city",
  "address_state",
  "address_zip",
  "address_country",
  "primary_line",
  "secondary_line",
  "urbanization",
  "city",
  "state",
  "zip_code",
  "postal_code",
  "country",
  "name",
  "company",
  "email",
  "phone",
  "recipient",
  "from",
  "to",
]);

const REDACTED = "[REDACTED]";

export function redactPii(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redactPii);
  if (typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (ADDRESS_KEYS.has(k)) {
      out[k] = typeof v === "string" || typeof v === "number" ? REDACTED : redactPii(v);
    } else if (typeof v === "object" && v !== null) {
      out[k] = redactPii(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function safeStringify(value: unknown, max = 2000): string {
  try {
    const s = JSON.stringify(redactPii(value));
    if (!s) return "";
    return s.length > max ? s.slice(0, max) + "…[truncated]" : s;
  } catch {
    return "[unserializable]";
  }
}
