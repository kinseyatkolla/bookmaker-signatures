import { createRouter, createWebHistory } from "vue-router";
import SignaturesView from "../views/SignaturesView.vue";
import FoldedZine1View from "../views/FoldedZine1View.vue";
import FoldedZine2View from "../views/FoldedZine2View.vue";
import CalendarsView from "../views/CalendarsView.vue";

const routes = [
  { path: "/", name: "signatures", component: SignaturesView },
  { path: "/calendars", name: "calendars", component: CalendarsView },
  { path: "/folded-zine-1", name: "folded-zine-1", component: FoldedZine1View },
  { path: "/folded-zine-2", name: "folded-zine-2", component: FoldedZine2View },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
