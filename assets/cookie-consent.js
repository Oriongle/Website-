(function () {
  var STORAGE_KEY = "orion_cookie_consent_v1";

  function getConsent() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setConsent(analytics) {
    var payload = {
      essential: true,
      analytics: !!analytics,
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    window.orionCookieConsent = payload;
    document.dispatchEvent(new CustomEvent("orion-cookie-consent", { detail: payload }));
  }

  if (getConsent()) {
    window.orionCookieConsent = getConsent();
    return;
  }

  var banner = document.createElement("div");
  banner.className = "cookieBanner";
  banner.innerHTML =
    '<div class="cookieBannerInner">' +
      '<p class="cookieText">We use essential cookies to run this site. Optional analytics cookies help us improve performance. Read our <a href="/privacy.html">Privacy Policy</a> and <a href="/cookies.html">Cookie Policy</a>.</p>' +
      '<div class="cookieActions">' +
        '<button class="cookieBtn" type="button" data-action="reject">Reject Optional</button>' +
        '<button class="cookieBtn cookieBtnPrimary" type="button" data-action="accept">Accept All</button>' +
      '</div>' +
    '</div>';

  banner.addEventListener("click", function (e) {
    var action = e.target && e.target.getAttribute("data-action");
    if (!action) return;
    if (action === "accept") setConsent(true);
    if (action === "reject") setConsent(false);
    banner.remove();
  });

  document.addEventListener("DOMContentLoaded", function () {
    document.body.appendChild(banner);
  });
})();
