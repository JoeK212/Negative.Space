# Negative Space

Carves the negative space between real building volumes out of a bounding block, from Overture Maps geometry.

Live at `axisbim.io`. Joe.K · axisbim.io

## What it does

Takes a bounding "mold" volume the size of a chosen NYC neighborhood — its footprint × its tallest building's height — and subtracts every real building solid from it via CSG. What's left is the void: the shape of the air around and above the buildings, capped by the mold's own outer boundary.

Built out district by district against real NYC Community District boundaries, not a live search-any-area system — adding a district is a manual data step, not a feature request. All 12 of Manhattan's Community Districts are in: District 1 (TriBeCa/Battery Park City/FiDi), District 2 (Greenwich Village/West Village/SoHo/NoHo), District 3 (Alphabet City/East Village/Lower East Side/Chinatown), District 4 (Chelsea/Clinton/Hudson Yards), District 5 (Midtown), District 6 (Murray Hill/Stuyvesant Town/Gramercy/Kips Bay/Tudor City/Turtle Bay/Sutton Place), District 7 (Upper West Side/Manhattan Valley/Lincoln Square), District 8 (Upper East Side/Lenox Hill/Yorkville/Roosevelt Island), District 9 (Hamilton Heights/Manhattanville/Morningside Heights), District 10 (Harlem/Polo Grounds), District 11 (East Harlem/Spanish Harlem/Wards Island/Randalls Island), District 12 (Inwood/Washington Heights). Each is real Overture Maps building data clipped to its district's actual administrative boundary.

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
