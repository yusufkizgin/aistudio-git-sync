// Runs in content script context — document.cookie is accessible (SAPISID is not HttpOnly)

async function getSAPIHash(sapisidValue, hashName, origin = "https://aistudio.google.com") {
  const ts = Math.floor(Date.now() / 1000);
  const buf = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(`${ts} ${sapisidValue} ${origin}`)
  );
  const hex = Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hashName} ${ts}_${hex}`;
}

async function getAuthHeader() {
  const entry = document.cookie.split(";").map(s => s.trim())
    .find(s => s.startsWith("SAPISID="));
  if (!entry) throw new Error("SAPISID cookie not found — make sure you are logged into AI Studio");
  const val = entry.split("=").slice(1).join("=");
  const [h1, h2, h3] = await Promise.all([
    getSAPIHash(val, "SAPISIDHASH"),
    getSAPIHash(val, "SAPISID1PHASH"),
    getSAPIHash(val, "SAPISID3PHASH"),
  ]);
  return `${h1} ${h2} ${h3}`;
}
