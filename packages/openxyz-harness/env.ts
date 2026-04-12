export interface EnvEntry {
  key: string;
  value: string | undefined;
  required: boolean;
  description: string;
}

const registry: EnvEntry[] = [];

export function getEnv(key: string, opts: { description: string; required?: false }): string;
export function getEnv(key: string, opts: { description: string; required: false }): string | undefined;
export function getEnv(key: string, opts: { description: string; required?: boolean }): string | undefined {
  const val = process.env[key];
  const required = opts.required !== false;
  registry.push({ key, required, description: opts.description, value: val });
  return val;
}

export function validateEnv(): void {
  if (registry.length === 0) return;
  console.log("[openxyz] env:");
  for (const { key, required, description, value } of registry) {
    const status = value ? "set" : required ? "MISSING" : "not set";
    console.log(`  ${key.padEnd(30)} ${status} (${description})`);
  }
  const missing = registry.filter((e) => e.required && !e.value);
  if (missing.length > 0) {
    throw new Error(`[openxyz] missing required env: ${missing.map((e) => e.key).join(", ")}`);
  }
}
