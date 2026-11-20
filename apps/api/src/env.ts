import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

// Process environment takes precedence, followed by Neon's root .env.local and
// the API's local defaults. Values are loaded once, so restart after changes.
for (const envPath of [resolve(__dirname, '../../../.env.local'), resolve(__dirname, '../.env')]) {
  if (existsSync(envPath)) loadEnvFile(envPath);
}
