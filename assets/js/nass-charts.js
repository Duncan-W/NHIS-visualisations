/* ---------------------------------------------------------------------------
   NASS prototype — chart rendering.

   Reads window.NASS_CHARTS, written by R/04-emit.R. Data arrives as a script
   rather than by fetch() because the site must work when opened from file://,
   where browsers block fetch against the local filesystem.

   Chart.js draws to a canvas, which is invisible to assistive technology and
   unreachable by keyboard. Two things are therefore built by hand rather than
   using Chart.js defaults:

     - the legend, as real <button>s whose swatch shows line style and point
       shape as well as colour, so colour never carries meaning on its own;
     - arrow-key navigation across data points, driving both the tooltip and a
       live region, so a keyboard user gets what a mouse user gets on hover.

   The data table under each chart is rendered by R at build time, so the
   figures are present with JavaScript disabled.
   --------------------------------------------------------------------------- */

(function () {
  'use strict';

  var REDUCED_MOTION = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function parseDash(s) {
    if (!s) return [];
    return String(s).split(',').map(function (n) { return parseInt(n, 10); })
                    .filter(function (n) { return !isNaN(n); });
  }

  function fmt(v) {
    if (v === null || v === undefined || isNaN(v)) return null;
    var opts = (v % 1 === 0) ? {} : { maximumFractionDigits: 1, minimumFractionDigits: 1 };
    return Number(v).toLocaleString('en-IE', opts);
  }

  /* Legend swatch: a short line in the series' dash pattern with its point
     marker centred on it. This is what carries the non-colour distinction. */
  function swatchSVG(series, chartType) {
    var NS = 'http://www.w3.org/2000/svg';
    var w = 28, h = 14, cy = h / 2;
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('class', 'legend-swatch');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    if (chartType === 'line') {
      var line = document.createElementNS(NS, 'line');
      line.setAttribute('x1', 0); line.setAttribute('y1', cy);
      line.setAttribute('x2', w); line.setAttribute('y2', cy);
      line.setAttribute('stroke', series.color);
      line.setAttribute('stroke-width', 2.5);
      var d = parseDash(series.dash);
      if (d.length) line.setAttribute('stroke-dasharray', d.join(' '));
      svg.appendChild(line);
      svg.appendChild(marker(NS, series, w / 2, cy));
    } else {
      var rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', 1); rect.setAttribute('y', 2);
      rect.setAttribute('width', w - 2); rect.setAttribute('height', h - 4);
      rect.setAttribute('fill', series.color);
      var bd = parseDash(series.dash);
      if (bd.length) {
        rect.setAttribute('stroke', '#ffffff');
        rect.setAttribute('stroke-width', 1.5);
        rect.setAttribute('stroke-dasharray', bd.join(' '));
      }
      svg.appendChild(rect);
    }
    return svg;
  }

  function marker(NS, series, cx, cy) {
    var r = 3.5, el;
    switch (series.point) {
      case 'triangle':
        el = document.createElementNS(NS, 'polygon');
        el.setAttribute('points', [cx, cy - r, cx + r, cy + r, cx - r, cy + r].join(' '));
        break;
      case 'rect':
        el = document.createElementNS(NS, 'rect');
        el.setAttribute('x', cx - r); el.setAttribute('y', cy - r);
        el.setAttribute('width', r * 2); el.setAttribute('height', r * 2);
        break;
      case 'rectRot':
        el = document.createElementNS(NS, 'polygon');
        el.setAttribute('points', [cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy].join(' '));
        break;
      case 'star':
        el = document.createElementNS(NS, 'path');
        el.setAttribute('d', 'M' + cx + ' ' + (cy - r) + 'V' + (cy + r) +
                             'M' + (cx - r) + ' ' + cy + 'H' + (cx + r) +
                             'M' + (cx - r * 0.7) + ' ' + (cy - r * 0.7) +
                             'L' + (cx + r * 0.7) + ' ' + (cy + r * 0.7) +
                             'M' + (cx + r * 0.7) + ' ' + (cy - r * 0.7) +
                             'L' + (cx - r * 0.7) + ' ' + (cy + r * 0.7));
        el.setAttribute('stroke', series.color);
        el.setAttribute('stroke-width', 1.4);
        el.setAttribute('fill', 'none');
        return el;
      default:
        el = document.createElementNS(NS, 'circle');
        el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
    }
    el.setAttribute('fill', series.color);
    return el;
  }

  function datasets(spec) {
    var isLine = spec.type === 'line';
    return spec.series.map(function (s) {
      var base = {
        label: s.name,
        data: s.data,
        borderColor: s.color,
        spanGaps: false
      };
      if (isLine) {
        base.backgroundColor = s.color;
        base.borderWidth = 2.5;
        base.borderDash = parseDash(s.dash);
        base.pointStyle = s.point || 'circle';
        base.pointRadius = 4;
        base.pointHoverRadius = 6;
        base.tension = 0;
        base.fill = false;
      } else {
        base.backgroundColor = s.color;
        base.borderColor = '#ffffff';
        base.borderWidth = parseDash(s.dash).length ? 1.5 : 0;
        base.borderDash = parseDash(s.dash);
        base.borderSkipped = false;
        base.maxBarThickness = 34;
      }
      return base;
    });
  }

  function chartOptions(spec, horizontal) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      /* No entry animation. Chart.js's first paint would otherwise be driven by
         requestAnimationFrame, and a dropped or throttled frame leaves the canvas
         blank until something forces a redraw - which is how charts below the fold
         could come up empty until a reload. Drawing synchronously on init removes
         that dependency entirely, and the brief treats the entry animation as
         optional. (REDUCED_MOTION is still honoured for everything else.) */
      animation: false,
      indexAxis: horizontal ? 'y' : 'x',
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },          /* replaced by the HTML legend */
        tooltip: {
          backgroundColor: '#222534',
          titleFont: { weight: '700' },
          padding: 10,
          displayColors: true,
          callbacks: {
            label: function (ctx) {
              var v = fmt(ctx.parsed[horizontal ? 'x' : 'y']);
              return ctx.dataset.label + ': ' + (v === null ? 'no value' : v);
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: horizontal, color: '#e5e5ff', drawBorder: false },
          ticks: { color: '#222534', autoSkip: !horizontal },
          title: horizontal && spec.y_label
            ? { display: true, text: spec.y_label, color: '#72778d' } : { display: false }
        },
        y: {
          beginAtZero: true,
          grid: { display: !horizontal, color: '#e5e5ff', drawBorder: false },
          ticks: {
            color: '#222534',
            callback: function (v) { return horizontal ? this.getLabelForValue(v) : fmt(v); }
          },
          title: !horizontal && spec.y_label
            ? { display: true, text: spec.y_label, color: '#72778d' } : { display: false }
        }
      }
    };
  }

  function buildLegend(list, chart, spec) {
    list.innerHTML = '';
    spec.series.forEach(function (s, i) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', 'true');
      btn.appendChild(swatchSVG(s, spec.type));
      var name = document.createElement('span');
      name.className = 'legend-name';
      name.textContent = s.name;
      btn.appendChild(name);
      btn.addEventListener('click', function () {
        var on = btn.getAttribute('aria-pressed') === 'true';
        chart.setDatasetVisibility(i, !on);
        btn.setAttribute('aria-pressed', String(!on));
        chart.update();
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  /* Arrow keys step through categories; the tooltip and the live region follow.
     This is the keyboard equivalent of hovering. */
  function keyboardNav(figure, chart, spec, live) {
    var idx = -1;

    function announce(i) {
      var parts = [spec.labels[i] + '.'];
      spec.series.forEach(function (s, di) {
        if (!chart.isDatasetVisible(di)) return;
        var v = fmt(s.data[i]);
        if (v === null) v = s.suppressed && s.suppressed[i] ? 'suppressed' : 'no value';
        parts.push(s.name + ' ' + v + '.');
      });
      live.textContent = parts.join(' ');
    }

    function show(i) {
      idx = i;
      var els = [], pt = null;
      spec.series.forEach(function (s, di) {
        if (!chart.isDatasetVisible(di)) return;
        var meta = chart.getDatasetMeta(di);
        if (meta.data[i]) {
          els.push({ datasetIndex: di, index: i });
          if (!pt) pt = meta.data[i].getCenterPoint();
        }
      });
      chart.setActiveElements(els);
      if (chart.tooltip && pt) {
        chart.tooltip.setActiveElements(els, { x: pt.x, y: pt.y });
      }
      chart.update('none');
      announce(i);
    }

    function clear() {
      idx = -1;
      chart.setActiveElements([]);
      if (chart.tooltip) chart.tooltip.setActiveElements([], { x: 0, y: 0 });
      chart.update('none');
      live.textContent = '';
    }

    figure.addEventListener('keydown', function (e) {
      var last = spec.labels.length - 1, handled = true;
      switch (e.key) {
        case 'ArrowRight': case 'ArrowDown': show(idx >= last ? 0 : idx + 1); break;
        case 'ArrowLeft':  case 'ArrowUp':   show(idx <= 0 ? last : idx - 1); break;
        case 'Home': show(0); break;
        case 'End':  show(last); break;
        case 'Escape': clear(); break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    });
    figure.addEventListener('blur', clear);
  }

  function summarise(spec) {
    var names = spec.series.map(function (s) { return s.name; }).join(', ');
    return spec.title + '. ' + spec.type + ' chart. ' +
           spec.series.length + ' series: ' + names + '. ' +
           spec.labels.length + ' categories from ' + spec.labels[0] +
           ' to ' + spec.labels[spec.labels.length - 1] +
           '. The same figures are in the data table below.';
  }

  function build(block) {
    var id = block.getAttribute('data-chart-id');
    var spec = window.NASS_CHARTS && window.NASS_CHARTS[id];
    if (!spec) return;

    var figure = block.querySelector('.chart-figure');
    var canvas = figure.querySelector('canvas');
    var horizontal = spec.type === 'bar';

    /* Horizontal bars need room per category, or 25 counties collide. */
    if (horizontal) {
      figure.style.height =
        Math.max(320, 60 + spec.labels.length * (18 * spec.series.length + 14)) + 'px';
    }

    var chart = new Chart(canvas.getContext('2d'), {
      type: spec.type === 'line' ? 'line' : 'bar',
      data: { labels: spec.labels, datasets: datasets(spec) },
      options: chartOptions(spec, horizontal)
    });

    figure.setAttribute('role', 'img');
    figure.setAttribute('tabindex', '0');
    figure.setAttribute('aria-label', summarise(spec));

    var live = block.querySelector('.chart-live');
    buildLegend(block.querySelector('.legend'), chart, spec);
    keyboardNav(figure, chart, spec, live);

    block.chart = chart;
    block.spec = spec;
    return chart;
  }

  var built = [];

  function init() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.font.family =
      getComputedStyle(document.body).getPropertyValue('font-family') || 'sans-serif';
    Chart.defaults.color = '#222534';

    Array.prototype.forEach.call(
      document.querySelectorAll('.chart-block[data-chart-id]'),
      function (block) {
        /* Isolate each chart: without this, one failure stops the loop and
           every chart below it silently never renders. */
        try {
          var c = build(block);
          if (c) built.push(c);
        } catch (err) {
          if (window.console) console.error('Chart failed:',
            block.getAttribute('data-chart-id'), err);
        }
      });

    /* The charts are built at DOMContentLoaded, before webfont metrics settle
       and before the page is tall enough to show a scrollbar - both of which
       change the available width. Resize once everything has finished loading
       so no chart is left sized against a layout that no longer exists. */
    window.addEventListener('load', resizeAll);
    if (document.readyState === 'complete') resizeAll();

    watchVisibility();
  }

  /* Repaint safety net - NOT lazy loading.
     Every chart is built up front, in the loop above. This only forces one
     redraw the first time a chart scrolls into view, to recover a canvas whose
     backing store the browser dropped while it was off-screen (Firefox and
     Safari both do this under memory pressure). If nothing was dropped the
     redraw is a no-op the viewer never sees. */
  function watchVisibility() {
    if (!('IntersectionObserver' in window)) return;
    var seen = new WeakSet();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var block = e.target;
        if (seen.has(block)) { io.unobserve(block); return; }
        seen.add(block);
        if (block.chart) {
          try { block.chart.update('none'); } catch (err) { /* nothing to do */ }
        }
        io.unobserve(block);
      });
    }, { rootMargin: '200px' });
    Array.prototype.forEach.call(
      document.querySelectorAll('.chart-block[data-chart-id]'),
      function (b) { io.observe(b); });
  }

  function resizeAll() {
    built.forEach(function (c) {
      try { c.resize(); } catch (e) { /* a disposed chart is not an error */ }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.NASS = { parseDash: parseDash, fmt: fmt, swatchSVG: swatchSVG,
                  datasets: datasets, chartOptions: chartOptions,
                  buildLegend: buildLegend, keyboardNav: keyboardNav,
                  summarise: summarise, REDUCED_MOTION: REDUCED_MOTION };
})();
