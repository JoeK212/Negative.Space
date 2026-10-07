v3.4.174 - Export solid: Midtown (District 5) converts completely in AutoCAD 2027 (192 of 192 tiles). Stacked building parts no longer leave a zero-thickness sheet, each tile is checked for double-sided sheets and rebuilt if needed, and merging flat triangles is off by default again (tick it for fewer lines).
v3.4.173 - Export solid: flat triangles are merged into bigger faces by default (far fewer lines; District 2 converted 134 of 134 in AutoCAD 2027 and joined with UNION). Untick the box for plain triangles.
v3.4.172 - Export solid: Chelsea / Clinton / Hudson Yards (District 4) converted completely in AutoCAD 2027 (196 of 196 tiles). Each tile is now built on its own for better precision, buildings are grown 60 cm, and every mesh is checked for crossing triangles. Route unchanged: SMOOTHMESHCONVERT 3, CONVTOSOLID on all, then UNION.
v3.4.171 - Export solid: converts to a real 3D solid in AutoCAD 2027. The solid is cut into 200 m tiles that touch exactly. In AutoCAD set SMOOTHMESHCONVERT to 3, run CONVTOSOLID on all, then UNION on all. Midtown: 167 of 167 tiles converted and joined into one solid.
v3.4.169 - Export solid: fast fix for pinch points (buildings touching at a corner); replaces 3.4.168's slow step.
v3.4.167 - Export solid: zero-area slivers removed, 2 cm simplify.
v3.4.166 - Export solid: flat triangles merged into bigger faces.
v3.4.165 - Export solid (DXF mesh): the negative space as one closed volume.
v3.4.164 - Surface export: cut-cap lines fixed.
