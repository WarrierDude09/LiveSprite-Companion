import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

const CALLBACK_PROTOCOL = "livesprite:";
const CALLBACK_HOST = "login-callback";
const ALLOWED_PARAMS = new Set(["access_token", "is_new_user", "error", "error_description"]);

function parseCallback(rawUrl) {
  const url = new URL(rawUrl);
  if (
    url.protocol !== CALLBACK_PROTOCOL ||
    url.hostname !== CALLBACK_HOST ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    return null;
  }
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key)) return null;
  }
  const providerError = url.searchParams.get("error");
  if (providerError) {
    throw new Error(url.searchParams.get("error_description") || "Google sign-in was cancelled.");
  }
  const token = url.searchParams.get("access_token");
  if (!token || token.length < 32 || token.length > 16_384 || /[\s\u0000-\u001f]/.test(token)) {
    throw new Error("Google returned an invalid LiveSprite session.");
  }
  return token;
}

export async function listenForGoogleOAuth(onToken, onError) {
  const consume = async (urls = []) => {
    for (const rawUrl of urls) {
      try {
        const token = parseCallback(rawUrl);
        if (token) await onToken(token);
      } catch (error) {
        onError(error);
      }
    }
  };

  await consume((await getCurrent()) || []);
  return onOpenUrl(consume);
}
