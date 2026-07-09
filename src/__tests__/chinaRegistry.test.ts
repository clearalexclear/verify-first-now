import { afterEach, describe, expect, it, vi } from "vitest";
import { applyOutcomeGating, buildCanonicalChecklist, checklistResultsToFindings } from "../lib/investigation/checklist";
import { chinaRegistryRecordToFindings, retrieveChinaRegistryEvidence } from "../lib/investigation/sources/china-registry.server";
import { officialRegistryFieldsToFindings, OFFICIAL_BROWSER_ASSISTED_SOURCE } from "../lib/investigation/sources/official-browser-assisted.server";
import { openWebRegistryFindingsFromSources, validateUsccChecksum, type OpenWebRegistryEvidenceSource } from "../lib/investigation/sources/open-web-china-registry.server";
import { computeOutcome } from "../lib/investigation/synthesis.server";
import type { Finding, InvestigationReport, ResolvedEntity } from "../lib/investigation/types";

const baseResolvedEntity: ResolvedEntity = {
  matched: false,
  legal_name_en: null,
  legal_name_local: null,
  registration_number: null,
  registration_country: "China",
  registration_status: null,
  registration_date: null,
  registered_capital: null,
  registered_address: null,
  legal_representative: null,
  business_scope: null,
  shareholders: [],
  related_companies: [],
  manufacturer_indicators: [],
  trading_indicators: [],
  confidence: "low",
  sources: [],
  notes: "",
};

function input(overrides: any = {}) {
  return {
    statedName: "Jiangmen Changwen Trading Co., Ltd.",
    chineseName: "江门市长文贸易有限公司",
    country: "China",
    website: "https://changwen.example",
    resolved: baseResolvedEntity,
    extracted: [],
    ...overrides,
  };
}

function mockReport(findings: Finding[]): InvestigationReport {
  return {
    generated_at: "2026-07-07T00:00:00.000Z",
    order_reference: "VF-CN-001",
    case_reference: "CASE-CN-001",
    supplier_input: {
      name: "Jiangmen Changwen Trading Co., Ltd.",
      chinese_name: "江门市长文贸易有限公司",
      country: "China",
      url: "https://changwen.example",
      contact: "Ms Chen",
    },
    customer_input: {
      name: "Buyer",
      company: "Buyer Ltd",
      email: "buyer@example.test",
      destination_market: "United States",
      estimated_order_value: "50000",
      product_category: "cookware",
      concerns: null,
    },
    resolved_entity: baseResolvedEntity,
    findings,
    checklist_results: [],
    overall_risk_rating: "medium",
    final_outcome: "PROCEED_WITH_SAFEGUARDS",
    executive_summary: "",
    key_findings: [],
    buyer_implications: "",
    recommended_safeguards: "",
    payment_recommendation: "",
    inspection_recommendation: "",
    testing_recommendation: "",
    methodology: "",
    limitations: "",
    sources_used: [],
  };
}

function registryBody() {
  return {
    legalName: "江门市长文贸易有限公司",
    englishName: "Jiangmen Changwen Trading Co., Ltd.",
    uscc: "91440700MA4W123456",
    registrationStatus: "Active",
    incorporationDate: "2017-05-12",
    registeredCapital: "RMB 1,000,000",
    legalRepresentative: "Chen Wen",
    registeredAddress: "Jiangmen City, Guangdong",
    businessScope: "Wholesale and export of stainless steel kitchenware",
    shareholders: [{ name: "Chen Wen" }],
    relatedCompanies: [{ name: "Jiangmen Changwen Manufacturing Co., Ltd." }],
    litigation: ["Civil case record available"],
    administrativePenalties: ["Administrative penalty record available"],
  };
}

const validUscc = "91440700MA4W123452";

