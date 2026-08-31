/* ---------------------------------------------------------------------------
   NASS prototype — the faceted chart.

   One chart on the edition page has a dimension too many to show at once, so
   the leftover one becomes a <select>. Reuses the legend, keyboard navigation
   and formatting helpers from nass-charts.js (exposed as window.NASS) so it
   behaves exactly like every other chart on the page.

   The data table is rendered into the page by R with every facet present, so it
   is complete with JavaScript disabled. This script filters those rows to match
   the selection rather than rebuilding them.
   --------------------------------------------------------------------------- */

(function () {
  'use strict';

  function init() {
    var spec = window.NASS_FACET;
    var block = document.querySelector('[data-facet-chart]');
    if (!spec || !block || typeof Chart === 'undefined' || !window.NASS) return;

    var N = window.NASS;
    var select = block.querySelector('#facet-select');
    var figure = block.querySelector('.chart-figure');
    var canvas = figure.querySelector('canvas');
    var live = block.querySelector('.chart-live');
    var note = block.querySelector('[data-table-note]');
    var rows = block.querySelectorAll('tbody tr[data-facet]');

    /* Shape one facet's values into what the shared helpers expect. */
    function specFor(facet) {
      return {
        id: spec.id,
        type: spec.type,
        title: spec.title + ' — ' + facet,
        labels: spec.labels,
        y_label: spec.y_label,
        series: spec.series.map(function (s) {
          return {
            name: s.name, color: s.color, dash: s.dash, point: s.point,
            data: spec.data[facet][s.name],
            suppressed: null
          };
        })
      };
    }

    var current = spec.facets[0];
    var view = specFor(current);
    var horizontal = spec.type === 'bar';

    var chart = new Chart(canvas.getContext('2d'), {
      type: spec.type === 'line' ? 'line' : 'bar',
      data: { labels: view.labels, datasets: N.datasets(view) },
      options: N.chartOptions(view, horizontal)
    });

    figure.setAttribute('role', 'img');
    figure.setAttribute('tabindex', '0');
    N.buildLegend(block.querySelector('.legend'), chart, view);
    N.keyboardNav(figure, chart, view, live);

    function apply(facet) {
      current = facet;
      var next = specFor(facet);
      chart.data.datasets.forEach(function (ds, i) {
        ds.data = next.series[i].data;
      });
      /* keyboardNav reads the spec it was given, so update it in place */
      view.series.forEach(function (s, i) { s.data = next.series[i].data; });
      view.title = next.title;
      chart.update();

      figure.setAttribute('aria-label', N.summarise(next));

      for (var i = 0; i < rows.length; i++) {
        rows[i].hidden = rows[i].getAttribute('data-facet') !== facet;
      }
      if (note) {
        note.textContent = 'Showing ' + facet +
          '. Change the selector above to see another region; the CSV download contains all of them.';
      }
    }

    select.addEventListener('change', function () { apply(select.value); });
    select.value = current;
    apply(current);

    /* Same safety net as the other charts: re-sync once the page has finished
       loading, in case the layout moved under it after it was built. */
    block.chart = chart;
    window.addEventListener('load', function () {
      try { chart.resize(); } catch (e) { /* nothing to do */ }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
