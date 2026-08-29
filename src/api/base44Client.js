import { createClient } from "@base44/sdk";

export const LIVE_SPRITE_APP_ID = "6a91eb974450aba1bcc39dcd";

export const base44 = createClient({
  appId: LIVE_SPRITE_APP_ID,
  options: {
    onError(error) {
      if (import.meta.env.DEV) console.warn("LiveSprite API error", error?.message);
    },
  },
});
