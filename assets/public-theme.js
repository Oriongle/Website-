(function () {
  function revealSetup() {
    var blocks = document.querySelectorAll('main > section, main > div, .card');
    blocks.forEach(function (el, idx) {
      if (el.classList.contains('nav')) return;
      el.classList.add('reveal');
      el.style.transitionDelay = Math.min(idx * 40, 260) + 'ms';
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });

    document.querySelectorAll('.reveal').forEach(function (el) {
      io.observe(el);
    });
  }

  function tiltCards() {
    var cards = document.querySelectorAll('.card');
    cards.forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        var rect = card.getBoundingClientRect();
        var x = (e.clientX - rect.left) / rect.width - 0.5;
        var y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = 'rotateX(' + (-y * 2.4).toFixed(2) + 'deg) rotateY(' + (x * 2.4).toFixed(2) + 'deg) translateY(-2px)';
      });
      card.addEventListener('mouseleave', function () {
        card.style.transform = '';
      });
    });
  }

  window.addEventListener('DOMContentLoaded', function () {
    revealSetup();
    tiltCards();
  });
})();
