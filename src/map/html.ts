import type { Language } from '../language.js';
import type { MapData } from './types.js';

/** Header values shown above the graph. */
export interface MapMeta {
  title: string;
  generatedAt: string;
}

/**
 * Fixed order of the languages. A language's position is its palette index, so a
 * language keeps its colour from one map to the next.
 */
const LANGUAGE_ORDER: readonly Language[] = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'python',
  'csharp',
  'java',
  'go',
  'rust',
  'json',
  'markdown',
  'yaml',
  'shell',
];

/** Index used for files without a known language. */
const UNKNOWN_INDEX = LANGUAGE_ORDER.length;

const UNKNOWN_LABEL = 'unknown';

/** Palette entries, one per language plus a neutral grey for unknown. */
const PALETTE_LIGHT = [
  '#2f6fdb',
  '#0e8fa8',
  '#b8920a',
  '#d9822b',
  '#3a9140',
  '#8e5bd0',
  '#b0412e',
  '#1a8f86',
  '#c2561c',
  '#6b7280',
  '#b83280',
  '#4f46e5',
  '#2b7a4b',
  '#7a8394',
];

const PALETTE_DARK = [
  '#6ea0ff',
  '#4cc4dc',
  '#e0bc3a',
  '#f2a65a',
  '#6cc872',
  '#b794f0',
  '#e8806d',
  '#52cfc4',
  '#f08a50',
  '#9aa3b2',
  '#f07cc0',
  '#8f8af5',
  '#5fc08a',
  '#8f98aa',
];

function paletteVariables(palette: readonly string[]): string {
  return palette.map((colour, i) => `--c${i}:${colour};`).join('');
}

/** Escapes text for use in HTML element content and quoted attribute values. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serialises data for a JSON script block. Characters that could end the block or
 * confuse a parser are written as unicode escapes, which JSON.parse reads back unchanged.
 */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function paletteIndex(language: string | undefined): number {
  const index = LANGUAGE_ORDER.indexOf(language as Language);
  return index === -1 ? UNKNOWN_INDEX : index;
}

/** Counts files per language label, with files lacking a language under "unknown". */
function countLanguages(data: MapData): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of data.nodes) {
    const label = node.language ?? UNKNOWN_LABEL;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return counts;
}

function renderLanguageFilters(data: MapData): string {
  const counts = countLanguages(data);
  const labels = [...counts.keys()].sort(
    (a, b) => paletteIndex(a) - paletteIndex(b) || a.localeCompare(b),
  );
  return labels
    .map((label) => {
      const safe = escapeHtml(label);
      const index = label === UNKNOWN_LABEL ? UNKNOWN_INDEX : paletteIndex(label);
      return (
        `<label class="lang"><input type="checkbox" checked data-language="${safe}" data-color="${index}">` +
        `<span class="swatch" style="background:var(--c${index})"></span>` +
        `<span>${safe}</span><span class="count">${counts.get(label)}</span></label>`
      );
    })
    .join('');
}

