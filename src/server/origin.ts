import "server-only";

type OriginConfiguration = {
  APP_URL?: string;
  VERCEL?: string;
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
};

function configuredOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Trust server configuration, never the request's Host or forwarded headers. */
export function isAllowedRequestOrigin(
  request: Request,
  config: OriginConfiguration = {
    APP_URL: process.env.APP_URL,
    VERCEL: process.env.VERCEL,
    VERCEL_URL: process.env.VERCEL_URL,
    VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  },
) {
  const origin = request.headers.get("origin");
  const canonical = configuredOrigin(config.APP_URL);
  if (!origin || !canonical || configuredOrigin(origin) !== origin)
    return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const allowed = new Set([canonical]);
  if (config.VERCEL === "1") {
    for (const hostname of [
      config.VERCEL_URL,
      config.VERCEL_BRANCH_URL,
      config.VERCEL_PROJECT_PRODUCTION_URL,
    ]) {
      // Vercel provides hostnames, not URLs or wildcard domain patterns.
      if (
        !hostname ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(
          hostname,
        )
      )
        continue;
      const deploymentOrigin = configuredOrigin("https://" + hostname);
      if (deploymentOrigin) allowed.add(deploymentOrigin);
    }
  }
  return allowed.has(origin);
}
