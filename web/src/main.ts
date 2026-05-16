import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import { initTheme } from "./composables/useTheme";
import router from "./router";
import "./style.css";

initTheme();

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");