const STYLES = String.raw`
:root{color-scheme:light dark;--bg:#ffffff;--fg:#1d2330;--muted:#576074;--panel:#f4f5f8;--border:#d3d8e0;--link:#8f98a9;--accent:#d6245c;--halo:#ffffff;${paletteVariables(PALETTE_LIGHT)}}
@media (prefers-color-scheme:dark){:root{--bg:#14171d;--fg:#e6e9ef;--muted:#9aa3b5;--panel:#1c2028;--border:#343a46;--link:#6c7588;--accent:#ff6b95;--halo:#14171d;${paletteVariables(PALETTE_DARK)}}}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{padding:10px 16px;border-bottom:1px solid var(--border)}
h1{margin:0;font-size:18px}
.meta{margin:2px 0 0;color:var(--muted);font-size:13px}
.toolbar{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:8px 16px;border-bottom:1px solid var(--border)}
input[type=search]{min-width:200px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit}
button{font:inherit;color:var(--fg);background:var(--panel);border:1px solid var(--border);border-radius:6px;padding:4px 10px;cursor:pointer}
button:hover{border-color:var(--muted)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.zoom{display:flex;gap:4px}
.langs{display:flex;flex-wrap:wrap;gap:4px 12px;margin:0;padding:0;border:0}
.lang{display:inline-flex;align-items:center;gap:5px;cursor:pointer}
.swatch{width:11px;height:11px;border-radius:50%;display:inline-block}
.count{color:var(--muted);font-size:12px}
main{flex:1;min-height:0;display:flex}
.stage{flex:1;min-width:0;position:relative}
svg{width:100%;height:100%;display:block;cursor:grab;touch-action:none;user-select:none}
svg.panning{cursor:grabbing}
.link{stroke:var(--link);fill:none;opacity:.55}
.link.hl{stroke:var(--accent);opacity:1}
.link.dim{opacity:.07}
.arrow{fill:var(--link)}
.node{cursor:pointer}
.node circle{stroke:var(--bg);stroke-width:1}
.node.dim{opacity:.12}
.node.match circle{stroke:var(--fg);stroke-width:2}
.node.selected circle{stroke:var(--accent);stroke-width:3}
.hidden{display:none}
.label{font-size:12px;fill:var(--fg);paint-order:stroke;stroke:var(--halo);stroke-width:4px;pointer-events:none}
aside{width:320px;flex:none;overflow:auto;padding:12px 16px;border-left:1px solid var(--border);background:var(--panel)}
aside h2{margin:0 0 6px;font-size:15px;word-break:break-all}
aside h3{margin:14px 0 4px;font-size:13px;color:var(--muted)}
dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:0}
dt{color:var(--muted)}
dd{margin:0}
ul{list-style:none;margin:0;padding:0}
li button{display:block;width:100%;text-align:left;border:0;background:none;padding:2px 0;word-break:break-all;text-decoration:underline;color:var(--fg)}
.empty{margin:48px auto;max-width:480px;padding:0 16px;text-align:center;color:var(--muted);font-size:16px}
@media (max-width:760px){main{flex-direction:column}aside{width:auto;max-height:40%;border-left:0;border-top:1px solid var(--border)}}
`;

/**
 * Script run in the browser. It reads the embedded JSON, lays the graph out with a
 * small force simulation (fixed iteration count, no randomness) and wires up the
 * interactions. All dynamic text goes through textContent, never innerHTML.
 */
