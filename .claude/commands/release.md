Release a new version of brunt to npm.

Ask the user which semver bump to apply: patch, minor, or major.

Then execute these steps in order, stopping on any failure:

1. Run `bun test` -- all 223+ tests must pass
2. Run `bun run build` -- must produce dist/cli.js under 150KB
3. Run `node dist/cli.js help` -- verify the CLI runs
4. Bump the version in `package.json` using `npm version <patch|minor|major> --no-git-tag-version`
5. Read the new version from package.json
6. Update the version string in `src/reporter.ts` (the VERSION constant) to match
7. Update the version in the README.md banner example to match
8. Add a new `## [x.y.z] - YYYY-MM-DD` section at the top of CHANGELOG.md (after the header). Ask the user what to put in the changelog, or summarize from git log since last tag.
9. Rebuild: `bun run build`
10. Commit all changed files with message `release: vX.Y.Z`
11. Create a git tag: `git tag vX.Y.Z`
12. Push commit and tag: `git push origin master --tags`
13. Publish: `npm publish --access public`
14. Create a GitHub release: `gh release create vX.Y.Z --title "vX.Y.Z" --notes "See CHANGELOG.md"`
