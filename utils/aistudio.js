const FS_ENDPOINT = "https://alkalimakersuite-pa.clients6.google.com/$rpc/google.alkali.boq.makersuite.makersuiteappletcontrol.proto.MakersuiteAppletControlService/ApplyFileSystemOperation";

function getApiKey() {
  return localStorage.getItem("gs_api_key") || "AIzaSyDdP816MREB3SkjZO04QXbjsigfcI0GWOs";
}

async function fsRequest(operations, appletId, authHeader) {
  // credentials: "include" sends google.com cookies automatically because
  // content script runs in aistudio.google.com context (same-site as the API)
  const res = await fetch(FS_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json+protobuf",
      "authorization": authHeader,
      "x-goog-api-key": getApiKey(),
      "x-goog-authuser": "0",
      "x-user-agent": "grpc-web-javascript/0.1",
    },
    body: JSON.stringify([operations, null, null, null, appletId]),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ApplyFileSystemOperation ${res.status}: ${text}`);
  }
  return res.json();
}

async function writeFile(appletId, authHeader, path, base64Content) {
  const op = [[path, base64Content], null, null, null, null, null];
  await fsRequest([op], appletId, authHeader);
}

async function listFiles(appletId, authHeader) {
  const op = [null, null, null, null, ["."], null];
  const result = await fsRequest([op], appletId, authHeader);
  const files = result?.[2]?.[0]?.[2]?.[0] ?? [];
  return files.map(([name, type]) => ({ name, type }));
}
