const STORAGE_KEY = "bookmaker_pinterest_tokens_v1";

/**
 * @typedef {{ access_token: string, refresh_token?: string, expires_at_ms?: number | null, scope?: string }} PinterestTokenBundle
 */

/** @returns {PinterestTokenBundle | null} */
export function getStoredPinterestTokenBundle() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** @param {PinterestTokenBundle | null} bundle */
export function storePinterestTokenBundle(bundle) {
  if (!bundle) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(bundle));
}

function normalizeTokenResponse(json) {
  const expiresIn = Number(json.expires_in) || 0;
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token || "",
    expires_at_ms: expiresIn ? Date.now() + expiresIn * 1000 : null,
    scope: json.scope || "",
    token_type: json.token_type || "bearer",
  };
}

async function postPinterestOAuthToken(bodyFields) {
  const res = await fetch("/api/pinterest/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyFields),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text.slice(0, 200) || "Invalid token response");
  }
  if (!res.ok) {
    const base =
      json?.message ||
      json?.error_description ||
      json?.error ||
      text.slice(0, 400) ||
      `HTTP ${res.status}`;
    const code = json?.code;
    const suffix =
      typeof code !== "undefined" && code !== null && code !== ""
        ? ` (Pinterest code ${code})`
        : "";
    throw new Error(
      typeof base === "string" ? `${base}${suffix}` : JSON.stringify(json),
    );
  }
  return normalizeTokenResponse(json);
}

export async function issueClientCredentialsToken() {
  const scope =
    import.meta.env.VITE_PINTEREST_CC_SCOPE || "boards:read,pins:read";
  return postPinterestOAuthToken({
    grant_type: "client_credentials",
    scope,
  });
}

export async function exchangeAuthorizationCode({ code, redirectUri }) {
  return postPinterestOAuthToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
}

export async function refreshAccessToken(refreshToken) {
  return postPinterestOAuthToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export function buildPinterestAuthorizeUrl({ state }) {
  const clientId = import.meta.env.VITE_PINTEREST_APP_ID;
  const redirectUri = import.meta.env.VITE_PINTEREST_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    throw new Error(
      "Set VITE_PINTEREST_APP_ID and VITE_PINTEREST_REDIRECT_URI for OAuth.",
    );
  }
  const scope =
    import.meta.env.VITE_PINTEREST_OAUTH_SCOPE || "boards:read,pins:read";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
  });
  if (state) {
    params.set("state", state);
  }
  return `https://www.pinterest.com/oauth/?${params.toString()}`;
}

/** Normalize pasted board URL or `username/board-slug` into a board key. */
export function normalizeBoardIdOrUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) {
    return "";
  }
  try {
    if (trimmed.includes("pinterest.")) {
      const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
      const path = url.pathname.replace(/^\/+|\/+$/g, "");
      const segments = path.split("/").filter(Boolean);
      if (segments.length >= 2 && segments[0] !== "pin") {
        return `${segments[0]}/${segments[1]}`;
      }
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

export async function pinterestV5Request(pathWithQuery, accessToken, init = {}) {
  const path = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  const url = `/api/pinterest/v5${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.headers || {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.message || json?.error || text;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(json));
  }
  return json;
}

function slugifyBoardName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function boardVanityKey(board) {
  const url = board?.url;
  if (url && typeof url === "string") {
    try {
      const parts = new URL(url.startsWith("http") ? url : `https://${url}`)
        .pathname.replace(/^\/+|\/+$/g, "")
        .split("/")
        .filter(Boolean);
      if (parts.length >= 2) {
        return `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`;
      }
    } catch {
      // ignore
    }
  }
  const username = String(board?.owner?.username || "").toLowerCase();
  const slug = slugifyBoardName(board?.name || "");
  if (username && slug) {
    return `${username}/${slug}`;
  }
  return "";
}

function looseBoardSlugMatch(boardKey, board) {
  if (!boardKey.includes("/")) {
    return false;
  }
  const parts = boardKey.split("/").map((p) => p.trim().toLowerCase());
  const user = parts[0];
  const slug = parts[1];
  if (!user || !slug) {
    return false;
  }
  const owner = String(board?.owner?.username || "").toLowerCase();
  if (owner !== user) {
    return false;
  }
  const url = board?.url;
  if (url && typeof url === "string") {
    try {
      const segs = new URL(url.startsWith("http") ? url : `https://${url}`)
        .pathname.split("/")
        .filter(Boolean);
      const last = segs[segs.length - 1]?.toLowerCase() || "";
      if (last === slug) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return slugifyBoardName(board?.name) === slug;
}

async function fetchUserBoardsPage(accessToken, bookmark) {
  const qs = new URLSearchParams({ page_size: "25" });
  if (bookmark) {
    qs.set("bookmark", bookmark);
  }
  const res = await fetch(`/api/pinterest/user-boards?${qs}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text.slice(0, 200) || "Invalid boards response");
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || text;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(data));
  }
  return data;
}

export async function fetchUserBoardsAll(accessToken) {
  const boards = [];
  let bookmark = "";
  for (;;) {
    const data = await fetchUserBoardsPage(accessToken, bookmark);
    const items = data?.items || [];
    boards.push(...items);
    bookmark = typeof data?.bookmark === "string" ? data.bookmark : "";
    if (!bookmark) {
      break;
    }
  }
  return boards;
}

/**
 * Pinterest list-pins expects the canonical board `id` (often numeric). Vanity
 * `username/slug` is resolved via GET /v5/boards when possible.
 */
export async function resolveBoardIdForPins(accessToken, boardKey) {
  const key = String(boardKey || "").trim();
  if (!key) {
    throw new Error("Missing board id.");
  }
  if (/^\d+$/.test(key)) {
    return key;
  }
  const lowered = key.toLowerCase();
  const boards = await fetchUserBoardsAll(accessToken);
  for (const b of boards) {
    if (String(b.id) === key) {
      return String(b.id);
    }
  }
  for (const b of boards) {
    if (boardVanityKey(b) === lowered) {
      return String(b.id);
    }
  }
  for (const b of boards) {
    if (looseBoardSlugMatch(key, b)) {
      return String(b.id);
    }
  }
  return key;
}

async function fetchBoardPinsPage(accessToken, boardId, bookmark) {
  const qs = new URLSearchParams({
    board_id: boardId,
    page_size: "25",
  });
  if (bookmark) {
    qs.set("bookmark", bookmark);
  }
  const res = await fetch(`/api/pinterest/board-pins?${qs}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text.slice(0, 200) || "Invalid pins response");
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || text;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(data));
  }
  return data;
}

export async function fetchBoardPinsAll(accessToken, boardKey) {
  const resolvedId = await resolveBoardIdForPins(accessToken, boardKey);
  const pins = [];
  let bookmark = "";
  for (;;) {
    const data = await fetchBoardPinsPage(accessToken, resolvedId, bookmark);
    const items = data?.items || [];
    for (const pin of items) {
      pins.push(pin);
    }
    bookmark = typeof data?.bookmark === "string" ? data.bookmark : "";
    if (!bookmark) {
      break;
    }
  }
  return pins;
}

export async function fetchImageAsFile({ imageUrl, fileName }) {
  const u = encodeURIComponent(imageUrl);
  const res = await fetch(`/api/pinterest/fetch-image?u=${u}`);
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg.slice(0, 300) || "Image download failed");
  }
  const blob = await res.blob();
  const type = blob.type || "image/jpeg";
  return new File([blob], fileName, { type });
}
