# Changesets

This directory holds pending changesets — short notes describing changes that
should be included in the next release. Add one in any PR that affects
released behavior:

```
npx changeset
```

The release workflow consumes these files on push to `main`, bumps the
version in `package.json`, writes an entry into `CHANGELOG.md`, opens a
Release PR, auto-merges it, and cuts a GitHub Release with a server-signed
tag.

See [the Changesets docs](https://github.com/changesets/changesets) for the
format reference.
