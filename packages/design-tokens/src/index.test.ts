import { describe, expect, it } from "vitest";

import { dentLinkBrand, dentLinkColors, dentLinkWidgetTokens, designTokensPackage } from "./index";

describe("@dentlink/design-tokens", () => {
  it("declares the design-tokens package boundary", () => {
    expect(designTokensPackage.name).toBe("@dentlink/design-tokens");
  });

  it("exports the DentLink brand contract for platform clients", () => {
    expect(dentLinkBrand.name).toBe("DentLink");
    expect(dentLinkBrand.logos.standard).toBe("/icons/DentLink.png");
    expect(dentLinkBrand.logos.dark).toBe("/icons/DentLinkDark.png");
    expect(dentLinkBrand.fontFamily).toContain("Inter");
  });

  it("keeps widget tokens aligned with the web palette", () => {
    expect(dentLinkWidgetTokens.colors.sourceGmail).toBe(dentLinkColors.sourceGmail);
    expect(dentLinkWidgetTokens.colors.appBg).toBe("#0c0f14");
    expect(dentLinkWidgetTokens.colors.surfaceBg).toBe("#141b24");
    expect(dentLinkWidgetTokens.colors.accent).toBe("#7c3aed");
    expect(dentLinkWidgetTokens.radius.card).toBe(4);
  });
});
