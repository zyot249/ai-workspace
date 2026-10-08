# Testing

Follow test-driven development (TDD) for every project in this repo.

## Workflow

1. Write a failing test for the behavior you are adding or changing.
2. Run it and confirm it fails for the expected reason.
3. Write the smallest implementation that makes it pass.
4. Run the test suite and confirm it passes.
5. Refactor with the suite green.

Use the `superpowers:test-driven-development` skill to drive this loop.

- Bug fixes start with a test that reproduces the bug.
- Test behavior through public interfaces, not private state.

## Test commands

- `repos/portfolio`: `npm test` (Vitest).
- Java projects: `./mvnw test` or `./gradlew test`.

## Exception

Three.js visual output (look, lighting, animation feel) is verified in the browser, not by unit tests. Scene logic stays test-first: camera math, scroll mapping, sorting, tier selection, and state transitions.

Stack-specific guidance lives in `vue/testing.md`, `nuxt/testing.md`, and `java/testing.md`, which load when matching files are touched.
