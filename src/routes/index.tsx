import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import {
  ShieldCheck,
  FileSearch,
  Factory,
  AlertTriangle,
  Check,
  ArrowRight,
  Send,
  Search,
  CheckCircle2,
  FileText,
  Scale,
  Award,
  Flag,
  Building2,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VerifyFirst — Independent supplier verification for China & Vietnam" },
      {
        name: "description",
        content:
          "Independent verification reports on Chinese and Vietnamese suppliers. We work for you — never paid by the factory. 72-hour delivery.",
      },
      { property: "og:title", content: "VerifyFirst — Know your supplier before you wire the money" },
      {
        property: "og:description",
        content:
          "Independent supplier verification reports for importers and Amazon sellers buying from China and Vietnam.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <Hero />
      <TrustBar />
      <Problem />
      <WhatWeCheck />
      <Pricing />
      <HowItWorks />
      <WhoFor />
      <FAQ />
      <CTA />
      <SiteFooter />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-success" />
            Independent · Buyer-paid only · No supplier kickbacks
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-navy sm:text-5xl md:text-6xl">
            Know your supplier before you wire the money.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-muted-foreground sm:text-xl">
            Independent verification reports on Chinese and Vietnamese suppliers. We work for you — never paid by the factory. Report delivered in 72 hours.
          </p>
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button
              asChild
              size="lg"
              className="h-14 bg-navy px-8 text-base font-semibold text-navy-foreground hover:bg-navy/90"
            >
              <Link to="/demo">
                Run instant risk scan — €49 <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-14 border-navy/30 px-8 text-base font-semibold text-navy hover:bg-navy/5"
            >
              <Link to="/verified-report">
                Get verified report — €490
              </Link>
            </Button>
          </div>
          <Link to="/sample-report" className="mt-4 inline-block text-sm font-medium text-navy underline-offset-4 hover:underline">
            See a sample report →
          </Link>

        </div>
      </div>
    </section>
  );
}

function TrustBar() {
  return (
    <section className="border-b border-border bg-muted/40">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        <p className="text-center text-xs font-medium tracking-wide text-muted-foreground sm:text-sm">
          Built by trade inspection industry insiders · 20+ years TIC industry expertise · Independent by design
        </p>
      </div>
    </section>
  );
}

