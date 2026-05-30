// Runs in MAIN world at document_start — intercepts AI Studio's CAS fetch requests.
// When AI Studio fetches /_/upload/{appletId}/file/{sha256} and it would 404,
// we serve the content from localStorage cache instead.

(function () {
  const CACHE_PREFIX = "git_sync_file_";
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    const url = (typeof input === "string" ? input : input?.url) || "";

    if (url.includes("/_/upload/") && url.includes("/file/") &&
        (!init?.method || init.method === "GET")) {
      const hash = url.split("/file/")[1]?.split("?")[0];
      if (hash && hash.length === 64) {
        const cached = localStorage.getItem(CACHE_PREFIX + hash);
        if (cached) {
          const rawBytes = Uint8Array.from(atob(cached), c => c.charCodeAt(0));
          return new Response(rawBytes, {
            status: 200,
            headers: { "Content-Type": "application/octet-stream" }
          });
        }
      }
    }

    // Capture AI Studio's own API key for our use
    if (url.includes("alkalimakersuite-pa.clients6.google.com")) {
      const key = init?.headers?.["x-goog-api-key"];
      if (key) localStorage.setItem("gs_api_key", key);
    }

    return originalFetch(input, init);
  };
})();
