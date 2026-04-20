<template>
  <main class="page">
    <section class="card">
      <h1>Calendars</h1>
      <p class="subtitle">
        Calendar-focused imposition workflows live here.
      </p>
      <RouterLink class="primary-button calendars-nav-button" to="/calendars/basic">
        Basic Calendar
      </RouterLink>
    </section>
  </main>
</template>

<script setup>
import { RouterLink } from "vue-router";
</script>

<style scoped>
.calendars-nav-button {
  display: inline-flex;
  margin-top: 0.75rem;
  text-decoration: none;
}
</style>