const CLIENT_SCRIPT = String.raw`
(function () {
  'use strict';

  var data = JSON.parse(document.getElementById('map-data').textContent);
  var svg = document.getElementById('graph');
  if (data.nodes.length === 0) return;

  var SVG_NS = svg.namespaceURI;
  var UNKNOWN = 'unknown';
  var colourOf = {};
  var checkboxes = Array.prototype.slice.call(document.querySelectorAll('input[data-language]'));
  checkboxes.forEach(function (box) {
    colourOf[box.getAttribute('data-language')] = box.getAttribute('data-color');
  });

  function make(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    for (var key in attrs) node.setAttribute(key, attrs[key]);
    return node;
  }

  function languageOf(node) {
    return node.language || UNKNOWN;
  }

  function basename(path) {
    return path.slice(path.lastIndexOf('/') + 1);
  }

  /* Model: nodes with positions, links resolved to node objects, adjacency. */

  var byId = {};
  var nodes = data.nodes.map(function (n, index) {
    var model = {
      id: n.id,
      language: languageOf(n),
      chunks: n.chunks,
      references: n.references,
      index: index,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: Math.max(4, Math.min(16, 3 + Math.sqrt(n.chunks) * 1.8)),
      out: [],
      into: [],
      el: null,
      hidden: false,
    };
    byId[n.id] = model;
    return model;
  });

  var links = [];
  data.links.forEach(function (l) {
    var from = byId[l.from];
    var to = byId[l.to];
    if (!from || !to || from === to) return;
    var link = { from: from, to: to, weight: l.weight, el: null };
    from.out.push(to);
    to.into.push(from);
    links.push(link);
  });

  /* Layout: deterministic seeding, then a fixed number of cooled iterations. */

  function hash(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function seedPositions() {
    var spread = 40 * Math.sqrt(nodes.length);
    nodes.forEach(function (n) {
      var h = hash(n.id);
      var angle = ((h % 3600) / 3600) * 2 * Math.PI;
      var radius = spread * (0.2 + 0.8 * (((h >>> 12) % 1000) / 1000));
      n.x = Math.cos(angle) * radius;
      n.y = Math.sin(angle) * radius;
    });
  }

  var REPEL = 3600;
  var CUTOFF = 220;
  var SPRING_LENGTH = 70;
  var SPRING_PULL = 0.04;
  var CENTER_PULL = 0.012;

  function repel(grid) {
    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i];
      var cx = Math.floor(a.x / CUTOFF);
      var cy = Math.floor(a.y / CUTOFF);
      for (var gx = cx - 1; gx <= cx + 1; gx++) {
        for (var gy = cy - 1; gy <= cy + 1; gy++) {
          var cell = grid[gx + ',' + gy];
          if (!cell) continue;
          for (var j = 0; j < cell.length; j++) {
            var b = cell[j];
            if (b === a) continue;
            var dx = a.x - b.x;
            var dy = a.y - b.y;
            var d2 = dx * dx + dy * dy;
            if (d2 > CUTOFF * CUTOFF) continue;
            if (d2 < 1) {
              dx = ((a.index - b.index) % 7) + 0.5;
              dy = ((b.index - a.index) % 5) + 0.5;
              d2 = dx * dx + dy * dy;
            }
            var d = Math.sqrt(d2);
            var push = REPEL / d2;
            a.vx += (dx / d) * push;
            a.vy += (dy / d) * push;
          }
        }
      }
    }
  }

  function buildGrid() {
    var grid = {};
    nodes.forEach(function (n) {
      var key = Math.floor(n.x / CUTOFF) + ',' + Math.floor(n.y / CUTOFF);
      (grid[key] = grid[key] || []).push(n);
    });
    return grid;
  }

  function layout() {
    seedPositions();
    var iterations = Math.max(60, Math.min(300, Math.round(300000 / nodes.length)));
    for (var step = 0; step < iterations; step++) {
      var heat = 1 - step / iterations;
      repel(buildGrid());
      links.forEach(function (l) {
        var dx = l.to.x - l.from.x;
        var dy = l.to.y - l.from.y;
        var d = Math.sqrt(dx * dx + dy * dy) || 1;
        var pull = (d - SPRING_LENGTH) * SPRING_PULL;
        var fx = (dx / d) * pull;
        var fy = (dy / d) * pull;
        l.from.vx += fx;
        l.from.vy += fy;
        l.to.vx -= fx;
        l.to.vy -= fy;
      });
      var maxStep = 2 + 40 * heat;
      nodes.forEach(function (n) {
        n.vx -= n.x * CENTER_PULL;
        n.vy -= n.y * CENTER_PULL;
        n.vx *= 0.6;
        n.vy *= 0.6;
        var speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
        var scale = speed > maxStep ? maxStep / speed : 1;
        n.x += n.vx * scale;
        n.y += n.vy * scale;
      });
    }
  }

  /* Drawing. */

  var root = make('g', {});
  var linkLayer = make('g', {});
  var nodeLayer = make('g', {});
  var labelEl = make('text', { class: 'label hidden', 'text-anchor': 'middle' });
  var defs = make('defs', {});
  var marker = make('marker', {
    id: 'arrowhead',
    viewBox: '0 0 8 8',
    refX: '8',
    refY: '4',
    markerWidth: '8',
    markerHeight: '8',
    markerUnits: 'userSpaceOnUse',
    orient: 'auto',
  });
  marker.appendChild(make('path', { d: 'M0,0 L8,4 L0,8 z', class: 'arrow' }));
  defs.appendChild(marker);
  svg.appendChild(defs);
  root.appendChild(linkLayer);
  root.appendChild(nodeLayer);
  root.appendChild(labelEl);
  svg.appendChild(root);

  function drawLinks() {
    links.forEach(function (l) {
      var dx = l.to.x - l.from.x;
      var dy = l.to.y - l.from.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / d;
      var uy = dy / d;
      var line = make('line', {
        class: 'link',
        x1: l.from.x + ux * l.from.r,
        y1: l.from.y + uy * l.from.r,
        x2: l.to.x - ux * (l.to.r + 1),
        y2: l.to.y - uy * (l.to.r + 1),
        'stroke-width': Math.min(4, 0.8 + Math.log2(l.weight + 1) * 0.7),
        'marker-end': 'url(#arrowhead)',
      });
      l.el = line;
      linkLayer.appendChild(line);
    });
  }

  function describe(n) {
    return n.id + ' (' + n.language + ', ' + n.chunks + ' chunks)';
  }

  function drawNodes() {
    nodes.forEach(function (n) {
      var group = make('g', {
        class: 'node',
        tabindex: '0',
        role: 'button',
        'aria-label': describe(n),
        transform: 'translate(' + n.x + ' ' + n.y + ')',
      });
      var circle = make('circle', { r: n.r });
      circle.style.fill = 'var(--c' + (colourOf[n.language] || colourOf[UNKNOWN] || '13') + ')';
      var title = make('title', {});
      title.textContent = describe(n);
      group.appendChild(circle);
      group.appendChild(title);
      group.addEventListener('click', function () {
        select(n, false);
      });
      group.addEventListener('focus', function () {
        hovered = n;
        select(n, false);
      });
      group.addEventListener('blur', function () {
        if (hovered === n) hovered = null;
        refresh();
      });
      group.addEventListener('mouseenter', function () {
        hovered = n;
        refresh();
      });
      group.addEventListener('mouseleave', function () {
        if (hovered === n) hovered = null;
        refresh();
      });
      group.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select(n, false);
        }
      });
      n.el = group;
      nodeLayer.appendChild(group);
    });
  }

  /* State and styling. */

  var query = '';
  var selected = null;
  var hovered = null;

  function matches(n) {
    return query === '' || n.id.toLowerCase().indexOf(query) !== -1;
  }

  function isNeighbour(focus, n) {
    return n === focus || focus.out.indexOf(n) !== -1 || focus.into.indexOf(n) !== -1;
  }

  function refresh() {
    var focus = hovered || selected;
    nodes.forEach(function (n) {
      var dim = !matches(n) || (focus !== null && !isNeighbour(focus, n));
      n.el.classList.toggle('hidden', n.hidden);
      n.el.classList.toggle('dim', dim);
      n.el.classList.toggle('match', query !== '' && matches(n));
      n.el.classList.toggle('selected', n === selected);
    });
    links.forEach(function (l) {
      var gone = l.from.hidden || l.to.hidden;
      var incident = focus !== null && (l.from === focus || l.to === focus);
      l.el.classList.toggle('hidden', gone);
      l.el.classList.toggle('hl', incident);
      l.el.classList.toggle('dim', focus !== null && !incident);
    });
    if (focus && !focus.hidden) {
      labelEl.textContent = basename(focus.id);
      labelEl.setAttribute('x', focus.x);
      labelEl.setAttribute('y', focus.y - focus.r - 6);
      labelEl.classList.remove('hidden');
    } else {
      labelEl.classList.add('hidden');
    }
  }

  /* Side panel. */

  var panel = document.getElementById('panel');

  function addText(parent, tag, text) {
    var element = document.createElement(tag);
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }

  function addNeighbourList(title, list) {
    addText(panel, 'h3', title + ' (' + list.length + ')');
    if (list.length === 0) {
      addText(panel, 'p', 'None').className = 'count';
      return;
    }
    var ul = document.createElement('ul');
    list
      .slice()
      .sort(function (a, b) {
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      })
      .forEach(function (other) {
        var li = document.createElement('li');
        var button = addText(li, 'button', other.id);
        button.type = 'button';
        button.addEventListener('click', function () {
          select(other, true);
        });
        ul.appendChild(li);
      });
    panel.appendChild(ul);
  }

  function renderPanel(n) {
    panel.textContent = '';
    addText(panel, 'h2', n.id);
    var dl = document.createElement('dl');
    [
      ['Language', n.language],
      ['Chunks', String(n.chunks)],
      ['References', String(n.references)],
    ].forEach(function (row) {
      addText(dl, 'dt', row[0]);
      addText(dl, 'dd', row[1]);
    });
    panel.appendChild(dl);
    addNeighbourList('Imports', n.out);
    addNeighbourList('Imported by', n.into);
  }

  function select(n, jump) {
    if (n.hidden) {
      var box = checkboxes.filter(function (b) {
        return b.getAttribute('data-language') === n.language;
      })[0];
      if (box) box.checked = true;
      applyFilter();
    }
    selected = n;
    renderPanel(n);
    refresh();
    if (jump) {
      centreOn(n);
      n.el.focus({ preventScroll: true });
    }
  }

  /* Viewport: zoom and pan. */

  var view = { x: 0, y: 0, k: 1 };
  var MIN_ZOOM = 0.05;
  var MAX_ZOOM = 20;

  function size() {
    var rect = svg.getBoundingClientRect();
    return { w: rect.width || 800, h: rect.height || 600, left: rect.left, top: rect.top };
  }

  function applyView() {
    root.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')');
  }

  function zoomAt(factor, px, py) {
    var k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.k * factor));
    view.x = px - (px - view.x) * (k / view.k);
    view.y = py - (py - view.y) * (k / view.k);
    view.k = k;
    applyView();
  }

  function zoomCentre(factor) {
    var s = size();
    zoomAt(factor, s.w / 2, s.h / 2);
  }

  function fit() {
    var s = size();
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    nodes.forEach(function (n) {
      minX = Math.min(minX, n.x - n.r);
      minY = Math.min(minY, n.y - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      maxY = Math.max(maxY, n.y + n.r);
    });
    var k = Math.min((s.w - 60) / Math.max(1, maxX - minX), (s.h - 60) / Math.max(1, maxY - minY), 2.5);
    view.k = Math.max(MIN_ZOOM, k);
    view.x = s.w / 2 - ((minX + maxX) / 2) * view.k;
    view.y = s.h / 2 - ((minY + maxY) / 2) * view.k;
    applyView();
  }

  function centreOn(n) {
    var s = size();
    view.x = s.w / 2 - n.x * view.k;
    view.y = s.h / 2 - n.y * view.k;
    applyView();
  }

  svg.addEventListener(
    'wheel',
    function (event) {
      event.preventDefault();
      var s = size();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - s.left, event.clientY - s.top);
    },
    { passive: false },
  );

  var drag = null;
  svg.addEventListener('pointerdown', function (event) {
    if (event.button !== 0 || event.target.closest('.node')) return;
    drag = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
    svg.classList.add('panning');
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', function (event) {
    if (!drag) return;
    view.x = drag.vx + event.clientX - drag.x;
    view.y = drag.vy + event.clientY - drag.y;
    applyView();
  });
  function endDrag() {
    drag = null;
    svg.classList.remove('panning');
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  document.getElementById('zoom-in').addEventListener('click', function () {
    zoomCentre(1.4);
  });
  document.getElementById('zoom-out').addEventListener('click', function () {
    zoomCentre(1 / 1.4);
  });
  document.getElementById('zoom-reset').addEventListener('click', fit);

  /* Search and filter. */

  var search = document.getElementById('search');
  search.addEventListener('input', function () {
    query = search.value.trim().toLowerCase();
    refresh();
  });
  search.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' || query === '') return;
    var first = nodes.filter(function (n) {
      return !n.hidden && matches(n);
    })[0];
    if (first) select(first, true);
  });

  function applyFilter() {
    var shown = {};
    checkboxes.forEach(function (box) {
      shown[box.getAttribute('data-language')] = box.checked;
    });
    nodes.forEach(function (n) {
      n.hidden = !shown[n.language];
    });
    refresh();
  }
  checkboxes.forEach(function (box) {
    box.addEventListener('change', applyFilter);
  });

  layout();
  drawLinks();
  drawNodes();
  fit();
  refresh();
})();
`;

