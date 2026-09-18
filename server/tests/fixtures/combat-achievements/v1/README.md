# Combat Achievement synchronization protocol v1

All endpoints are under `/api/group/{groupName}` and use the existing group token in the `Authorization` header.

## Upload

`PUT /combat-achievements/snapshot` accepts the exact replacement document frozen in `upload.json`:

```json
{
  "schemaVersion": 1,
  "playerName": "Display Name",
  "clientRevision": 123,
  "achievementPoints": 321,
  "completedTaskIds": ["CA_TASK_BARROWS_CHAMPION_COMPLETED"]
}
```

`playerName` must match a current group member after trimming, converting underscores to spaces, collapsing whitespace, and case folding. `achievementPoints` is the non-negative Combat Achievement point total read from game state and must not exceed 10000. Task IDs must be unique RuneLite completion var names matching `CA_TASK_*_COMPLETED`. A lower `clientRevision` than the stored snapshot returns `409 stale_client_revision`. Equal revisions are idempotently replaceable.

The server stores only the latest snapshot for each normalized member name. It stores no account hash or history.

## Read

`GET /combat-achievements/snapshots` returns all latest member snapshots to any caller authenticated with the group token. The response is the versioned object frozen in `snapshots.json`.

Manual planner status and notes are separate from synchronized completion. The site exposes synchronized completion as `syncedComplete` and never rewrites planner rows from a snapshot.
