const fs = require("fs");
const path = require("path");

const [sourcePath, runeliteVersion] = process.argv.slice(2);
if (!sourcePath || !runeliteVersion) {
  console.error("Usage: node scripts/generate-item-variations.js <item_variations.json> <runelite-version>");
  process.exit(1);
}

const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const variations = {};
for (const members of Object.values(source)) {
  if (!Array.isArray(members) || members.length === 0) continue;
  variations[members[0]] = members;
}

const outputPath = path.join(__dirname, "..", "src", "data", "item-variations.json");
fs.writeFileSync(outputPath, `${JSON.stringify({ runeliteVersion, variations })}\n`);
console.log(`Wrote ${Object.keys(variations).length} variation groups to ${outputPath}`);
