import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export interface LoadEnvOptions {
  env?: NodeJS.ProcessEnv;
  packageRoot?: string;
}

export function loadEnv(options: LoadEnvOptions = {}): void {
  const env = options.env ?? process.env;
  const packageRoot = options.packageRoot ?? defaultPackageRoot();

  dotenv.config({
    path: resolve(packageRoot, ".env"),
    processEnv: env,
    override: false,
    quiet: true,
  });
}

function defaultPackageRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}
