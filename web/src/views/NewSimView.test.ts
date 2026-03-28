import { mount, RouterLinkStub } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import NewSimView from "./NewSimView.vue";

describe("NewSimView", () => {
  it("renders the placeholder content and back navigation", () => {
    const wrapper = mount(NewSimView, {
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });

    expect(wrapper.text()).toContain("New simulation");
    expect(wrapper.text()).toContain("Upload, configure, and launch");
  });
});
