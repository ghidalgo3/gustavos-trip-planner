import { readFile } from "node:fs/promises";

const [version, changelogPath] = process.argv.slice(2);
if (!/^\d{4}\.\d{2}\.\d{2}\.[1-9]\d*$/.test(version ?? "") || !changelogPath) {
  throw new Error("Usage: node changelog.mjs YYYY.MM.DD.N CHANGELOG.md");
}

const changelog = await readFile(changelogPath, "utf8");
const headings = [...changelog.matchAll(/^## ([^\r\n]+)\r?$/gm)];
if (
  headings[0]?.[1] !== "Unreleased" ||
  headings.filter((heading) => heading[1] === "Unreleased").length !== 1
) {
  throw new Error(
    "CHANGELOG.md must begin its release sections with exactly one ## Unreleased heading",
  );
}
if (headings.some((heading) => heading[1] === version)) {
  throw new Error(`CHANGELOG.md already contains ## ${version}`);
}

const headingEnd = headings[0].index + 3 + headings[0][1].length;
const unreleased = changelog.slice(headingEnd, headings[1]?.index ?? changelog.length);
const entries = unreleased
  .replace(/^### (Added|Changed|Fixed|Removed)[ \t]*\r?$/gm, "")
  .trim();
const newline = changelog.includes("\r\n") ? "\r\n" : "\n";

// Insert only a heading: retain every entry, group, and older section verbatim.
process.stdout.write(
  entries
    ? `${changelog.slice(0, headingEnd)}${newline}${newline}## ${version}${changelog.slice(headingEnd)}`
    : changelog,
);