function publicSource(overrides: Partial<OpenWebRegistryEvidenceSource> = {}): OpenWebRegistryEvidenceSource {
  return {
    url: "https://example.com/profile/changwen",
    title: "Jiangmen Changwen company profile",
    snippet: "",
    markdown: [
      "江门市长文贸易有限公司",
      `统一社会信用代码: ${validUscc}`,
      "经营状态: 存续",
      "成立日期: 2017-05-12",
      "注册资本: 人民币100万元",
      "注册地址: 广东省江门市蓬江区示例路1号",
      "法定代表人: 陈文",
      "经营范围: 厨具和不锈钢制品销售及出口",
      "股东: 陈文",
      "关联企业: 江门市长文制造有限公司",
    ].join("\n"),
    kind: "indexed_registry",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("China registry providers", () => {
  it("retrieves QINCheck data when configured", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: registryBody() }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await retrieveChinaRegistryEvidence(input(), {
      CHINA_REGISTRY_ENABLED: "true",
      CHINA_REGISTRY_PROVIDER: "auto",
      QINCHECK_API_KEY: "qin_test",
    });

    expect(result.status).toBe("success");
    expect(result.provider).toBe("qincheck");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("https://qincheck.com/api/report?q="), expect.objectContaining({
      headers: expect.objectContaining({ "x-api-key": "qin_test" }),
    }));
    expect(result.findings.some((finding) => finding.item === "Unified Social Credit Code")).toBe(true);
    expect(result.fieldsReturned).toContain("legal_representative");
  });

  it("retrieves Panda360 data when selected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ uscc: "91440700MA4W123456", legalName: "江门市长文贸易有限公司" }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ company: registryBody() }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await retrieveChinaRegistryEvidence(input(), {
      CHINA_REGISTRY_ENABLED: "true",
      CHINA_REGISTRY_PROVIDER: "panda360",
      PANDA360_API_KEY: "panda_test",
    });

    expect(result.status).toBe("success");
    expect(result.provider).toBe("panda360");
    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringContaining("/wp-json/chinacheckup/v1/search"), expect.objectContaining({
      headers: expect.objectContaining({ "X-API-Key": "panda_test" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining("/wp-json/chinacheckup/v1/getFull?uscc=91440700MA4W123456"), expect.any(Object));
  });

  it("returns not_configured when a selected API provider key is missing", async () => {
    const result = await retrieveChinaRegistryEvidence(input(), {
      CHINA_REGISTRY_ENABLED: "true",
      CHINA_REGISTRY_PROVIDER: "qincheck",
    });

    expect(result.status).toBe("not_configured");
    expect(result.findings).toHaveLength(0);
  });

  it("returns a pending official-browser-assisted task outcome when auto providers are not configured", async () => {
    const result = await retrieveChinaRegistryEvidence(input(), {
      CHINA_REGISTRY_ENABLED: "true",
      CHINA_REGISTRY_PROVIDER: "auto",
    });

    expect(result.status).toBe("pending_admin");
    expect(result.provider).toBe("official_browser_assisted");
    expect(result.sourceName).toBe(OFFICIAL_BROWSER_ASSISTED_SOURCE);
    expect(result.findings).toHaveLength(0);
  });

  it("returns ambiguous for multiple weak Panda360 matches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      { uscc: "914400000000000001", legalName: "Different Company A" },
      { uscc: "914400000000000002", legalName: "Different Company B" },
    ]), { status: 200 })));

    const result = await retrieveChinaRegistryEvidence(input(), {
      CHINA_REGISTRY_ENABLED: "true",
      CHINA_REGISTRY_PROVIDER: "panda360",
      PANDA360_API_KEY: "panda_test",
    });

    expect(result.status).toBe("ambiguous");
    expect(result.findings).toHaveLength(0);
  });

  it("returns error on API failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "down" }), { status: 503 })));

    const result = await retrieveChinaRegistryEvidence(input(), {
      CHINA_REGISTRY_ENABLED: "true",
      CHINA_REGISTRY_PROVIDER: "qincheck",
      QINCHECK_API_KEY: "qin_test",
    });

    expect(result.status).toBe("error");
    expect(result.error).toMatch(/HTTP 503/);
  });

  it("maps supported registry fields to evidence findings only", () => {
    const findings = chinaRegistryRecordToFindings({
      provider: "qincheck",
      sourceName: "QINCheck China registry",
      sourceUrl: "https://qincheck.com/api/report?q=91440700MA4W123456",
      raw: {},
      legalNameEn: "Jiangmen Changwen Trading Co., Ltd.",
      legalNameLocal: "江门市长文贸易有限公司",
      uscc: "91440700MA4W123456",
      registrationStatus: "Active",
      incorporationDate: "2017-05-12",
      registeredCapital: "RMB 1,000,000",
      legalRepresentative: "Chen Wen",
      registeredAddress: "Jiangmen City, Guangdong",
      businessScope: "Kitchenware export",
      shareholders: ["Chen Wen"],
      relatedCompanies: ["Related Co."],
      litigation: ["Civil case"],
      enforcement: ["Penalty"],
      riskFlags: [],
    }, "2026-07-07T00:00:00.000Z").map((finding, index) => ({ ...finding, evidence_ids: [`ev_${index}`] }));

    expect(findings.map((finding) => finding.item)).toEqual(expect.arrayContaining([
      "Legal company existence",
      "Chinese legal name",
      "Unified Social Credit Code",
      "Registration status",
      "Incorporation date",
      "Registered capital",
      "Legal representative",
      "Registered address",
      "Business scope",
      "Shareholders and beneficial ownership",
      "Related companies",
      "Litigation and enforcement screening",
      "Enforcement and administrative penalties",
    ]));
  });

  it("allowlists registry evidence into registry checklist items", () => {
    const result = buildCanonicalChecklist(mockReport([
      {
        section: "legal_entity",
        item: "Unified Social Credit Code",
        status: "PASS",
        confidence: "high",
        source_name: "QINCheck China registry",
        source_url: "https://qincheck.com/api/report",
        retrieval_date: "2026-07-07T00:00:00.000Z",
        evidence_excerpt: "Unified Social Credit Code: 91440700MA4W123456",
        evidence_ids: ["ev_uscc"],
        evidence_classification: "VERIFIED",
        buyer_impact: "Registry fact.",
        recommended_action: "Keep evidence.",
      },
    ]));

    expect(result.find((item) => item.id === "unified_social_credit_code")?.status).toBe("PASS");
    expect(result.find((item) => item.id === "unified_social_credit_code")?.evidence_classification).toBe("VERIFIED");
  });

  it("does not map registry evidence to sanctions, certificates, shipments, recalls or factory assessment", () => {
    const result = buildCanonicalChecklist(mockReport([
      {
        section: "legal_entity",
        item: "Unified Social Credit Code",
        status: "PASS",
        confidence: "high",
        source_name: "Panda360 China registry",
        source_url: "https://www.chinacheckup.com/wp-json/chinacheckup/v1/getFull",
        retrieval_date: "2026-07-07T00:00:00.000Z",
        evidence_excerpt: "Unified Social Credit Code: 91440700MA4W123456",
        evidence_ids: ["ev_uscc"],
        evidence_classification: "VERIFIED",
        buyer_impact: "Registry fact.",
        recommended_action: "Keep evidence.",
      },
    ]));

    for (const id of [
      "sanctions_restricted_party",
      "uflpa_forced_labour",
      "us_shipment_export_history",
      "certificate_authenticity",
      "product_certificates_test_reports",
      "product_recall_history",
      "factory_vs_trader",
    ]) {
      expect(result.find((item) => item.id === id)?.status).toBe("NOT_VERIFIED");
    }
  });

  it("maps admin-confirmed official registry evidence to registry checklist items only", () => {
    const findings = officialRegistryFieldsToFindings({
      sourceName: "National Enterprise Credit Information Publicity System",
      sourceUrl: "https://www.gsxt.gov.cn/",
      retrievalDate: "2026-07-08T00:00:00.000Z",
      citation: null,
      attachmentPaths: ["official-registry/case/screenshot.png"],
      chineseLegalName: "江门市长文贸易有限公司",
      englishName: "Jiangmen Changwen Trading Co., Ltd.",
      uscc: "91440700MA4W123456",
      registrationStatus: "Active",
      incorporationDate: "2017-05-12",
      registeredCapital: "RMB 1,000,000",
      registeredAddress: "Jiangmen City, Guangdong",
      legalRepresentative: "Chen Wen",
      businessScope: "Kitchenware export",
      shareholdersOwnership: "Chen Wen",
      relatedCompanies: "Related Co.",
      litigationEnforcementPenalties: "Administrative penalty record available",
      abnormalOperationRecords: "No current abnormal operation record shown",
      businessLicenceMatchesOfficial: true,
    }).map((finding, index) => ({ ...finding, evidence_ids: [`official_${index}`] }));
    const result = buildCanonicalChecklist(mockReport(findings));

    expect(result.find((item) => item.id === "legal_company_existence")?.status).toBe("PASS");
    expect(result.find((item) => item.id === "unified_social_credit_code")?.evidence_classification).toBe("VERIFIED");
    expect(result.find((item) => item.id === "business_licence_validation")?.status).toBe("PASS");
    for (const id of ["sanctions_restricted_party", "uflpa_forced_labour", "us_shipment_export_history", "certificate_authenticity", "product_recall_history", "factory_vs_trader"]) {
      expect(result.find((item) => item.id === id)?.status).toBe("NOT_VERIFIED");
    }
  });

  it("does not allow official browser-assisted evidence without citation or attachment to become VERIFIED", () => {
    const findings = officialRegistryFieldsToFindings({
      sourceName: "Official source",
      sourceUrl: null,
      retrievalDate: "2026-07-08T00:00:00.000Z",
      citation: null,
      attachmentPaths: [],
      chineseLegalName: "江门市长文贸易有限公司",
      englishName: null,
      uscc: "91440700MA4W123456",
      registrationStatus: null,
      incorporationDate: null,
      registeredCapital: null,
      registeredAddress: null,
      legalRepresentative: null,
      businessScope: null,
      shareholdersOwnership: null,
      relatedCompanies: null,
      litigationEnforcementPenalties: null,
      abnormalOperationRecords: null,
      businessLicenceMatchesOfficial: false,
    }).map((finding, index) => ({ ...finding, evidence_ids: [`official_missing_${index}`] }));
    const result = buildCanonicalChecklist(mockReport(findings));

    expect(result.find((item) => item.id === "legal_company_existence")?.status).toBe("NOT_VERIFIED");
    expect(result.find((item) => item.id === "unified_social_credit_code")?.evidence_classification).toBe("NOT_INDEPENDENTLY_VERIFIED");
  });

  it("keeps the report paused when critical registry evidence is not confirmed", () => {
    const findings = officialRegistryFieldsToFindings({
      sourceName: "Official source",
      sourceUrl: null,
      retrievalDate: "2026-07-08T00:00:00.000Z",
      citation: null,
      attachmentPaths: [],
      chineseLegalName: "江门市长文贸易有限公司",
      englishName: null,
      uscc: "91440700MA4W123456",
      registrationStatus: "Active",
      incorporationDate: null,
      registeredCapital: null,
      registeredAddress: null,
      legalRepresentative: null,
      businessScope: null,
      shareholdersOwnership: null,
      relatedCompanies: null,
      litigationEnforcementPenalties: null,
      abnormalOperationRecords: null,
      businessLicenceMatchesOfficial: true,
    }).map((finding, index) => ({ ...finding, evidence_ids: [`official_unconfirmed_${index}`] }));
    const checklist = buildCanonicalChecklist(mockReport(findings));
    const outcome = applyOutcomeGating(computeOutcome(checklistResultsToFindings(checklist)), checklist);

    expect(outcome.outcome).toBe("PAUSE_PENDING_CLARIFICATION");
    expect(outcome.blockers).toContain("Legal company existence is not independently verified.");
  });

  it("finds USCC from a public-source fixture", () => {
    const result = openWebRegistryFindingsFromSources([publicSource()]);

    expect(result.findings.find((finding) => finding.item === "Unified Social Credit Code")?.evidence_excerpt).toContain(validUscc);
    expect(result.fieldsReturned).toContain("Unified Social Credit Code");
  });

  it("rejects invalid USCC with caution", () => {
    expect(validateUsccChecksum(validUscc)).toBe(true);
    expect(validateUsccChecksum("91440700MA4W123456")).toBe(false);

    const result = openWebRegistryFindingsFromSources([
      publicSource({ markdown: publicSource().markdown.replace(validUscc, "91440700MA4W123456") }),
    ]);
    const uscc = result.findings.find((finding) => finding.item === "Unified Social Credit Code");

    expect(uscc?.status).toBe("CAUTION");
    expect(uscc?.evidence_classification).toBe("CONTRADICTED");
    expect(uscc?.evidence_excerpt).toMatch(/checksum/);
  });

  it("classifies multi-source open-web match as CORROBORATED", () => {
    const result = openWebRegistryFindingsFromSources([
      publicSource({ url: "https://www.qcc.com/firm/changwen", kind: "indexed_registry", title: "QCC public profile" }),
      publicSource({ url: "https://aiqicha.baidu.com/company_detail/changwen", kind: "indexed_registry", title: "Aiqicha public profile" }),
    ]);
    const uscc = result.findings.find((finding) => finding.item === "Unified Social Credit Code");

    expect(uscc?.status).toBe("PASS");
    expect(uscc?.evidence_classification).toBe("CORROBORATED");
  });

  it("classifies official-source open-web fixture as VERIFIED", () => {
    const result = openWebRegistryFindingsFromSources([
      publicSource({
        url: "https://www.gsxt.gov.cn/corp-query-entprise-info-91440700MA4W123452.html",
        title: "National Enterprise Credit Information Publicity System",
        kind: "official",
      }),
    ]);
    const uscc = result.findings.find((finding) => finding.item === "Unified Social Credit Code");
    const checklist = buildCanonicalChecklist(mockReport(result.findings.map((finding, index) => ({ ...finding, evidence_ids: [`open_official_${index}`] }))));

    expect(uscc?.evidence_classification).toBe("VERIFIED");
    expect(checklist.find((item) => item.id === "unified_social_credit_code")?.evidence_classification).toBe("VERIFIED");
  });

  it("classifies single weak open-web source as NOT_INDEPENDENTLY_VERIFIED", () => {
    const result = openWebRegistryFindingsFromSources([
      publicSource({ url: "https://www.tianyancha.com/company/changwen", kind: "indexed_registry" }),
    ]);
    const checklist = buildCanonicalChecklist(mockReport(result.findings.map((finding, index) => ({ ...finding, evidence_ids: [`open_weak_${index}`] }))));

    expect(result.findings.find((finding) => finding.item === "Unified Social Credit Code")?.evidence_classification).toBe("NOT_INDEPENDENTLY_VERIFIED");
    expect(checklist.find((item) => item.id === "unified_social_credit_code")?.status).toBe("NOT_VERIFIED");
  });

  it("conflicting open-web sources create CAUTION", () => {
    const result = openWebRegistryFindingsFromSources([
      publicSource(),
      publicSource({
        url: "https://example.org/other",
        markdown: publicSource().markdown.replace(validUscc, "91440700MA4W123456"),
      }),
    ]);
    const uscc = result.findings.find((finding) => finding.item === "Unified Social Credit Code");

    expect(result.status).toBe("conflict");
    expect(uscc?.status).toBe("CAUTION");
    expect(uscc?.evidence_classification).toBe("CONTRADICTED");
  });

  it("does not map open-web registry evidence to sanctions, certificates, shipments or UFLPA", () => {
    const result = openWebRegistryFindingsFromSources([
      publicSource(),
      publicSource({ url: "https://www.alibaba.com/supplier/changwen", kind: "marketplace" }),
    ]);
    const checklist = buildCanonicalChecklist(mockReport(result.findings.map((finding, index) => ({ ...finding, evidence_ids: [`open_map_${index}`] }))));

    for (const id of ["sanctions_restricted_party", "uflpa_forced_labour", "us_shipment_export_history", "certificate_authenticity", "product_recall_history", "factory_vs_trader"]) {
      expect(checklist.find((item) => item.id === id)?.status).toBe("NOT_VERIFIED");
    }
  });

  it("rejects unrelated Jiangmen open-web boilerplate entity and invalid USCC as supplier identity", () => {
    const result = openWebRegistryFindingsFromSources([
      {
        url: "https://example.gov.cn/help/industry-boilerplate",
        title: "工商信息查询帮助",
        snippet: "江门企业工商信息查询说明",
        kind: "official",
        markdown: [
          "主管单位：中国工商出版社有限公司",
          "统一社会信用代码: c7de186521b9b6a986",
          "法定代表人: 张三",
          "注册资本: 1000万元",
          "经营状态: 存续",
          "经营范围: 出版物出版",
        ].join("\n"),
      },
    ], "2026-07-09T00:00:00.000Z", input({
      statedName: "Jiangmen Changwen Trading Co., Ltd.",
      chineseName: "江门市长文贸易有限公司",
      website: "https://changwen.example",
    }));
    const checklist = buildCanonicalChecklist(mockReport(result.findings.map((finding, index) => ({ ...finding, evidence_ids: [`jiangmen_redflag_${index}`] }))));

    expect(result.findings.some((finding) => finding.item === "Chinese legal name" && finding.evidence_excerpt.includes("中国工商出版社有限公司"))).toBe(false);
    expect(result.findings.some((finding) => finding.item === "Unified Social Credit Code" && /c7de186521b9b6a986/i.test(finding.evidence_excerpt))).toBe(false);
    expect(result.resolvedPatch).toBeNull();
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        item: "Red flags and contradictions",
        status: "CAUTION",
        evidence_excerpt: expect.stringContaining("Unrelated registry entity detected in search results; not accepted as supplier identity."),
      }),
    ]));
    expect(checklist.find((item) => item.id === "legal_company_existence")?.status).toBe("NOT_VERIFIED");
    expect(checklist.find((item) => item.id === "chinese_legal_name")?.status).toBe("NOT_VERIFIED");
    expect(checklist.find((item) => item.id === "unified_social_credit_code")?.status).toBe("NOT_VERIFIED");
  });
});
