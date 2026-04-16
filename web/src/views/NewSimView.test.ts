import { mount, RouterLinkStub } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { describe, expect, it } from "vitest";
import NewSimView from "./NewSimView.vue";

describe("NewSimView", () => {
  it("renders the form and back navigation", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }, { path: "/new", component: NewSimView }],
    });
    await router.push("/new");
    await router.isReady();

    const wrapper = mount(NewSimView, {
      global: {
        plugins: [router],
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });

    expect(wrapper.text()).toContain("New simulation");
    expect(wrapper.text()).toContain("Upload a BBGM export");
    expect(wrapper.text()).toContain("Start simulation");
  });
});
