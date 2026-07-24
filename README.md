# Suggested Isn't Safe

A scrollytelling data story on Ottawa's cycling network: the City classifies
hundreds of kilometres of bike routes as "suggested" (shared roadways with no
physical protection, just signs or paint), and cyclists keep getting struck on
them. The piece overlays the suggested-route network against 2015 to 2019
cyclist-collision data and grounds the pattern in named streets.

Built by [Malovey](https://www.malovey.com), a civic-tech studio.

**Live:** https://maloveylabs.github.io/bikelanes/

## What's here

```
site/                     The static scrollytelling site (this is what deploys)
  index.html              Markup + narrative copy
  css/style.css           Editorial styling
  js/main.js              Scrollama + MapLibre GL + D3 controller
  data/story.json         Precomputed slim dataset
  data/story.js           Same data as window.STORY (works from file:// too)
scripts/precompute.py     Regenerates site/data/ from the raw GeoJSON
bikelanes/                Raw source data + original Streamlit prototype (reference)
  bike_routes.geojson     Ottawa Cycling Network (classified LineStrings)
  collisions.geojson      Traffic Collisions by Location, 2015 to 2019
  main.py                 Original Streamlit/geopandas prototype (spatial logic reference)
```

## Tech

Vanilla HTML/CSS/JS, no build step. [Scrollama](https://github.com/russellsamora/scrollama)
for scroll triggers with CSS `position: sticky` for the pinned graphic,
[MapLibre GL JS](https://maplibre.org/) for the animated map layers (CARTO Positron
basemap, no paid tiers), and [D3](https://d3js.org/) for the supporting chart.
Mobile-first; all asset paths are relative so the site runs from any subpath or
directly from disk.

## Regenerating the data

Only needed if the raw datasets change. The precompute scans the full collision
file, buffers the "Suggested Route" lines by 5 m (matching the original
prototype's spatial test), flags each cyclist collision as on/off the network,
and emits a slim, simplified payload.

```bash
python3 scripts/precompute.py
```

## Data & credits

- Data: City of Ottawa Open Data (Ottawa Cycling Network; Traffic Collisions by
  Location, 2015 to 2019).
- Advocacy: [Bike Ottawa](https://bikeottawa.ca/).
- Basemap: © OpenStreetMap contributors, © CARTO.

### A note on method

The story reports collision **counts**, not exposure-adjusted rates. Protected
lanes are built where cycling is busiest, so a naïve crashes-per-kilometre
comparison across lane types would be misleading, and this dataset carries no
ridership volumes to correct for it. What the data supports plainly: repeated
cyclist collisions on the unprotected routes the City actively recommends. Full
methodology is in the page footer.
