import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      name: "dashboard",
      component: () => import("../views/DashboardView.vue"),
    },
    {
      path: "/new",
      name: "new-sim",
      component: () => import("../views/NewSimView.vue"),
    },
    {
      path: "/runs/:build",
      name: "run-detail",
      component: () => import("../views/RunDetailView.vue"),
      props: true,
    },
    {
      path: "/compare",
      name: "compare",
      component: () => import("../views/CompareView.vue"),
    },
  ],
});

export default router;
