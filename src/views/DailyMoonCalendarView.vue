<script setup>
import BasicDailyAstrologyCalendarView from "./BasicDailyAstrologyCalendarView.vue";
</script>

<template>
  <BasicDailyAstrologyCalendarView
    page-title="Daily Moon Calendar"
    :is-moon-calendar-mode="true"
    :default-page-width="2.75"
    :default-page-height="4.25"
    :default-horizontal-gap="0"
    :default-vertical-gap="0"
    default-output-fold-axis="horizontal"
    :default-output-layout-cols="2"
    :default-output-layout-rows="2"
  />
</template>
