import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import VersionChip from "./VersionChip.vue";

describe("VersionChip", () => {
  it.each([
    {
      version: "v3.2.1",
      label: "NET 3.2",
      chipClass: "v3-2-1",
      title: "Published script: live NET 3.2",
    },
    {
      version: "v321",
      label: "NET 3.2",
      chipClass: "v3-2-1",
      title: "Published script: live NET 3.2",
    },
    {
      version: "v3.2.1, current progression script",
      label: "NET 3.2",
      chipClass: "v3-2-1",
      title: "Published script: live NET 3.2",
    },
    {
      version: "v4.3",
      label: "v4.3",
      chipClass: "v4-3",
      title: "Candidate script: v4.3",
    },
    {
      version: "v43",
      label: "v4.3",
      chipClass: "v4-3",
      title: "Candidate script: v4.3",
    },
    {
      version: "v4.3.2",
      label: "v4.3.2",
      chipClass: "other",
      title: "Progression script: v4.3.2",
    },
    {
      version: "v4.1",
      label: "v4.1",
      chipClass: "v4-1",
      title: "Legacy script: v4.1",
    },
    {
      version: "v41",
      label: "v4.1",
      chipClass: "v4-1",
      title: "Legacy script: v4.1",
    },
    {
      version: null,
      label: "—",
      chipClass: "other",
      title: "Progression script: —",
    },
  ] as const)("maps $version to label and chip class", ({ version, label, chipClass, title }) => {
    const wrapper = mount(VersionChip, { props: { version } });
    expect(wrapper.text()).toBe(label);
    expect(wrapper.classes()).toContain(`version-chip--${chipClass}`);
    expect(wrapper.attributes("title")).toBe(title);
  });

  it("uses a recognized script version after an unknown requested version", () => {
    const wrapper = mount(VersionChip, {
      props: { version: "foo321", scriptVersion: "v321" },
    });
    expect(wrapper.text()).toBe("NET 3.2");
    expect(wrapper.classes()).toContain("version-chip--v3-2-1");
  });
});
