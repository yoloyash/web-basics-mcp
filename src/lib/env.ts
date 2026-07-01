import { existsSync } from "node:fs";
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
  const paths = envFilePaths(packageRoot, env);

  if (paths.length === 0) return;

  dotenv.config({
    path: paths,
    processEnv: env,
    override: false,
    quiet: true,
  });
}

function envFilePaths(packageRoot: string, env: NodeJS.ProcessEnv): string[] {
  const paths = [env.WEB_BASICS_ENV_FILE, resolve(packageRoot, ".env")].flatMap((path) =>
    path && existsSync(path) ? [path] : [],
  );

  return [...new Set(paths)];
}

function defaultPackageRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}
