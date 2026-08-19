# Releases

Release Please owns versions, changelog entries, tags, and GitHub Releases. The release workflow publishes to npm through GitHub OIDC.

## Normal Release

1. Merge changes into `main`.
2. Review the Release Please PR's version and changelog.
3. Merge that PR to create the tag and GitHub Release and publish to npm.
4. Verify the published package:

```bash
npm view @yoloyash/web-basics version dist.integrity --json
```

Do not manually edit `package.json`, `.release-please-manifest.json`, tags, or GitHub Releases during this flow.

## Failed Release

- If Release Please fails, fix its workflow or configuration and rerun it.
- If npm publishing fails after the GitHub Release is created, fix the trusted-publisher or workflow permissions and rerun the failed job.
- If a broken version reached npm, release a new version; published versions are immutable.