function Problem() {
  const cards = [
    {
      icon: Building2,
      title: "Trading companies posing as factories",
      body: "Most 'manufacturers' you find online are middlemen adding 15-30% margin.",
    },
    {
      icon: FileText,
      title: "Photoshopped certificates",
      body: "Fake CE, FDA and BSCI certificates are widespread and easy to forge.",
    },
    {
      icon: AlertTriangle,
      title: "No real export history",
      body: "A polished website tells you nothing about whether they've ever shipped your product category at volume.",
    },
  ];
  return (
    <section className="border-b border-border py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-navy sm:text-4xl">
            Alibaba verification is paid for by the supplier. Ours isn't.
          </h2>
        </div>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {cards.map((c) => (
            <div key={c.title} className="rounded-xl border border-border bg-card p-6">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-muted text-navy">
                <c.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-5 text-lg font-semibold text-foreground">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhatWeCheck() {
  const items = [
    {
      icon: Scale,
      title: "Legal entity verification",
      body: "Chinese/Vietnamese corporate registry: registered capital, business scope, legal disputes, ownership.",
    },
    {
      icon: Factory,
      title: "Factory vs. trading company determination",
      body: "Are they actually making the product, or marking it up?",
    },
    {
      icon: FileSearch,
      title: "Export history analysis",
      body: "Customs shipment records: volumes, destinations, product categories.",
    },
    {
      icon: Award,
      title: "Certification authenticity check",
      body: "CE, FDA, ISO, BSCI and others verified against issuing bodies.",
    },
    {
      icon: Flag,
      title: "Red flag screening",
      body: "Sanctions lists, court records, blacklists.",
    },
    {
      icon: CheckCircle2,
      title: "Clear risk rating",
      body: "GO / CAUTION / NO-GO recommendation with reasoning.",
    },
  ];
  return (
    <section id="what" className="border-b border-border bg-muted/30 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-navy sm:text-4xl">What we check</h2>
          <p className="mt-4 text-muted-foreground">
            Every report covers six independent verification areas.
          </p>
        </div>
        <div className="mt-14 grid gap-x-10 gap-y-6 md:grid-cols-2">
          {items.map((it) => (
            <div key={it.title} className="flex gap-4 rounded-lg border border-border bg-card p-5">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md bg-success/10 text-success">
                <it.icon className="h-5 w-5" />
              </span>
              <div>
                <h3 className="font-semibold text-foreground">{it.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{it.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const TIERS = [
  {
    id: "standard" as const,
    name: "Standard",
    price: "€490",
    delivery: "72-hour delivery",
    features: [
      "Full desk verification report",
      "Legal entity & business scope",
      "Export history analysis",
      "Certification authenticity",
      "Red flag screening",
      "GO / CAUTION / NO-GO rating",
    ],
    cta: "Order Standard",
  },
  {
    id: "priority" as const,
    name: "Priority",
    price: "€690",
    delivery: "24-hour delivery",
    features: [
      "Everything in Standard",
      "24-hour delivery",
      "30-minute debrief call with analyst",
      "Priority email support",
    ],
    cta: "Order Priority",
    highlighted: true,
  },
  {
    id: "onsite" as const,
    name: "On-Site",
    price: "€1,290",
    delivery: "7-day delivery",
    features: [
      "Everything in Priority",
      "Physical factory visit (China & Vietnam)",
      "Photo & video evidence",
      "Local inspector on the ground",
    ],
    cta: "Order On-Site",
  },
];

function Pricing() {
  return (
    <section id="pricing" className="border-b border-border py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-navy sm:text-4xl">Pricing</h2>
          <p className="mt-4 text-muted-foreground">
            One supplier, one flat fee. No subscriptions, no surprises.
          </p>
        </div>
        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.id}
              className={`relative flex flex-col rounded-2xl border bg-card p-8 ${
                t.highlighted
                  ? "border-navy shadow-xl ring-1 ring-navy/10 lg:-translate-y-3"
                  : "border-border"
              }`}
            >
              {t.highlighted && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-navy px-3 py-1 text-xs font-semibold uppercase tracking-wide text-navy-foreground">
                  Most popular
                </span>
              )}
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t.name}</h3>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="text-4xl font-bold text-navy">{t.price}</span>
              </div>
              <p className="mt-1 text-sm font-medium text-success">{t.delivery}</p>
              <ul className="mt-6 space-y-3 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                asChild
                className={`mt-8 w-full ${
                  t.highlighted
                    ? "bg-navy text-navy-foreground hover:bg-navy/90"
                    : "bg-foreground text-background hover:bg-foreground/90"
                }`}
                size="lg"
              >
                <Link to="/order" search={{ tier: t.id }}>{t.cta}</Link>
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      icon: Send,
      title: "Send us the supplier",
      body: "Submit the company name, website or Alibaba listing.",
    },
    {
      icon: Search,
      title: "We investigate",
      body: "Registry records, export data, certifications, red flags.",
    },
    {
      icon: CheckCircle2,
      title: "You decide with confidence",
      body: "Clear report with a risk rating, before any money moves.",
    },
  ];
  return (
    <section id="how" className="border-b border-border bg-muted/30 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-navy sm:text-4xl">How it works</h2>
        </div>
        <div className="mt-14 grid gap-8 md:grid-cols-3">
          {steps.map((s, i) => (
            <div key={s.title} className="relative rounded-xl border border-border bg-card p-7">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-navy text-sm font-bold text-navy-foreground">
                  {i + 1}
                </span>
                <s.icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-foreground">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhoFor() {
  return (
    <section className="border-b border-border py-16">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
        <p className="text-lg leading-relaxed text-foreground sm:text-xl">
          For{" "}
          <span className="font-semibold text-navy">Amazon FBA sellers</span>,{" "}
          <span className="font-semibold text-navy">e-commerce brands</span>, and{" "}
          <span className="font-semibold text-navy">SMB importers</span> placing orders from €10,000 to €500,000.
        </p>
      </div>
    </section>
  );
}

function FAQ() {
  const faqs = [
    {
      q: "Why not just trust Alibaba Gold Supplier status?",
      a: "Suppliers pay Alibaba for that badge. It's advertising. We're paid only by you.",
    },
    {
      q: "What if the supplier turns out to be bad?",
      a: "That's a successful outcome — you just saved your order. Our NO-GO reports save clients an average of 50x the report fee.",
    },
    {
      q: "Do you cover countries besides China and Vietnam?",
      a: "Currently China and Vietnam. India and Indonesia coming soon.",
    },
    {
      q: "Is this a factory audit?",
      a: "Standard and Priority are desk-based due diligence. The On-Site tier includes a physical visit.",
    },
    {
      q: "How is this different from hiring an inspection company?",
      a: "Traditional inspection firms are built for enterprise contracts. We bring the same independence standard at a price that makes sense for a single order.",
    },
  ];
  return (
    <section id="faq" className="border-b border-border bg-muted/30 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight text-navy sm:text-4xl">
          Frequently asked questions
        </h2>
        <Accordion type="single" collapsible className="mt-10">
          {faqs.map((f, i) => (
            <AccordionItem key={i} value={`item-${i}`} className="border-border">
              <AccordionTrigger className="text-left text-base font-semibold text-foreground hover:no-underline">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="bg-navy py-20 text-navy-foreground">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Verify your supplier before you wire the deposit.
        </h2>
        <p className="mt-4 text-base text-navy-foreground/80">
          Independent. 72 hours. €490.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button
            asChild
            size="lg"
            className="h-12 bg-success px-8 text-base font-semibold text-success-foreground hover:bg-success/90"
          >
            <Link to="/order" search={{ tier: "standard" }}>Verify a Supplier — €490</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-12 border-navy-foreground/30 bg-transparent px-8 text-base text-navy-foreground hover:bg-navy-foreground/10 hover:text-navy-foreground"
          >
            <Link to="/sample-report">See a sample report</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
