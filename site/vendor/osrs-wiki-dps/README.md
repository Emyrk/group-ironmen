# Vendored OSRS Wiki DPS calculator

This directory contains the calculator core and generated JSON data vendored from
[`weirdgloop/osrs-dps-calc`](https://github.com/weirdgloop/osrs-dps-calc) at commit
`89c3e25b344aea90d0189746e4b5f73dde0f0383`.

The upstream project is licensed under the terms in [`LICENSE`](./LICENSE).
`src/utils.ts` is intentionally reduced to a worker-safe compatibility subset, and
`worker-entry.ts` adapts the upstream calculator to this application's local protocol v1.

To refresh the snapshot, copy the required `src/enums`, `src/lib`, `src/types`, prayer
assets, and `cdn/json/{equipment,monsters,spells}.json` from the pinned upstream revision,
then reapply the worker compatibility files and run the site test and bundle commands.
