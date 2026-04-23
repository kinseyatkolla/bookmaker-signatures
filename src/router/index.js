import { createRouter, createWebHistory } from "vue-router";
import SignaturesView from "../views/SignaturesView.vue";
import FoldedZine1View from "../views/FoldedZine1View.vue";
import FoldedZine2View from "../views/FoldedZine2View.vue";
import CalendarsView from "../views/CalendarsView.vue";
import BasicCalendarView from "../views/BasicCalendarView.vue";
import BasicDailyAstrologyCalendarView from "../views/BasicDailyAstrologyCalendarView.vue";
import BasicWeeklyAstrologyCalendarView from "../views/BasicWeeklyAstrologyCalendarView.vue";
import DailyMoonCalendarView from "../views/DailyMoonCalendarView.vue";
import AshsDailyPlannerView from "../views/AshsDailyPlannerView.vue";

const routes = [
  { path: "/", name: "signatures", component: SignaturesView },
  { path: "/calendars", name: "calendars", component: CalendarsView },
  { path: "/calendars/basic", name: "calendars-basic", component: BasicCalendarView },
  {
    path: "/calendars/basic-daily-astrology",
    name: "calendars-basic-daily-astrology",
    component: BasicDailyAstrologyCalendarView,
  },
  {
    path: "/calendars/basic-weekly-astrology",
    name: "calendars-basic-weekly-astrology",
    component: BasicWeeklyAstrologyCalendarView,
  },
  {
    path: "/calendars/daily-moon",
    name: "calendars-daily-moon",
    component: DailyMoonCalendarView,
  },
  {
    path: "/calendars/ashs-daily-planner",
    name: "calendars-ashs-daily-planner",
    component: AshsDailyPlannerView,
  },
  { path: "/folded-zine-1", name: "folded-zine-1", component: FoldedZine1View },
  { path: "/folded-zine-2", name: "folded-zine-2", component: FoldedZine2View },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
