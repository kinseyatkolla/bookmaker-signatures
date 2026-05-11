<template>
  <main class="page">
    <section class="card">
      <h1>Political</h1>
      <ul class="political-nav-list">
        <li>
          <RouterLink
            class="primary-button political-nav-button"
            to="/political/principles-of-communism"
          >
            The Principles of Communism
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
.political-nav-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}

.political-nav-button {
  display: inline-flex;
  text-decoration: none;
}
</style>
