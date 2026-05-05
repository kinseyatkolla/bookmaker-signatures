<template>
  <main class="page">
    <section class="card">
      <h1>Pinterest</h1>
      <p class="subtitle">
        Booklets that start from your Pinterest boards. API calls run through the Vite
        dev server so your app secret never ships to the browser.
      </p>
      <ul class="pinterest-nav-list">
        <li>
          <RouterLink
            class="primary-button pinterest-nav-button"
            to="/pinterest/board-pins-booklet"
          >
            Board pins booklet
          </RouterLink>
        </li>
      </ul>
    </section>
  </main>
</template>

<script setup>
import { RouterLink } from "vue-router";
</script>

<style scoped>
.pinterest-nav-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}

.pinterest-nav-button {
  display: inline-flex;
  text-decoration: none;
}
</style>
