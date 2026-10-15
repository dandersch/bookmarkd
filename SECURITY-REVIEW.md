# Cursory security review

Reviewed source at `210b639c04472313ad2fb8afd57cfea142b2e5bc`. This is a small source review, not a penetration test or an end-to-end exploit demonstration. Bookmarkd intentionally relies on reverse-proxy authentication; the absence of built-in login is not treated as a finding.

## High: Stored HTML injection through bookmark data

**Evidence:** `extension/components.js`, `BookmarkItem.render()` (lines 81–108), interpolates bookmark URL and favicon values into `innerHTML` without escaping. The bookmark list passes stored values to the component (lines 885–898). The dashboard also loads these components.

**Prerequisite and impact:** An attacker must get crafted bookmark data into the database, for example through an authorized user importing or saving untrusted data. Rendering that bookmark can inject markup; script execution depends on the execution context and browser security policy.

**Mitigation:** Construct elements with DOM APIs and assign attributes as properties instead of interpolating HTML. Validate URL schemes as well.

## High: Server-side requests to arbitrary destinations

**Evidence:** `main.go`, `createBookmark()` (around line 632), calls `fetchBestFavicon()` with the supplied URL. That function uses an HTTP client to fetch the URL (around lines 531–535), including normal HTTP redirects.

**Prerequisite and impact:** An authenticated user or another actor able to submit bookmarks can cause the server to request destinations reachable from its network, including internal services. The consequences depend on those services and their responses.

**Mitigation:** Restrict outbound destinations, validate resolved addresses and each redirect, or isolate the server's network egress.

## Medium: Theme file path traversal

**Evidence:** `main.go`, `parseThemeCSS()` (around lines 982–988), extracts a theme name without path validation. `handleThemesAPI()` uses that name in a file path and writes the supplied CSS (around lines 1040–1046).

**Prerequisite and impact:** An actor able to submit a theme can use `../` path components to write a `.css` file outside the themes directory, subject to filesystem permissions.

**Mitigation:** Restrict names to safe identifiers and ensure the resolved path remains inside the themes directory.

## Conditional deployment risk: Permissive CORS

**Evidence:** `main.go`, `setCORSHeaders()` and `withCORS()` (around lines 381–393), allow any origin and accept preflight requests.

**Prerequisite and impact:** A wildcard origin alone does not permit credentialed cross-origin browser reads. Exposure depends on deployment configuration: an anonymously reachable API or a proxy that adds permissive credentialed CORS headers changes the risk.

**Mitigation:** Protect the backend and every route at the proxy, and use an origin and CSRF policy compatible with the extension and the chosen authentication mechanism.
