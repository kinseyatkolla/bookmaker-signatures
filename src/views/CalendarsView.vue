<template>
  <main class="page">
    <section class="card">
      <h1>Calendars</h1>
      <ul class="calendars-nav-list">
        <li>
          <RouterLink
            class="primary-button calendars-nav-button"
            to="/calendars/basic"
          >
            Basic Calendar
          </RouterLink>
        </li>
        <li>
          <RouterLink
            class="primary-button calendars-nav-button"
            to="/calendars/basic-daily-astrology"
          >
            Basic Daily Astrology Calendar
          </RouterLink>
        </li>
        <li>
          <RouterLink
            class="primary-button calendars-nav-button"
            to="/calendars/basic-weekly-astrology"
          >
            Basic Weekly Astrology Calendar
          </RouterLink>
        </li>
        <li>
          <RouterLink
            class="primary-button calendars-nav-button"
            to="/calendars/daily-moon"
          >
            Daily Moon Calendar
          </RouterLink>
        </li>
        <li>
          <RouterLink
            class="primary-button calendars-nav-button"
            to="/calendars/ashs-daily-planner"
          >
            Ash's Daily Planner
          </RouterLink>
        </li>
        <li>
          <RouterLink
            class="primary-button calendars-nav-button"
            to="/calendars/five-year-flip"
          >
            Five Year Flip
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
.calendars-nav-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}

.calendars-nav-button {
  display: inline-flex;
  text-decoration: none;
}
</style>
