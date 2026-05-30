async function githubFetch(path, token) {
  let res;
  try {
    res = await fetch(`https://api.github.com${path}`, {
      headers: {
        "Authorization": `token ${token}`,
        "Accept": "application/vnd.github.v3+json",
      }
    });
  } catch (e) {
    throw new Error(`GitHub network error: ${e.message}`);
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub ${res.status}: ${err}`);
  }
  return res.json();
}

async function getLatestCommitSha(owner, repo, branch, token) {
  const data = await githubFetch(`/repos/${owner}/${repo}/commits/${branch}`, token);
  return data.sha;
}

async function getFileTree(owner, repo, sha, token) {
  const data = await githubFetch(
    `/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    token
  );
  return data.tree.filter(item => item.type === "blob");
}

// blobSha: the git blob SHA from the tree listing (used for large/binary files)
async function getFileContent(owner, repo, path, token, blobSha) {
  // Try Contents API first (works for files ≤ 1 MB, returns inline base64)
  let data;
  try {
    data = await githubFetch(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
      token
    );
  } catch (e) {
    if (!blobSha) throw e;
    data = {};
  }

  if (data.content && data.content.trim()) {
    return data.content.replace(/\n/g, "");
  }

  // Large / binary files: use Git Blobs API (api.github.com, no CORS issues,
  // no expiring tokens, always returns base64 up to 100 MB)
  if (blobSha) {
    const blob = await githubFetch(
      `/repos/${owner}/${repo}/git/blobs/${blobSha}`,
      token
    );
    if (blob.content) return blob.content.replace(/\n/g, "");
    throw new Error(`Blob API returned empty content for ${path}`);
  }

  throw new Error(`No content available for ${path}`);
}
