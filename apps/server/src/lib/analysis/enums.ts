/**
 * Tolerant mapping of model output to an enum value: "Nazi Comparison" / "NAZI_COMPARISON" /
 * "nazi-comparison" → "nazi_comparison"; null when the value is not one of the options. Used
 * wherever a model-facing schema keeps a plain string (nested enums blow past the
 * structured-output grammar limit) and the code normalizes afterwards.
 */
export function enumValue<T extends string>(options: readonly T[], raw: string): T | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (options as readonly string[]).includes(key) ? (key as T) : null;
}
