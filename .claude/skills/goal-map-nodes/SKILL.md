---
name: goal-map-nodes
description: Researches, adds, and edits OSRS Goal Map nodes, validators, and relationships. Use when changing progression goals, requirements, recommendations, alternatives, unlocks, or Wiki-sourced goal metadata in this repository.
compatibility: Requires network access for OSRS Wiki research; prefers the repository's osrs MCP server.
metadata:
  type: workflow
  binding: advisory
---

# Goal Map nodes

Maintain the code-defined OSRS progression graph. Graph structure and executable validators live in Git; SQLite stores evaluated progress and completion history only.

## Workflow

1. **Research before editing.**

   - Prefer the `osrs` MCP tools configured in `.mcp.json`:
     - `osrs_wiki_search`
     - `osrs_wiki_get_page_info`
     - `osrs_wiki_parse_page`
     - `search_objtypes` for item IDs when repository item data is insufficient
   - Use direct pages on `https://oldschool.runescape.wiki/` if MCP is unavailable.
   - Read the activity/strategy page, each claimed prerequisite page, and relevant reward/item pages.
   - Record source URLs on the node. Do not rely on memory for levels, quests, item IDs, diary effects, or whether a recommendation is mandatory.

2. **Inspect the reusable registry first.**

   - Search existing Goal Map definition files for the concept and stable ID.
   - Reuse existing skill, quest, item-set, diary, activity, and unlock nodes rather than creating duplicates.
   - A single node may support many goals; represent synergy with additional edges.

3. **Choose scope deliberately.**

   - `character`: evaluated independently for the selected member.
   - `group`: one shared group state satisfies the node for every member.
   - Use group scope for tradeable/shared Group Ironman resources such as a complete Guthan's set.
   - Do not use group scope for personal quest, skill, diary, cape, or spellbook unlocks.

4. **Choose relationship semantics.**

   - `requires`: hard prerequisite.
   - `recommended`: meaningfully improves success or efficiency.
   - `optional`: useful but unnecessary.
   - `alternative`: one path among substitutes; give related edges the same `alternativeGroup`.
   - `unlocks`: the source makes the target available.
   - `improves`: the source improves the target.
   - `supplies`: the source produces a consumed resource for the target.
   - Never convert Wiki recommendations into hard requirements.

5. **Implement validation.**

   - Prefer reusable validator helpers for skills, quests, group items, item sets, and Boolean composition.
   - Use custom JavaScript only when the reusable helpers cannot express the rule cleanly.
   - Validators return `{ complete, progress, evidence }`.
   - Evidence must explain the current state, such as `71/77 Runecraft` or `3/4 Guthan pieces owned by the group`.
   - Never execute JavaScript loaded from SQLite or user input.
   - If the upstream API cannot observe a condition reliably, return an incomplete result that clearly says it is not automatically observable. Do not guess.

6. **Connect the node.**

   - Ensure every non-root node has at least one meaningful incoming or outgoing edge.
   - Consider both directions: what helps this node, and what this node later supports.
   - Keep the visible graph useful; omit trivia that does not change planning decisions.

7. **Test and validate.**
   - Add evaluator tests for completion, partial progress, scope, and alternatives.
   - For group item nodes, test items distributed across multiple members and storage locations.
   - Run targeted Goal Map tests, then the full site test/lint/format/build suite.

## Node template

Follow the exact local schema in the Goal Map definition modules. A typical node is:

```js
{
  id: "blood-rune-source",
  title: "Blood rune source",
  scope: "character",
  category: "Guardians of the Rift",
  description: "Reach 77 Runecraft for a renewable blood rune source.",
  validator: skill("Runecraft", 77),
  metadata: { wikiUrl: `${WIKI}Blood_rune` },
}
```

A group item-set node is:

```js
{
  id: "guthans-set",
  title: "Guthan's armour set",
  scope: "group",
  category: "Barrows",
  description: "The group owns all four Guthan pieces, including degraded variants.",
  validator: setValidator(GUTHANS),
  metadata: { wikiUrl: `${WIKI}Guthan_the_Infested%27s_equipment` },
}
```

A custom JavaScript validator remains source-controlled and returns the normal result shape:

```js
validator: custom("example", {
  evaluate(context) {
    const current = context.items.get(SOME_ITEM_ID) || 0;
    return {
      complete: current >= 10,
      progress: { current, target: 10, unit: "item" },
      evidence: [{ type: "item", itemId: SOME_ITEM_ID, quantity: current }],
    };
  },
});
```

## Research notes

- Strategy pages describe recommendations and alternatives; activity pages establish actual entry requirements.
- Verify whether temporary boosts are allowed.
- For item sets, include every interchangeable/degraded ID only if the upstream data reports those variants distinctly and they should count.
- Group storage includes inventory, equipment, bank, rune pouch, and seed vault where applicable. Item-set validators should aggregate across members.
- Quest completion must use the repository's quest-ID mapping, not title matching against raw array positions.
- Add multiple source URLs when a node combines claims from several pages.

## Self-check

- [ ] Wiki/MCP research performed and URLs recorded.
- [ ] Existing reusable node searched for first.
- [ ] Character versus group scope is correct.
- [ ] Required, recommended, optional, and alternative semantics are accurate.
- [ ] Validator returns clear evidence and never guesses unavailable state.
- [ ] Node participates in at least one useful relationship.
- [ ] Targeted and full validation pass.
