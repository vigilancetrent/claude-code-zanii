# Skill Promotion Pipeline

> Promote skills from project scope to user scope with status tracking.

## What it does

Skills live in `.claude/skills/<name>/SKILL.md` (project scope) or `~/.zaniicode/skills/<name>/SKILL.md` (user scope). The promotion pipeline lets you:

1. **Promote** — copy a project skill to user scope, marking it as `stable`
2. **Demote** — remove the user-scope copy, keeping the project original

## Usage

```sh
# Promote a skill to user scope
/skill-promote promote my-skill
/sp promote my-skill

# Demote back
/skill-promote demote my-skill
/sp demote my-skill
```

## What happens on promote

1. Reads `.claude/skills/<name>/SKILL.md`
2. Stamps frontmatter with:
   ```yaml
   status: stable
   promotedAt: 2026-08-26T12:00:00.000Z
   promotedFrom: /absolute/path/to/.claude/skills/<name>/SKILL.md
   ```
3. Writes to `~/.zaniicode/skills/<name>/SKILL.md`

## Frontmatter fields

| Field | Type | Description |
|---|---|---|
| `status` | `draft` \| `stable` \| `deprecated` | Promotion status |
| `promotedAt` | ISO timestamp | When promoted |
| `promotedFrom` | string | Original path before promotion |

## Scope resolution

Skills are loaded from multiple locations. User-scope skills (`~/.zaniicode/skills/`) override project-scope skills (`.claude/skills/`) when names collide.

```
Priority (highest first):
  1. ~/.zaniicode/skills/<name>/SKILL.md  (user scope — promoted)
  2. .claude/skills/<name>/SKILL.md       (project scope)
  3. Bundled skills                        (built-in)
```

## When to use

- Skill works well in one project → promote so it's available in all projects
- Skill is experimental → keep in project scope with `status: draft`
- Skill is outdated → set `status: deprecated` or demote

## Limitations

- No versioning beyond the frontmatter timestamp
- No automatic promotion — manual `/skill-promote` only
- Promotion is a file copy, not a symlink — changes to the project copy don't propagate
- No team sharing of promoted skills (use TEAMMEM for that)

## Files

| File | Purpose |
|---|---|
| `src/commands/skill-promote/` | `/skill-promote` command |
| `src/utils/frontmatterParser.ts` | `status`, `promotedAt`, `promotedFrom` fields |
