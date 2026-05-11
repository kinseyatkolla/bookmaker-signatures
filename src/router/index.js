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
import FiveYearFlipView from "../views/FiveYearFlipView.vue";
import FlatFitView from "../views/FlatFitView.vue";
import PoliticalHubView from "../views/PoliticalHubView.vue";
import PrinciplesOfCommunismView from "../views/PrinciplesOfCommunismView.vue";
import PinterestHubView from "../views/PinterestHubView.vue";
import PinterestBoardPinsBookletView from "../views/PinterestBoardPinsBookletView.vue";
import PinterestOAuthCallbackView from "../views/PinterestOAuthCallbackView.vue";

const routes = [
  { path: "/", name: "signatures", component: SignaturesView },
  { path: "/flat-fit", name: "flat-fit", component: FlatFitView },
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
  {
    path: "/calendars/five-year-flip",
    name: "calendars-five-year-flip",
    component: FiveYearFlipView,
  },
  { path: "/folded-zine-1", name: "folded-zine-1", component: FoldedZine1View },
  { path: "/folded-zine-2", name: "folded-zine-2", component: FoldedZine2View },
  { path: "/political", name: "political", component: PoliticalHubView },
  {
    path: "/political/principles-of-communism",
    name: "political-principles-of-communism",
    component: PrinciplesOfCommunismView,
  },
  { path: "/pinterest", name: "pinterest", component: PinterestHubView },
  {
    path: "/pinterest/board-pins-booklet",
    name: "pinterest-board-pins-booklet",
    component: PinterestBoardPinsBookletView,
  },
  {
    path: "/pinterest/oauth/callback",
    name: "pinterest-oauth-callback",
    component: PinterestOAuthCallbackView,
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
