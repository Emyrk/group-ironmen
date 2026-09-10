const MAX_ITEMS = 4000;

function csv(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function parseCsv(text) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function integer(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer`);
  return parsed;
}

function finish(name, iconItemId, itemIds, positions) {
  const normalizedName = String(name || "")
    .trim()
    .toLowerCase();
  if (!normalizedName || normalizedName.length > 50 || /[<>/:,]/.test(normalizedName)) {
    throw new Error("Invalid tag name");
  }
  const icon = integer(iconItemId, "Icon item ID");
  if (icon < 0) throw new Error("Icon item ID must be non-negative");
  const items = [...new Set(itemIds.map((id) => integer(id, "Item ID")))]
    .filter((id) => id !== 0)
    .sort((a, b) => a - b);
  if (items.length > MAX_ITEMS) throw new Error("A tag may contain at most 4000 items");
  let layout = null;
  if (positions.size) {
    const last = Math.max(...positions.keys());
    if (last >= MAX_ITEMS) throw new Error("A layout may contain at most 4000 slots");
    layout = Array(last + 1).fill(-1);
    for (const [index, id] of positions) {
      if (index < 0 || id <= 0) throw new Error("Layout positions require positive item IDs");
      layout[index] = id;
      if (!items.includes(id)) items.push(id);
    }
    items.sort((a, b) => a - b);
  }
  return { name: normalizedName, iconItemId: icon, itemIds: items, layout };
}

export function parseBankTag(text) {
  const tokens = parseCsv(String(text || "").trim());
  if (!tokens[0]) throw new Error("Paste a bank tag or bank layout export");
  const positions = new Map();
  const itemIds = [];
  let name;
  let iconItemId;

  if (tokens[0] === "banktags") {
    if (tokens[1] !== "1") throw new Error("Unsupported bank tag export version");
    name = tokens[2];
    iconItemId = tokens[3];
    let index = 4;
    while (index < tokens.length && tokens[index] !== "layout") itemIds.push(integer(tokens[index++], "Item ID"));
    for (index += 1; index < tokens.length; index += 2) {
      if (tokens[index] === "") break;
      positions.set(integer(tokens[index], "Layout index"), integer(tokens[index + 1], "Layout item ID"));
    }
  } else if (tokens[0].startsWith("banktaglayoutsplugin:")) {
    name = tokens[0].slice("banktaglayoutsplugin:".length);
    let index = 1;
    while (index < tokens.length && !tokens[index].startsWith("banktag:")) {
      const [id, position] = tokens[index++].split(":");
      positions.set(integer(position, "Layout index"), integer(id, "Layout item ID"));
    }
    if (index >= tokens.length) throw new Error("Bank Layouts export is missing its bank tag");
    const bankTagName = tokens[index].slice("banktag:".length);
    if (!name) name = bankTagName;
    iconItemId = tokens[index + 1];
    for (index += 2; index < tokens.length; index += 1) {
      if (tokens[index] !== "") itemIds.push(integer(tokens[index], "Item ID"));
    }
  } else {
    name = tokens[0].replace(/^banktag:/, "");
    iconItemId = tokens[1];
    for (let index = 2; index < tokens.length; index += 1) {
      if (tokens[index] !== "") itemIds.push(integer(tokens[index], "Item ID"));
    }
  }
  return finish(name, iconItemId, itemIds, positions);
}

export function exportRuneLite(tag) {
  const layout = tag.layout || [];
  const laidOut = new Set(layout.filter((id) => id > 0));
  const values = ["banktags", "1", tag.name, tag.iconItemId];
  values.push(...tag.itemIds.filter((id) => !laidOut.has(id)));
  if (laidOut.size) {
    values.push("layout");
    layout.forEach((id, index) => {
      if (id > 0) values.push(index, id);
    });
  }
  return values.map(csv).join(",");
}

export function exportBankLayouts(tag) {
  const values = [`banktaglayoutsplugin:${tag.name}`];
  (tag.layout || []).forEach((id, index) => {
    if (id > 0) values.push(`${id}:${index}`);
  });
  values.push(`banktag:${tag.name}`, tag.iconItemId, ...tag.itemIds);
  return values.map(csv).join(",");
}

export function validateDraft(tag) {
  const normalized = finish(tag.name, tag.iconItemId, tag.itemIds, new Map());
  if (tag.layout === null) return { ...normalized, layout: null };
  if (!Array.isArray(tag.layout) || tag.layout.length > MAX_ITEMS)
    throw new Error("A layout may contain at most 4000 slots");
  const layout = tag.layout.map((id) => integer(id, "Layout item ID"));
  if (layout.some((id) => id < -1 || id === 0)) throw new Error("Layout entries must be -1 or positive item IDs");
  for (const id of layout) {
    if (id > 0 && !normalized.itemIds.includes(id)) normalized.itemIds.push(id);
  }
  normalized.itemIds.sort((a, b) => a - b);
  return { ...normalized, layout };
}
