/**
 * Dashboard Links v1.0.0
 * Makes dashboard metric cards tappable — each jumps to the relevant view.
 */
(function () {
  'use strict';

  function enhance() {
    // Watch for dashboard renders
    var observer = new MutationObserver(function () {
      // Only linkify dashboard metric cards — Settings "About" cards reuse
      // .metric-card and must stay plain (no tap hint, no navigation).
      if (window.currentView && window.currentView !== 'dashboard') return;
      var cards = document.querySelectorAll('#mainContent .metric-card');
      if (!cards.length || cards[0].dataset.linked) return;

      cards.forEach(function (card) {
        if (!card.querySelector('.mc-value')) return; // dashboard metric cards only
        card.dataset.linked = '1';
        card.style.cursor = 'pointer';
        var label = card.querySelector('.font-mono');
        if (!label) return;
        var text = label.textContent.trim().toUpperCase();

        card.addEventListener('click', function () {
          if (typeof window.navigate !== 'function') return;
          if (text.indexOf('LOW STOCK') !== -1) {
            window.navigate('inventory');
            // Set stock filter to low after nav
            setTimeout(function () {
              var f = document.getElementById('stockFilter');
              if (f) { f.value = 'low'; f.dispatchEvent(new Event('change')); }
            }, 500);
          } else if (text.indexOf('INVENTORY') !== -1) {
            window.navigate('inventory');
          } else if (text.indexOf('REVENUE') !== -1) {
            window.navigate('sales');
          } else if (text.indexOf('MARGIN') !== -1) {
            window.navigate('sales');
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(enhance, 1500); });
  } else {
    setTimeout(enhance, 1500);
  }

  console.log('[DashboardLinks] Initialized');
})();
