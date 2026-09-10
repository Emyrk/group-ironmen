const fs = require("fs");
const path = require("path");

const [variationSourcePath, canonicalSourcePath, runeliteVersion] = process.argv.slice(2);
if (!variationSourcePath || !canonicalSourcePath || !runeliteVersion) {
  console.error(
    "Usage: node scripts/generate-item-variations.js <item_variations.json> <item_canonical.json> <runelite-version>"
  );
  process.exit(1);
}

const variationSource = JSON.parse(fs.readFileSync(variationSourcePath, "utf8"));
const variations = {};
for (const members of Object.values(variationSource)) {
  if (!Array.isArray(members) || members.length === 0) continue;
  variations[members[0]] = members;
}

const dataDir = path.join(__dirname, "..", "src", "data");
const variationOutputPath = path.join(dataDir, "item-variations.json");
fs.writeFileSync(variationOutputPath, `${JSON.stringify({ runeliteVersion, variations })}\n`);

const canonical = JSON.parse(fs.readFileSync(canonicalSourcePath, "utf8"));
const canonicalOutputPath = path.join(dataDir, "item-canonical.json");
fs.writeFileSync(canonicalOutputPath, `${JSON.stringify({ runeliteVersion, canonical })}\n`);

console.log(`Wrote ${Object.keys(variations).length} variation groups to ${variationOutputPath}`);
console.log(`Wrote ${Object.keys(canonical).length} canonical item mappings to ${canonicalOutputPath}`);
