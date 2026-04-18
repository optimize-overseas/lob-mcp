export interface LobEnv {
  apiKey: string;
  apiVersion: string | undefined;
  baseUrl: string;
  mode: "test" | "live" | "unknown";
}

const DEFAULT_BASE_URL = "https://api.lob.com/v1";

export function loadEnv(): LobEnv {
  const apiKey = process.env.LOB_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "LOB_API_KEY environment variable is required. Provide a Lob API key " +
        "(`test_…` for test mode or `live_…` for live mode). See https://dashboard.lob.com/settings/api-keys.",
    );
  }

  const baseUrl = (process.env.LOB_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiVersion = process.env.LOB_API_VERSION?.trim() || undefined;

  let mode: LobEnv["mode"] = "unknown";
  if (apiKey.startsWith("test_")) mode = "test";
  else if (apiKey.startsWith("live_")) mode = "live";

  return { apiKey, apiVersion, baseUrl, mode };
}
