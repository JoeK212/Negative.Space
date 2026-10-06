# Changelog

Short public history. Dates are 2026.

**3.4.167** (Oct 6) - Export solid: cleaner mesh (no zero-area faces, 2 cm simplify, full-precision coordinates) for AutoCAD's CONVTOSOLID.

**3.4.166** (Oct 6) - Export solid: flat triangles are merged into larger faces, so walls and tops no longer show triangle lines in CAD (a checkbox turns it off).

**3.4.165** (Oct 6) - New **Export solid (DXF mesh)**: the negative space as one closed 3D mesh (AutoCAD DXF 2010) with the X / Y / Height cutaway already subtracted. In AutoCAD, run `CONVTOSOLID` on it to get a 3D solid.

**3.4.164** (Oct 6) - Surface DXF export: the cut faces (poche) fill completely and no longer show stray lines when the cut sits at ground level.

**3.4.162-3.4.163** (Oct 6) - Data and credits added to the Help window; wording polish.

**3.4.161** (Oct 5) - No more slivers of buildings at the far end of the X / Y cut.

**3.4.149-3.4.160** (Oct 3-4) - Guided tour and Exercises panel. DXF export gains terrain: ground surface as a mesh, contour lines, index contours with elevation labels, plan lines draped on the ground, cut faces capped on their own layers.

**3.4.144-3.4.148** (Oct 3) - Export image (PNG) and Export DXF (CAD): plan with street names, elevation sections, and 3D masses with the live cutaway.

**3.4.133-3.4.143** (Oct 2-3) - Terrain toggle: buildings, ground, streets, negative space and sections follow the real ground. Ground lines in elevations, X / Y values read from the low end, fill light so every wall is visible.

**Before 3.4.133** - All 12 Manhattan Community Districts; true N / S / E / W architectural sections and Plan view; draw-a-box sections; Manhattan context and major streets; STL export; shareable links.
