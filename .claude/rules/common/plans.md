# Implementation Plans

These rules apply to every plan in `docs/superpowers/plans/`, in addition to the `superpowers:writing-plans` skill.

## Research

- If a research doc from `/research` covers the code the plan changes, cite it in the plan header next to the spec.
- If the research doc was written against an older commit than `HEAD`, check its references against the current code before you rely on them.

## Verification

The final acceptance task of every plan lists two checklists:

- **Automated verification:** commands the agent runs and that must pass.
  - `repos/portfolio`: `npm test`, `npm run test:gpu`, `npm run typecheck`, `npm run build`
  - Java projects: `./mvnw test` or `./gradlew test`
- **Manual verification:** checks only a person can do, such as iPhone timing, screenshots in both themes, or listening checks.

Do not pause between tasks for manual checks. Collect them in the final handoff and do not mark them done until the user confirms them.
