(function () {
  var consentRaw = localStorage.getItem("orion_cookie_consent_v1");
  var consent = consentRaw ? JSON.parse(consentRaw) : null;

  function loadGA() {
    if (window.__orionGaLoaded) return;
    var id = window.ORION_GA_MEASUREMENT_ID;
    if (!id) return;
    window.__orionGaLoaded = true;

    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
    document.head.appendChild(s);

    window.dataLayer = window.dataLayer || [];
    function gtag(){window.dataLayer.push(arguments);} // eslint-disable-line
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("config", id, { anonymize_ip: true });
  }

  if (consent && consent.analytics) loadGA();

  document.addEventListener("orion-cookie-consent", function (e) {
    if (e.detail && e.detail.analytics) loadGA();
  });
})();
