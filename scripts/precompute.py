#!/usr/bin/env python3
"""
Precompute the slim story dataset for "Suggested Isn't Safe".

Reads the two raw City of Ottawa GeoJSON files (bike_routes.geojson,
collisions.geojson, 2015-2019) and emits site/data/story.json: a small,
mobile-friendly payload with tiered + simplified route geometry, cyclist
collision points flagged on/off the "Suggested Route" network, the verified
opening-hook location, citywide burden stats, and named route profiles.

Spatial logic mirrors the Streamlit prototype (bikelanes/main.py): a collision
is "on a suggested route" if it falls within a 5m buffer of a Suggested Route
line. Implemented here in pure Python (no geopandas) via a local equirectangular
projection + a segment grid index, so the pipeline has zero heavy deps.
"""
import json, math, os

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, "..", "bikelanes")
OUT = os.path.join(HERE, "..", "site", "data", "story.json")

BUFFER_M = 5.0            # prototype's 5m on-route buffer
LAT0 = math.radians(45.42)  # local projection origin (downtown Ottawa)
R = 6371000.0

# Narrative tiers: the city's raw classes rolled into the 3 story tiers + context.
TIER_MAP = {
    "Suggested Route": "suggested",
    "Bike Lane": "painted",
    "Segregated Bike Lane": "protected",
    "Cycle Track": "protected",
    "Crossride": "protected",
    "Paved Shoulder": "context",
    "Path": "context",
    "Mountain Bike Trail": "context",
}
# Geometry simplification tolerance (meters) per tier. Focus tiers keep detail;
# the vast recreational path network is simplified hard to stay light.
TOL = {"suggested": 6, "painted": 8, "protected": 6, "context": 55}


