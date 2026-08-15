# Negative Space

Carves the negative space between real building volumes out of a bounding block, from Overture Maps geometry.

Live at `axisbim.io`. Joe.K · axisbim.io

## What it does

Takes a bounding "mold" volume the size of a chosen NYC neighborhood — its footprint × its tallest building's height — and subtracts every real building solid from it via CSG. What's left is the void: the shape of the air around and above the buildings, capped by the mold's own outer boundary.

Three neighborhoods are built in so far: Hudson Yards, Chelsea, and Hell's Kitchen. Each is real Overture Maps building data, not a live search-any-area system — adding a neighborhood is a manual data step, not a feature request.

## Running it

Requires being served over http(s) — `file://` doesn't work (the app fetches per-neighborhood data files and loads Manifold's WASM from unpkg). Locally:

```
python3 -m http.server 8888
```

then open `http://localhost:8888`.

Before considering any change done, run:

```
node audit_deploy.js
```

## More

- In-app help: the **?** button, top right.
- Feature walkthrough and data-pipeline notes: [EXTENDED.md](EXTENDED.md)
- Full version history: [CHANGELOG.md](CHANGELOG.md)
- Architecture, known gotchas, working methodology for future changes: [AUDIT.md](AUDIT.md)
