# Follow-ups for later milestones

## Trip revision history and planning snapshots

Defer trip versioning until after the initial constraint and planning prototype.
The current application stores only the latest trip definition; a constraint
document's `schemaVersion` identifies its JSON format, not a trip revision.

A later milestone should explore:

- Immutable revisions of trip definitions, constraints, party membership, and preferences.
- Associating search runs and ranked suggestions with the exact inputs used.
- Identifying outdated results when relevant inputs change.
- Comparing alternatives and explaining how a constraint change affected results.
- Restoring earlier definitions or branching a trip into alternative plans.
- Recording who changed what and avoiding accidental overwrites from concurrent edits.

Before implementing this, decide what creates a revision, how much history to
retain, how revisions interact with fare-cache reuse, and who may view or restore
historical versions. This is a follow-up, not part of Milestone 1's current prototype.
