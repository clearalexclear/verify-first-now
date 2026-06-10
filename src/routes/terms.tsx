import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms of Service — VerifyFirst" }] }),
  component: () => (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-bold text-navy">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {new Date().toLocaleDateString()}</p>
        <div className="prose prose-sm mt-8 max-w-none text-foreground">
          <p>
            VerifyFirst provides desk-based supplier verification reports based on
            publicly available registry data, customs records, certification body
            checks and open-source intelligence. Reports are advisory and do not
            constitute a guarantee of supplier performance. The client is responsible
            for final commercial decisions.
          </p>
          <p>
            VerifyFirst accepts no payment, commission or referral fee from
            suppliers, factories or sourcing agents.
          </p>
          <p className="text-xs text-muted-foreground">
            This is a placeholder agreement. Replace with your final legal text before launch.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  ),
});
