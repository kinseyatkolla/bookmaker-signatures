<script setup>
import { RouterLink, RouterView } from "vue-router";
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <RouterLink to="/" class="app-brand">Bookmaker</RouterLink>
      <nav class="app-nav" aria-label="Primary">
        <RouterLink to="/" class="nav-link">Base Signatures</RouterLink>
        <RouterLink to="/flat-fit" class="nav-link">Flat Fit</RouterLink>
        <RouterLink to="/calendars" class="nav-link">Calendars</RouterLink>
        <RouterLink to="/pinterest" class="nav-link">Pinterest</RouterLink>
        <RouterLink to="/folded-zine-1" class="nav-link"
          >Folded Zine</RouterLink
        >
        <!-- <RouterLink to="/folded-zine-2" class="nav-link">Folded Zine 2</RouterLink> -->
      </nav>
    </header>
    <RouterView />
  </div>
</template>
