import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

// Both src/ and dist/ are directly under apps/api. Resolve independently of cwd.
// Existing process environment variables take precedence over values in this file.
// Restart the API after editing .env; values are loaded once at startup.
const envPath = resolve(__dirname, '../.env');
if (existsSync(envPath)) loadEnvFile(envPath);
