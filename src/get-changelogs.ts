#!/usr/bin/env node
import fs from "fs";
import fetch from "node-fetch";
import { exec } from "child_process";

let packageJsonPath = "package.json";

if (!fs.existsSync(packageJsonPath)) {
  console.log("could not find package.json in this directory");
  process.exit();
}

const packageJsonString = fs.readFileSync(packageJsonPath, "utf-8");

const deps: Array<[string, string]> = [];

const packageJson = JSON.parse(packageJsonString);

if (packageJson.devDependencies) {
  deps.push(...Object.entries<string>(packageJson.devDependencies));
}

if (packageJson.dependencies) {
  deps.push(...Object.entries<string>(packageJson.dependencies));
}

const npmDeps = deps.filter(
  ([name]) => !name.startsWith("http") && !name.startsWith("@types")
);

function getPreviousBreakingVersion(version: string) {
  const parts = version.split(".");
  return parts[0] === "0" ? version : `${parts[0]}.0.0`;
}

function isMajorUpgrade(currentVersion: string, newVersion: string) {
  const currentParts = currentVersion.split(".");
  const newParts = newVersion.split(".");
  if (currentParts[0] === "0") {
    return currentVersion !== newVersion;
  }

  return currentParts[0] !== newParts[0];
}

async function isUrl404(url: string) {
  const response = await fetch(url);
  return response.status === 404;
}

async function getChangelogUrl(repo: string, version: string) {
  const breakingVersion = getPreviousBreakingVersion(version);
  const urls = [
    `${repo}/releases/v${breakingVersion}`,
    `${repo}/blob/master/CHANGELOG.md`,
    `${repo}/blob/master/HISTORY.md`,
    `${repo}/releases/${breakingVersion}`,
    `${repo}/releases/v${version}`,
    `${repo}/releases/v${breakingVersion}`,
  ];

  for (const url of urls) {
    if (!(await isUrl404(url))) {
      return url;
    }
  }

  return repo;
}

(async () => {
  for (const [name, installedVersion] of npmDeps) {
    const cleanedInstalledVersion = installedVersion.replace(/^[^\d]+/, "");
    let result;
    try {
      result = await new Promise<string>((res, rej) =>
        exec(
          `npm view --json ${name} version repository.url`,
          (err, stdout, stderr) => {
            if (err) {
              rej(stderr);
            } else {
              res(stdout);
            }
          }
        )
      );
    } catch (err) {
      if (err.includes("not in the npm registry")) {
        console.log(`skipping ${name} because it's not in NPM registry`);
        continue;
      } else {
        throw err;
      }
    }
    const data = JSON.parse(result.toString()) as {
      version: string;
      ["repository.url"]?: string;
    };
    if (!isMajorUpgrade(cleanedInstalledVersion, data.version)) {
      continue;
    }
    if (!data["repository.url"]) {
      console.log(
        `${name} doesn't have a repo associated with the npm package`
      );
      continue;
    }

    if (!data["repository.url"].includes("github")) {
      console.log(
        `${name} is not on github, but checkout: ${data["repository.url"]}`
      );
      continue;
    }

    const repo = data["repository.url"]
      .replace("git+", "")
      .replace(".git", "")
      .replace("git://", "https://")
      .replace("ssh://git@", "https://");

    try {
      console.log(
        `${name}: ${cleanedInstalledVersion} -> ${
          data.version
        } ${await getChangelogUrl(repo, data.version)}`
      );
    } catch (err) {
      console.log("failed for repo: " + repo);
      throw err;
    }
  }
})().catch((err) => {
  throw err;
});
