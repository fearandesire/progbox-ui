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
      path: "/lab",
      name: "lab-new",
      component: () => import("../views/LabNewView.vue"),
    },
    {
      path: "/lab/scripts",
      name: "lab-scripts",
      component: () => import("../views/LabScriptsView.vue"),
    },
    {
      path: "/lab/history",
      name: "lab-history",
      component: () => import("../views/LabHistoryView.vue"),
    },
    {
      path: "/lab/runs/:id",
      name: "lab-run",
      component: () => import("../views/LabRunView.vue"),
    },
    {
      path: "/compare",
      name: "compare",
      component: () => import("../views/CompareView.vue"),
    },
  ],
});

export default router;
