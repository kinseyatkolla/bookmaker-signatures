<script setup>
import { onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  exchangeAuthorizationCode,
  storePinterestTokenBundle,
} from "../lib/pinterestClient";

const OAUTH_STATE_KEY = "pinterest_oauth_state";

const route = useRoute();
const router = useRouter();

onMounted(async () => {
  const code = String(route.query.code || "");
  const state = String(route.query.state || "");
  const stored = sessionStorage.getItem(OAUTH_STATE_KEY) || "";

  if (!code) {
    await router.replace({
      path: "/pinterest/board-pins-booklet",
      query: { oauth: "missing_code" },
    });
    return;
  }
  if (!state || state !== stored) {
    await router.replace({
      path: "/pinterest/board-pins-booklet",
      query: { oauth: "state_mismatch" },
    });
    return;
  }

  sessionStorage.removeItem(OAUTH_STATE_KEY);

  const redirectUri = import.meta.env.VITE_PINTEREST_REDIRECT_URI;
  if (!redirectUri) {
    await router.replace({
      path: "/pinterest/board-pins-booklet",
      query: { oauth: "error", msg: "Missing redirect URI env" },
    });
    return;
  }

  try {
    const bundle = await exchangeAuthorizationCode({ code, redirectUri });
    storePinterestTokenBundle(bundle);
    await router.replace({
      path: "/pinterest/board-pins-booklet",
      query: { oauth: "ok" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Token exchange failed";
    await router.replace({
      path: "/pinterest/board-pins-booklet",
      query: { oauth: "error", msg },
    });
  }
});
</script>

<template>
  <main class="page">
    <section class="card">
      <p class="subtitle">Completing Pinterest sign-in…</p>
    </section>
  </main>
</template>
