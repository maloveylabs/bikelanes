/* ============================================================
   Suggested Isn't Safe - scrollytelling controller
   MapLibre GL (map states) + D3 (burden chart) + Scrollama (steps)
   ============================================================ */
(function () {
  "use strict";

  var COLORS = {
    suggested: "#d6890f",
    painted:   "#4a7ab0",
    protected: "#1f8a70",
    red:       "#e0231b"
  };
  var OTTAWA = { center: [-75.695, 45.418], hook: [-75.6930845, 45.4210308] };
  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var map, story, hookMarker;
  var mapReady = false, dataReady = false, currentMStep = -1;

  /* ---------- helpers ---------- */
  function lineFC(lines) {
    return {
      type: "FeatureCollection",
      features: (lines || []).map(function (coords) {
        return { type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} };
      })
    };
  }
  function collisionFC(points) {
    return {
      type: "FeatureCollection",
      features: (points || []).map(function (p) {
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [p[0], p[1]] },
          properties: { n: p[2], on: p[3] }
        };
      })
    };
  }
  function fly(opts) {
    if (!mapReady) return;
    opts.essential = true;
    if (prefersReduced) { opts.duration = 0; map.jumpTo(opts); }
    else map.flyTo(opts);
  }
  function setVis(id, on) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  }
  function fade(id, prop, to) {
    if (map.getLayer(id)) map.setPaintProperty(id, prop, to);
  }

  /* ---------- map construction ---------- */
  function buildMap() {
    map = new maplibregl.Map({
      container: "map",
      style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
      center: OTTAWA.center,
      zoom: 11,
      minZoom: 9,
      maxZoom: 17,
      attributionControl: true,
      cooperativeGestures: true,   // don't hijack page scroll on touch
      dragRotate: false,
      pitchWithRotate: false
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    map.on("load", function () {
      // ---- route tiers (drawn protected -> painted -> suggested so suggested reads on top) ----
      map.addSource("protected", { type: "geojson", data: lineFC(story.tiers.protected) });
      map.addLayer({
        id: "protected", type: "line", source: "protected",
        layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
        paint: { "line-color": COLORS.protected, "line-width": 3, "line-opacity": 0 }
      });
      map.addSource("painted", { type: "geojson", data: lineFC(story.tiers.painted) });
      map.addLayer({
        id: "painted", type: "line", source: "painted",
        layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
        paint: { "line-color": COLORS.painted, "line-width": 2.2, "line-opacity": 0 }
      });
      map.addSource("suggested", { type: "geojson", data: lineFC(story.tiers.suggested) });
      map.addLayer({
        id: "suggested", type: "line", source: "suggested",
        layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
        paint: {
          "line-color": COLORS.suggested,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.6, 15, 3.4],
          "line-opacity": 0
        }
      });

      // ---- collisions ----
      map.addSource("collisions", { type: "geojson", data: collisionFC(story.collisions) });
      map.addLayer({
        id: "collisions", type: "circle", source: "collisions",
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "n"], 1, 3.5, 4, 7, 8, 11, 12, 15],
          "circle-color": COLORS.red,
          "circle-opacity": 0,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 0.8,
          "circle-stroke-opacity": 0
        }
      });

      // ---- hook marker (HTML, pulsing) ----
      var el = document.createElement("div");
      el.className = "hook-marker";
      hookMarker = new maplibregl.Marker({ element: el })
        .setLngLat([story.hook.lon, story.hook.lat]);

      mapReady = true;
      var loader = document.getElementById("map-loading");
      if (loader) loader.remove();
      // apply whatever step is already active
      applyMapStep(currentMStep < 0 ? 0 : currentMStep, true);
    });
  }

  /* ---------- map step states ---------- */
  function applyMapStep(i, force) {
    if (!mapReady) { currentMStep = i; return; }
    if (i === currentMStep && !force) return;
    currentMStep = i;

    var legend = document.getElementById("legend");
    var hookAnno = document.getElementById("hook-annotation");
    var showLegendRows = function (tiers) {
      legend.hidden = tiers.length === 0;
      legend.querySelectorAll(".legend__row").forEach(function (row) {
        row.style.display = tiers.indexOf(row.dataset.tier) > -1 ? "flex" : "none";
      });
    };

    // Hook marker + annotation belong to step 0 only. Set this unconditionally
    // so a fast scroll that skips intermediate steps can't strand them on screen.
    hookAnno.hidden = (i !== 0);
    if (hookMarker) { if (i === 0) hookMarker.addTo(map); else hookMarker.remove(); }

    switch (i) {
      case 0: // HOOK - single intersection, only the pulsing marker
        fly({ center: OTTAWA.hook, zoom: 14.6, duration: 2200 });
        setVis("suggested", false); setVis("painted", false);
        setVis("protected", false); setVis("collisions", false);
        showLegendRows([]);
        break;

      case 1: // ZOOM OUT - suggested network fades in
        fly({ center: OTTAWA.center, zoom: 11.2, duration: 2400 });
        setVis("suggested", true); fade("suggested", "line-opacity", 0.85);
        setVis("painted", false); setVis("protected", false); setVis("collisions", false);
        showLegendRows(["suggested"]);
        break;

      case 2: // THREE TIERS - add painted + protected
        fly({ center: OTTAWA.center, zoom: 11.4, duration: 1600 });
        setVis("suggested", true); fade("suggested", "line-opacity", 0.9);
        setVis("painted", true); fade("painted", "line-opacity", 0.7);
        setVis("protected", true); fade("protected", "line-opacity", 0.95);
        setVis("collisions", false);
        showLegendRows(["suggested", "painted", "protected"]);
        break;

      case 3: // ADD COLLISIONS - all red dots
        fly({ center: [-75.69, 45.412], zoom: 12, duration: 1800 });
        setVis("suggested", true); fade("suggested", "line-opacity", 0.85);
        setVis("painted", true); fade("painted", "line-opacity", 0.45);
        setVis("protected", true); fade("protected", "line-opacity", 0.6);
        setVis("collisions", true);
        fade("collisions", "circle-opacity", 0.82);
        fade("collisions", "circle-stroke-opacity", 0.9);
        showLegendRows(["suggested", "painted", "protected", "collision"]);
        break;

      case 4: // EMPHASISE on-suggested collisions
        fly({ center: [-75.695, 45.414], zoom: 12.4, duration: 1600 });
        setVis("suggested", true); fade("suggested", "line-opacity", 0.95);
        setVis("painted", true); fade("painted", "line-opacity", 0.2);
        setVis("protected", true); fade("protected", "line-opacity", 0.35);
        setVis("collisions", true);
        // on-route dots stay bold red; off-route dots fade back
        fade("collisions", "circle-opacity",
          ["case", ["==", ["get", "on"], 1], 0.92, 0.12]);
        fade("collisions", "circle-stroke-opacity",
          ["case", ["==", ["get", "on"], 1], 1, 0.15]);
        showLegendRows(["suggested", "collision"]);
        break;
    }
  }

  /* ---------- D3 burden chart ---------- */
  var chartDrawn = false;
  function drawChart(revealHook) {
    var data = story.top_on_suggested.slice(0, 8);
    var svg = d3.select("#chart");
    var W = Math.min(document.querySelector(".chart-wrap").clientWidth - 32, 700);
    var rowH = 34, padL = 0, padR = 46, padT = 6, padB = 6;
    var labelW = W < 560 ? 0 : 212; // stack labels above bars on narrow screens
    var stacked = labelW === 0;
    var barTop = stacked ? 18 : 0;
    var unitH = stacked ? 50 : rowH;
    var H = padT + padB + data.length * unitH;
    var innerW = W - padL - padR - labelW;
    var x = d3.scaleLinear().domain([0, d3.max(data, function (d) { return d.total; })]).range([0, innerW]);

    svg.attr("viewBox", "0 0 " + W + " " + H).attr("width", "100%").attr("height", H);

    if (!chartDrawn) {
      chartDrawn = true;
      var g = svg.selectAll("g.row").data(data).enter().append("g")
        .attr("class", "row")
        .attr("transform", function (d, i) { return "translate(0," + (padT + i * unitH) + ")"; });

      g.append("text")
        .attr("class", "bar-label")
        .attr("x", stacked ? 0 : labelW - 10)
        .attr("y", stacked ? 12 : rowH / 2 + 4)
        .attr("text-anchor", stacked ? "start" : "end")
        .text(function (d) { return shortName(d.name, stacked ? 60 : 30); });

      g.append("rect")
        .attr("class", function (d) { return "bar" + (d.total === story.hook.total && d.name.indexOf("ELGIN") > -1 ? " bar--hook" : ""); })
        .attr("x", labelW)
        .attr("y", barTop)
        .attr("height", 16)
        .attr("rx", 2)
        .attr("width", 0);

      g.append("text")
        .attr("class", function (d) { return "bar-value" + (d.name.indexOf("ELGIN") > -1 ? " bar-value--hook" : ""); })
        .attr("x", labelW)
        .attr("y", barTop + 13)
        .attr("dx", 6)
        .text(function (d) { return d.total; });
    }

    var t = prefersReduced ? svg.transition().duration(0) : svg.transition().duration(900).delay(function (d, i) { return i * 70; });
    svg.selectAll("g.row").select("rect.bar").transition(t)
      .attr("width", function (d) { return Math.max(2, x(d.total)); });
    svg.selectAll("g.row").select(".bar-value").transition(t)
      .attr("x", function (d) { return labelW + Math.max(2, x(d.total)); });
  }

  function shortName(name, max) {
    var s = name.replace(/\s*\(.*\)$/, "")
      .replace(/\bST\b/g, "St").replace(/\bAVE\b/g, "Ave").replace(/\bRD\b/g, "Rd")
      .replace(/\bDR\b/g, "Dr").replace(/\bCRES\b/g, "Cres").replace(/\s+btwn\s+/g, " · ");
    s = s.replace(/\s+/g, " ").trim();
    return s.length > max ? s.slice(0, max - 1).trim() + "…" : s;
  }

  /* ---------- profile cards ---------- */
  function renderProfiles() {
    var wrap = document.getElementById("profiles");
    var years = ["2015", "2016", "2017", "2018", "2019"];
    story.profiles.forEach(function (p) {
      var vals = years.map(function (y) { return (p.worst_years && p.worst_years[y]) || 0; });
      var peak = Math.max.apply(null, vals);
      var spark = vals.map(function (v, k) {
        var h = peak ? Math.round((v / peak) * 100) : 0;
        return '<div class="spark__bar' + (v === peak && v > 0 ? " is-peak" : "") +
               '" style="height:' + Math.max(h, v > 0 ? 12 : 4) + '%" title="' + years[k] + ": " + v + '"></div>';
      }).join("");
      var lbls = years.map(function (y) { return "<span>" + y.slice(2) + "</span>"; }).join("");
      var card = document.createElement("div");
      card.className = "profile";
      card.innerHTML =
        '<span class="profile__tag">Suggested route</span>' +
        '<h3 class="profile__street">' + p.street + "</h3>" +
        '<div class="profile__total">' + p.total + "</div>" +
        '<p class="profile__total-label">cyclist collisions on suggested segments, 2015–2019</p>' +
        '<p class="profile__blurb">' + p.blurb + "</p>" +
        '<div class="profile__worst">Worst spot: <strong>' + titleCase(p.worst) +
        "</strong> (" + p.worst_total + " collisions)" +
        '<div class="spark">' + spark + "</div>" +
        '<div class="spark-labels">' + lbls + "</div></div>";
      wrap.appendChild(card);
    });
  }
  function titleCase(s) {
    return s.replace(/\s*\(.*\)$/, "")
      .replace(/\bST\b/g, "St").replace(/\bAVE\b/g, "Ave").replace(/\bRD\b/g, "Rd")
      .replace(/\bDR\b/g, "Dr").replace(/\bW\b/g, "W").replace(/btwn/g, "between");
  }

  /* ---------- Scrollama wiring ---------- */
  function initScroll() {
    // map scene
    var mapScroller = scrollama();
    mapScroller.setup({ step: "#scene-map .step", offset: 0.6, progress: false })
      .onStepEnter(function (r) {
        r.element.classList.add("is-active");
        applyMapStep(+r.element.dataset.mstep);
      })
      .onStepExit(function (r) {
        // keep active class if still near viewport for smoother fade; remove when leaving fully
        if ((r.direction === "up" && r.index === 0) ) return;
      });

    // chart scene
    var chartScroller = scrollama();
    chartScroller.setup({ step: "#scene-chart .step", offset: 0.7 })
      .onStepEnter(function (r) {
        r.element.classList.add("is-active");
        var cs = +r.element.dataset.cstep;
        if (cs === 0) drawChart(false);
        if (cs === 1) drawChart(true);
        if (cs === 2) document.getElementById("chart-title").textContent =
          "Cyclist collisions by location, 2015–2019";
      });

    // generic reveal for solid cards / sections
    var revealScroller = scrollama();
    revealScroller.setup({ step: ".step__card--solid, .profile", offset: 0.85 })
      .onStepEnter(function (r) { r.element.classList.add("is-active"); });

    window.addEventListener("resize", function () {
      mapScroller.resize(); chartScroller.resize(); revealScroller.resize();
      if (chartDrawn) { chartDrawn = false; d3.select("#chart").selectAll("*").remove(); drawChart(false); }
    });
  }

  /* ---------- boot ---------- */
  // loading placeholder inside the map graphic
  var mapEl = document.getElementById("map");
  var loader = document.createElement("div");
  loader.className = "map-loading"; loader.id = "map-loading";
  loader.textContent = "Loading Ottawa…";
  mapEl.parentNode.appendChild(loader);

  function start(json) {
    story = json;
    dataReady = true;
    renderProfiles();
    buildMap();
    initScroll();
  }

  // Prefer window.STORY (data/story.js via <script>), which works from file://
  // too. Fall back to fetch() when served over http(s) without the script.
  if (window.STORY) {
    start(window.STORY);
  } else {
    fetch("data/story.json")
      .then(function (r) { return r.json(); })
      .then(start)
      .catch(function (err) {
        console.error("Failed to load story data", err);
        loader.textContent =
          "Could not load data. Open via a local server, or ensure data/story.js is present.";
      });
  }
})();
