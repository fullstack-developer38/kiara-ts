# Runnable examples

Run:

```bash
npm run demo:repo
```

Try the decorator examples:

```bash
npm run demo:decorators
```

This script demonstrates:

- structured search with combined field filters
- keyword best-match with typo correction (on a `oneEditAway` title field) and
  stemming-aware fields
- autocomplete suggestions using breadth-first prefix prediction and one-edit
  fallback

The decorator examples demonstrate:

- `@Entity` + field decorators producing compiled schemas
- decorator metadata initialization requirement
- collections, ranges, and alternative decorator names