def xy(lon, lat):
    return (math.radians(lon) * math.cos(LAT0) * R, math.radians(lat) * R)


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def rdp(points, tol):
    """Ramer-Douglas-Peucker on (lon,lat) points, tolerance in meters."""
    if len(points) < 3:
        return points
    xys = [xy(p[0], p[1]) for p in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        s, e = stack.pop()
        ax, ay = xys[s]; bx, by = xys[e]
        dmax, idx = 0.0, -1
        for i in range(s + 1, e):
            px, py = xys[i]
            d = seg_dist(px, py, ax, ay, bx, by)
            if d > dmax:
                dmax, idx = d, i
        if dmax > tol and idx != -1:
            keep[idx] = True
            stack.append((s, idx)); stack.append((idx, e))
    return [points[i] for i in range(len(points)) if keep[i]]


def line_len_km(coords):
    tot = 0.0
    pts = [xy(c[0], c[1]) for c in coords]
    for i in range(len(pts) - 1):
        tot += math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
    return tot / 1000.0


def cyc_year(p, y):
    """Handle inconsistent field naming: F2015_Cyclist (singular) vs plural."""
    for name in (f"F{y}_Cyclist", f"F{y}_Cyclists"):
        v = p.get(name)
        if v is not None:
            return int(v)
    return 0


def round_coords(coords, nd=5):
    return [[round(c[0], nd), round(c[1], nd)] for c in coords]


def main():
    routes = json.load(open(os.path.join(DATA, "bike_routes.geojson")))
    cols = json.load(open(os.path.join(DATA, "collisions.geojson")))

    # ---- Build simplified geometry grouped by tier, and per-tier km ----
    tier_lines = {"suggested": [], "painted": [], "protected": [], "context": []}
    tier_km = {"suggested": 0.0, "painted": 0.0, "protected": 0.0, "context": 0.0}
    # Grid index of Suggested Route segments for the on-route test.
    CELL = 60.0
    grid = {}
    for f in routes["features"]:
        cls = f["properties"].get("EXISTING_CYCLING_NETWORK")
        tier = TIER_MAP.get(cls)
        g = f["geometry"]
        if not tier or not g:
            continue
        parts = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
        for line in parts:
            if len(line) < 2:
                continue
            tier_km[tier] += line_len_km(line)
            simp = rdp(line, TOL[tier])
            tier_lines[tier].append(round_coords(simp))
            if tier == "suggested":
                pts = [xy(c[0], c[1]) for c in line]
                for i in range(len(pts) - 1):
                    a, b = pts[i], pts[i + 1]
                    xs = (a[0], b[0]); ys = (a[1], b[1])
                    for cx in range(int(min(xs) // CELL), int(max(xs) // CELL) + 1):
                        for cy in range(int(min(ys) // CELL), int(max(ys) // CELL) + 1):
                            grid.setdefault((cx, cy), []).append((a, b))

    def on_suggested(lon, lat, buf=BUFFER_M):
        px, py = xy(lon, lat)
        cx, cy = int(px // CELL), int(py // CELL)
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for a, b in grid.get((cx + i, cy + j), ()):
                    if seg_dist(px, py, a[0], a[1], b[0], b[1]) <= buf:
                        return True
        return False

    # ---- Collisions: cyclist-involved points, flagged on/off suggested ----
    points, on_locs = [], []
    total_cyc = on_cyc = 0
    for f in cols["features"]:
        p = f["properties"]
        n = int(p.get("Total_Cyclists_Collisions") or 0)
        if n <= 0:
            continue
        lon, lat = p.get("Longitude"), p.get("Latitude")
        if lon is None or lat is None:
            continue
        total_cyc += n
        on = on_suggested(lon, lat)
        if on:
            on_cyc += n
        points.append([round(lon, 5), round(lat, 5), n, 1 if on else 0])
        if on:
            years = {y: cyc_year(p, y) for y in range(2015, 2020)}
            on_locs.append({"name": p.get("Location", ""), "total": n,
                            "years": years, "lon": lon, "lat": lat})

    on_locs.sort(key=lambda d: d["total"], reverse=True)
    repeat_locs = [d for d in on_locs if d["total"] >= 2]

    def clean(name):
        base = name.split("(")[0].strip()
        base = base.replace("  W", " W").replace("   ", " ").replace("  ", " ")
        return " ".join(base.split())

    hook = dict(on_locs[0]); hook["name"] = clean(hook["name"])

    # ---- Named route profiles (real downtown suggested corridors) ----
    def corridor(street, blurb):
        segs = [d for d in on_locs if clean(d["name"]).upper().startswith(street.upper())]
        total = sum(d["total"] for d in segs)
        worst = max(segs, key=lambda d: d["total"]) if segs else None
        return {
            "street": street.title(),
            "total": total,
            "locations": len(segs),
            "worst": clean(worst["name"]) if worst else "",
            "worst_total": worst["total"] if worst else 0,
            "worst_years": worst["years"] if worst else {},
            "lon": worst["lon"] if worst else None,
            "lat": worst["lat"] if worst else None,
            "blurb": blurb,
        }

    profiles = [
        corridor("BANK ST",
                 "The Glebe's main street is a signed, unprotected “suggested” "
                 "corridor. Cyclists share the lane with heavy car and bus traffic "
                 "the length of it."),
        corridor("SOMERSET ST W",
                 "Through Chinatown and toward Preston, Somerset West is a recommended "
                 "route with nothing but paint and signs between riders and traffic."),
        corridor("GLADSTONE AVE",
                 "A key east–west connector marked suggested, funnelling riders "
                 "across Bronson and Preston with no physical separation."),
    ]

    out = {
        "meta": {
            "title": "Suggested Isn't Safe",
            "source": "City of Ottawa Open Data: Traffic Collisions by Location, "
                      "2015–2019, and Ottawa Cycling Network.",
            "window": "2015–2019",
            "buffer_m": BUFFER_M,
            "built_by": "Malovey · malovey.com",
        },
        "hook": hook,
        "stats": {
            "total_cyclist_collisions": total_cyc,
            "on_suggested_collisions": on_cyc,
            "on_suggested_locations": len(on_locs),
            "repeat_locations": len(repeat_locs),
            "suggested_km": round(tier_km["suggested"]),
            "tier_km": {k: round(v) for k, v in tier_km.items()},
        },
        # Ship only the 3 narrative tiers; the recreational path network is left
        # to the basemap (keeps the payload light for mobile).
        "tiers": {k: tier_lines[k] for k in ("suggested", "painted", "protected")},
        "collisions": points,
        "profiles": profiles,
        "top_on_suggested": [
            {"name": clean(d["name"]), "total": d["total"]} for d in on_locs[:8]
        ],
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    payload = json.dumps(out, separators=(",", ":"))
    with open(OUT, "w") as fh:
        fh.write(payload)
    # Also emit a JS version that assigns window.STORY. Loaded via a <script> tag,
    # this works when the page is opened directly from disk (file://), where fetch()
    # of a local JSON file is blocked by the browser.
    out_js = OUT[:-5] + ".js"
    with open(out_js, "w") as fh:
        fh.write("window.STORY=" + payload + ";\n")
    size = os.path.getsize(OUT) / 1024
    print(f"wrote {OUT}  ({size:.0f} KB)  and {out_js}")
    print(f"  cyclist collisions total={total_cyc}  on-suggested={on_cyc} "
          f"across {len(on_locs)} locations ({len(repeat_locs)} repeat)")
    print(f"  suggested network: {tier_km['suggested']:.0f} km")
    print(f"  hook: {hook['name']}  total={hook['total']}  years={hook['years']}")
    print(f"  route lines: " + ", ".join(f"{k}={len(v)}" for k, v in tier_lines.items()))
    for pr in profiles:
        print(f"  profile {pr['street']}: {pr['total']} collisions / "
              f"{pr['locations']} spots, worst {pr['worst']} ({pr['worst_total']})")


if __name__ == "__main__":
    main()
