import { loadEnv } from "vite";

const PINTEREST_API_ORIGIN = "https://api.pinterest.com";

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendText(res, status, text) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(text);
}

function basicAuthHeader(appId, appSecret) {
  const token = Buffer.from(`${appId}:${appSecret}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

function parseRequestQuery(reqUrl) {
  const q = reqUrl.indexOf("?");
  if (q < 0) {
    return new URLSearchParams();
  }
  return new URLSearchParams(reqUrl.slice(q + 1));
}

function readBearerToken(req) {
  const auth = req.headers.authorization || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function isAllowedImageHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) {
    return false;
  }
  if (host === "i.pinimg.com" || host === "s.pinimg.com") {
    return true;
  }
  if (host.endsWith(".pinimg.com")) {
    return true;
  }
  if (host === "media.pinterest.com" || host.endsWith(".media.pinterest.com")) {
    return true;
  }
  return false;
}

async function forwardPinterestToken(appId, appSecret, formParams) {
  const body = new URLSearchParams(formParams).toString();
  const res = await fetch(`${PINTEREST_API_ORIGIN}/v5/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(appId, appSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

export function pinterestApiPlugin() {
  return {
    name: "pinterest-api-dev-proxy",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) {
          next();
          return;
        }

        const env = loadEnv(server.config.mode, process.cwd(), "");
        const appId = env.PINTEREST_APP_ID || env.VITE_PINTEREST_APP_ID;
        const appSecret = env.PINTEREST_APP_SECRET;

        if (req.method === "POST" && req.url.startsWith("/api/pinterest/oauth/token")) {
          if (!appId || !appSecret) {
            sendText(
              res,
              503,
              "Set PINTEREST_APP_ID and PINTEREST_APP_SECRET in .env for token exchange.",
            );
            return;
          }
          try {
            const body = await readJsonBody(req);
            const grantType = String(body.grant_type || "");
            let formParams;
            if (grantType === "authorization_code") {
              formParams = {
                grant_type: "authorization_code",
                code: String(body.code || ""),
                redirect_uri: String(body.redirect_uri || ""),
              };
            } else if (grantType === "refresh_token") {
              formParams = {
                grant_type: "refresh_token",
                refresh_token: String(body.refresh_token || ""),
              };
            } else if (grantType === "client_credentials") {
              formParams = {
                grant_type: "client_credentials",
                scope: String(body.scope || "boards:read,pins:read"),
              };
            } else {
              sendJson(res, 400, { error: "Unsupported grant_type" });
              return;
            }
            const out = await forwardPinterestToken(appId, appSecret, formParams);
            res.statusCode = out.status;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(out.text);
          } catch (error) {
            sendText(
              res,
              500,
              error instanceof Error ? error.message : "Token exchange failed",
            );
          }
          return;
        }

        if (req.method === "GET" && req.url.startsWith("/api/pinterest/fetch-image")) {
          const question = req.url.indexOf("?");
          const qs = question >= 0 ? new URLSearchParams(req.url.slice(question)) : new URLSearchParams();
          const raw = qs.get("u") || "";
          let target;
          try {
            target = new URL(decodeURIComponent(raw));
          } catch {
            sendText(res, 400, "Invalid image URL");
            return;
          }
          if (target.protocol !== "https:" && target.protocol !== "http:") {
            sendText(res, 400, "Only http(s) image URLs are allowed");
            return;
          }
          if (!isAllowedImageHost(target.hostname)) {
            sendText(res, 400, "Image host is not on the Pinterest allowlist");
            return;
          }
          try {
            const imgRes = await fetch(target.toString(), {
              headers: { Accept: "image/*,*/*" },
            });
            if (!imgRes.ok) {
              sendText(res, 502, `Upstream image error ${imgRes.status}`);
              return;
            }
            const buf = Buffer.from(await imgRes.arrayBuffer());
            const contentType = imgRes.headers.get("content-type") || "application/octet-stream";
            res.statusCode = 200;
            res.setHeader("Content-Type", contentType);
            res.setHeader("Cache-Control", "private, max-age=3600");
            res.end(buf);
          } catch (error) {
            sendText(
              res,
              502,
              error instanceof Error ? error.message : "Image fetch failed",
            );
          }
          return;
        }

        if (req.method === "GET" && req.url.startsWith("/api/pinterest/board-pins")) {
          const accessToken = readBearerToken(req);
          if (!accessToken) {
            sendJson(res, 401, { error: "Missing Bearer access token" });
            return;
          }
          const params = parseRequestQuery(req.url);
          const boardId = params.get("board_id") || "";
          if (!boardId || boardId.length > 512) {
            sendText(res, 400, "Missing or invalid board_id query parameter.");
            return;
          }
          const pinterestQs = new URLSearchParams();
          const pageSize = params.get("page_size") || "25";
          pinterestQs.set("page_size", pageSize);
          const bookmark = params.get("bookmark");
          if (bookmark) {
            pinterestQs.set("bookmark", bookmark);
          }
          const segment = encodeURIComponent(boardId);
          const upstreamUrl = `${PINTEREST_API_ORIGIN}/v5/boards/${segment}/pins?${pinterestQs.toString()}`;
          try {
            const upstream = await fetch(upstreamUrl, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
              },
            });
            const text = await upstream.text();
            res.statusCode = upstream.status;
            const ct = upstream.headers.get("content-type") || "application/json; charset=utf-8";
            res.setHeader("Content-Type", ct);
            res.end(text);
          } catch (error) {
            sendText(
              res,
              502,
              error instanceof Error ? error.message : "Pinterest board pins proxy failed",
            );
          }
          return;
        }

        if (req.method === "GET" && req.url.startsWith("/api/pinterest/user-boards")) {
          const accessToken = readBearerToken(req);
          if (!accessToken) {
            sendJson(res, 401, { error: "Missing Bearer access token" });
            return;
          }
          const params = parseRequestQuery(req.url);
          const pinterestQs = new URLSearchParams();
          pinterestQs.set("page_size", params.get("page_size") || "25");
          const bookmark = params.get("bookmark");
          if (bookmark) {
            pinterestQs.set("bookmark", bookmark);
          }
          const upstreamUrl = `${PINTEREST_API_ORIGIN}/v5/boards?${pinterestQs.toString()}`;
          try {
            const upstream = await fetch(upstreamUrl, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
              },
            });
            const text = await upstream.text();
            res.statusCode = upstream.status;
            const ct = upstream.headers.get("content-type") || "application/json; charset=utf-8";
            res.setHeader("Content-Type", ct);
            res.end(text);
          } catch (error) {
            sendText(
              res,
              502,
              error instanceof Error ? error.message : "Pinterest boards list proxy failed",
            );
          }
          return;
        }

        if (req.url.startsWith("/api/pinterest/v5/")) {
          const auth = req.headers.authorization || "";
          const match = auth.match(/^Bearer\s+(.+)$/i);
          const accessToken = match ? match[1].trim() : "";
          if (!accessToken) {
            sendJson(res, 401, { error: "Missing Bearer access token" });
            return;
          }
          const pathFromApi = req.url.slice("/api/pinterest".length);
          const upstreamUrl = `${PINTEREST_API_ORIGIN}${pathFromApi}`;
          try {
            const headers = {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            };
            const upstream = await fetch(upstreamUrl, { method: req.method, headers });
            const text = await upstream.text();
            res.statusCode = upstream.status;
            const ct = upstream.headers.get("content-type") || "application/json; charset=utf-8";
            res.setHeader("Content-Type", ct);
            res.end(text);
          } catch (error) {
            sendText(
              res,
              502,
              error instanceof Error ? error.message : "Pinterest proxy failed",
            );
          }
          return;
        }

        next();
      });
    },
  };
}
