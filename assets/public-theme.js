(function () {
  function revealSetup() {
    var blocks = document.querySelectorAll('main > section, main > div, .card, .appGalleryCard');
    blocks.forEach(function (el, idx) {
      if (el.classList.contains('nav')) return;
      el.classList.add('reveal');
      el.style.transitionDelay = Math.min(idx * 34, 220) + 'ms';
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.reveal').forEach(function (el) {
      io.observe(el);
    });
  }

  function activeNavState() {
    var path = window.location.pathname.replace(/\/index\.html$/, '/').replace(/index\.html$/, '');
    document.querySelectorAll('.navLinks a').forEach(function (link) {
      var href = link.getAttribute('href') || '';
      if (!href) return;
      if (path === '/' && (href === 'index.html' || href === '/index.html')) {
        link.style.background = 'rgba(255,255,255,0.09)';
        link.style.borderColor = 'rgba(137, 240, 208, 0.28)';
      } else if (href !== 'index.html' && href !== '/index.html' && path.indexOf(href.replace(/^\//, '').replace(/\.html$/, '')) !== -1) {
        link.style.background = 'rgba(255,255,255,0.09)';
        link.style.borderColor = 'rgba(137, 240, 208, 0.28)';
      }
    });
  }

  window.addEventListener('DOMContentLoaded', function () {
    revealSetup();
    activeNavState();
  });
})();
