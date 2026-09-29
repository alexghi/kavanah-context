#!/usr/bin/env node
/**
 * Manages the per-person access keys stored in .env as
 *   KAVANNAH_ACCESS_KEYS=alex:kv_…,judge-1:kv_…
 *
 *   npm run keys -- add <name>      create a key for <name> and print it (once)
 *   npm run keys -- list            names and key prefixes
 *   npm run keys -- show <name>     print the full key again
 *   npm run keys -- remove <name>   revoke a key
 *
 * Restart the local server afterwards; for Cloud Run run `deploy/cloudrun.sh keys`.
 * Set KAVANNAH_ENV_FILE to edit another file than the repo's .env.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = process.env.KAVANNAH_ENV_FILE ? path.resolve(process.env.KAVANNAH_ENV_FILE) : path.resolve(here, "..", "..", "..", ".env");
const VAR = "KAVANNAH_ACCESS_KEYS";
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/i;

const usage = () => {
  console.error("Usage: npm run keys -- add <name> | list | show <name> | remove <name>");
  process.exit(2);
};

function readEnv() {
  return fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
}

function parseKeys(value) {
  const keys = [];
  for (const entry of value.split(/[,;\n]/)) {
    const trimmed = entry.trim();
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    keys.push({ name: trimmed.slice(0, colon).trim(), key: trimmed.slice(colon + 1).trim() });
  }
  return keys;
}

function currentKeys(text) {
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${VAR}=`));
  if (!line) return [];
  let value = line.slice(VAR.length + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return parseKeys(value);
}

function writeKeys(text, keys) {
  const serialized = `${VAR}=${keys.map((k) => `${k.name}:${k.key}`).join(",")}`;
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((l) => l.startsWith(`${VAR}=`));
  if (index >= 0) lines[index] = serialized;
  else {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push("# Per-person access keys for a hosted server (managed by `npm run keys`).", serialized, "");
  }
  fs.writeFileSync(ENV_FILE, lines.join("\n"), { mode: 0o600 });
}

const [command, name] = process.argv.slice(2);
const text = readEnv();
const keys = currentKeys(text);

switch (command) {
  case "list": {
    if (keys.length === 0) console.log(`No access keys in ${ENV_FILE}. Add one with: npm run keys -- add <name>`);
    for (const k of keys) console.log(`${k.name.padEnd(20)} ${k.key.slice(0, 7)}…`);
    break;
  }
  case "show": {
    if (!name) usage();
    const found = keys.find((k) => k.name === name);
    if (!found) {
      console.error(`No key named "${name}".`);
      process.exit(1);
    }
    console.log(found.key);
    break;
  }
  case "add": {
    if (!name) usage();
    if (!NAME_PATTERN.test(name)) {
      console.error(`"${name}" is not a valid name (letters, digits, . _ - ; max 32 characters).`);
      process.exit(1);
    }
    if (keys.some((k) => k.name === name)) {
      console.error(`A key named "${name}" already exists. Remove it first, or pick another name.`);
      process.exit(1);
    }
    const key = `kv_${randomBytes(24).toString("base64url")}`;
    writeKeys(text, [...keys, { name, key }]);
    console.log(`Added an access key for "${name}" to ${path.relative(process.cwd(), ENV_FILE) || ".env"}:\n\n  ${key}\n`);
    console.log(`Give it to ${name}: Kavannah → Settings → Access key.`);
    console.log("Restart the local server to activate it; for Cloud Run run: deploy/cloudrun.sh keys");
    break;
  }
  case "remove": {
    if (!name) usage();
    if (!keys.some((k) => k.name === name)) {
      console.error(`No key named "${name}".`);
      process.exit(1);
    }
    writeKeys(
      text,
      keys.filter((k) => k.name !== name),
    );
    console.log(`Removed the key for "${name}". Restart the server (or run deploy/cloudrun.sh keys) to revoke it.`);
    break;
  }
  default:
    usage();
}
