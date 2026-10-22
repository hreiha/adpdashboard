const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// data.json and team.json are bundled into the function at build time, so neither is
// reachable as a static file. Every request goes through the auth check below.
const data = require("../data.json");

// team.json may not exist on a first deployment, so a missing file is not fatal: the
// team page then reports that the refresh has not run yet.
let teamData = null;
try {
  teamData = require("../team.json");
} catch (err) {
  teamData = null;
}

// Read with a literal __dirname path. Vercel's file tracing follows this pattern and
// bundles the file automatically, which is why no "functions" block is needed in vercel.json.
function readView(name) {
  try {
    return fs.readFileSync(path.join(__dirname, "../views/" + name), "utf8");
  } catch (err) {
    return null;
  }
}

const html = readView("index.html");
const teamHtml = readView("team.html");

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Each dashboard has its own credentials.
 *
 *   P&C dashboard at /          DASH_USER / DASH_PASS
 *   Bids and IT at /team        TEAM_USER / TEAM_PASS
 *
 * The two are independent on purpose: the Bids and IT password can be handed out widely
 * without giving anyone the P&C page, which carries turnover, leaver names and pay.
 *
 * Trimmed, because a trailing space or newline pasted into the Vercel field is invisible
 * in the UI and would otherwise fail every sign in attempt.
 */
function credentials(prefix) {
  return {
    user: (process.env[prefix + "_USER"] || "").trim(),
    pass: (process.env[prefix + "_PASS"] || "").trim()
  };
}

function authorised(req, creds) {
  if (!creds.user || !creds.pass) return false;

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) return false;

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;

  return safeEqual(decoded.slice(0, idx), creds.user) &&
         safeEqual(decoded.slice(idx + 1), creds.pass);
}

/**
 * The team page accepts its own credentials or the P&C ones, so that whoever runs the
 * P&C dashboard does not need a second login to look at it. It does not work the other
 * way round: TEAM credentials never open the P&C dashboard.
 */
function allowedFor(req, realm) {
  if (realm === "team") {
    const team = credentials("TEAM");
    const dash = credentials("DASH");
    const teamConfigured = !!(team.user && team.pass);
    const dashConfigured = !!(dash.user && dash.pass);

    // No password set anywhere means the site runs open, same as the P&C page
    if (!teamConfigured && !dashConfigured) return { enabled: false, ok: true };

    return {
      enabled: true,
      ok: (teamConfigured && authorised(req, team)) || (dashConfigured && authorised(req, dash))
    };
  }

  const dash = credentials("DASH");
  const enabled = !!(dash.user && dash.pass);
  return { enabled: enabled, ok: !enabled || authorised(req, dash) };
}

function challenge(res, realm) {
  const name = realm === "team" ? "Bids & IT Dashboard" : "P&C Dashboard";
  res.statusCode = 401;
  res.setHeader("WWW-Authenticate", 'Basic realm="' + name + '", charset="UTF-8"');
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  return res.end("Sign in to view this dashboard.");
}

const OPEN_BANNER =
  '<div style="background:#FF6D2E;color:#fff;padding:10px 24px;font:500 13px/1.4 ' +
  'Archivo,system-ui,sans-serif">This dashboard has no sign in. Set the user and ' +
  'password variables in Vercel before it holds real figures.</div>';

module.exports = (req, res) => {
  const route = (req.url || "/").split("?")[0].replace(/\/+$/, "") || "/";

  // Diagnostic, deliberately before the auth check so it can be reached when sign in fails.
  // Reports the shape of the configured values, never the values themselves.
  if (route === "/healthz") {
    const dash = credentials("DASH");
    const team = credentials("TEAM");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.end(JSON.stringify({
      ok: true,
      dashboard: {
        authEnabled: !!(dash.user && dash.pass),
        userConfigured: dash.user.length > 0,
        passConfigured: dash.pass.length > 0,
        userLength: dash.user.length,
        passLength: dash.pass.length
      },
      team: {
        authEnabled: !!(team.user && team.pass),
        userConfigured: team.user.length > 0,
        passConfigured: team.pass.length > 0,
        userLength: team.user.length,
        passLength: team.pass.length,
        dataPresent: teamData !== null,
        viewPresent: teamHtml !== null
      },
      deployedAt: new Date().toISOString()
    }));
  }

  const isTeam = route === "/team" || route === "/team.json";
  const realm = isTeam ? "team" : "dash";
  const auth = allowedFor(req, realm);

  if (!auth.ok) return challenge(res, realm);

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  // ---- Bids and IT dashboard

  if (route === "/team.json") {
    if (!teamData) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({
        error: "team.json has not been generated yet. Run the refresh workflow."
      }));
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify(teamData));
  }

  if (route === "/team") {
    if (!teamHtml) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.end("views/team.html was not bundled with the function.");
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(auth.enabled ? teamHtml : teamHtml.replace("<body>", "<body>" + OPEN_BANNER));
  }

  // ---- P&C dashboard

  if (route === "/data.json") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify(data));
  }

  if (!html) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("views/index.html was not bundled with the function. Tell Claude and we will inline it instead.");
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.end(auth.enabled ? html : html.replace("<body>", "<body>" + OPEN_BANNER));
};
