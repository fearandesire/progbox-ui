import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import VersionChip from "./VersionChip.vue";

describe("VersionChip", () => {
  it.each([
    {
      version: "v321",
      label: "NET 3.2",
      kind: "v321",
      title: "Published script: live NET 3.2",
    },
    {
      version: "v3.2.1, current progression script",
      label: "NET 3.2",
      kind: "v321",
      title: "Published script: live NET 3.2",
    },
    {
      version: "v43",
      label: "v4.3",
      kind: "v43",
      title: "Candidate script: v4.3",
    },
    {
      version: "v4.3",
      label: "v4.3",
      kind: "v43",
      title: "Candidate script: v4.3",
    },
    {
      version: "v4.3.2",
      label: "v4.3",
      kind: "v43",
      title: "Candidate script: v4.3",
    },
    {
      version: "v41",
      label: "v4.1",
      kind: "v41",
      title: "Legacy script: v4.1",
    },
    {
      version: null,
      label: "—",
      kind: "other",
      title: "Progression script: —",
    },
  ] as const)("maps $version to label and kind", ({ version, label, kind, title }) => {
    const wrapper = mount(VersionChip, { props: { version } });
    expect(wrapper.text()).toBe(label);
    expect(wrapper.classes()).toContain(`version-chip--${kind}`);
    expect(wrapper.attributes("title")).toBe(title);
  });
});
