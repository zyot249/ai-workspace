# ai-workspace

Personal projects monorepo. Each project lives in its own folder under `repos/`, self-contained with its own toolchain.

## Layout

```
repos/
  <project-name>/   # one project per folder, own git-ignored artifacts, own README
work/
  <YYYY-MM-DD-topic-name>/   # agent working session: research/, plan/, handoff/. See work/README.md
```

## Adding a project

```
mkdir repos/<project-name>
cd repos/<project-name>
```

Set up the project's own toolchain inside its folder (package.json, pyproject.toml, Cargo.toml, etc). No shared build tooling at the root — projects are independent.