/**
 * Renders the dependency map as one self-contained HTML document: inline CSS, inline
 * script, inline SVG and no external requests. The data travels in a JSON script block
 * with markup characters escaped, and the page inserts text only through textContent.
 */
export function renderMapHtml(data: MapData, meta: MapMeta): string {
  const title = escapeHtml(meta.title);
  const empty = data.nodes.length === 0;
  const emptyMessage = empty
    ? '<p class="empty" role="status">No files are indexed yet, so there is nothing to draw. Index a codebase and generate the map again.</p>'
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLES}</style>
</head>
<body>
<header>
<h1>${title}</h1>
<p class="meta">Generated ${escapeHtml(meta.generatedAt)}</p>
<p class="meta" id="counts">${data.nodes.length} files, ${data.links.length} links, ${data.unresolvedImports} unresolved imports (imports of packages or namespaces are not drawn)</p>
</header>
<div class="toolbar" role="toolbar" aria-label="Map controls">
<input type="search" id="search" placeholder="Search file paths" aria-label="Search file paths"${empty ? ' disabled' : ''}>
<div class="zoom">
<button type="button" id="zoom-in" aria-label="Zoom in"${empty ? ' disabled' : ''}>+</button>
<button type="button" id="zoom-out" aria-label="Zoom out"${empty ? ' disabled' : ''}>&minus;</button>
<button type="button" id="zoom-reset" aria-label="Reset zoom"${empty ? ' disabled' : ''}>Reset</button>
</div>
<fieldset class="langs"><legend class="hidden">Languages</legend>${renderLanguageFilters(data)}</fieldset>
</div>
<main>
<div class="stage">
${emptyMessage}<svg id="graph" role="group" aria-label="Dependency graph of files"${empty ? ' class="hidden"' : ''}></svg>
</div>
<aside id="panel" aria-live="polite">Select a file to see its details.</aside>
</main>
<script type="application/json" id="map-data">${embedJson(data)}</script>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>
`;
}
