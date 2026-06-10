import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy Policy — VerifyFirst" }] }),
  component: () => (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <h1 className="text-3xl font-bold text-navy">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {new Date().toLocaleDateString()}</p>
        <div className="prose prose-sm mt-8 max-w-none text-foreground">
          <p>
            VerifyFirst collects only the information you submit through the order form
            (your name, email, company, and the supplier details you provide) for the
            sole purpose of producing your verification report and contacting you about
            it. We do not sell or share this information with third parties.
          </p>
          <p>
            For questions, email <a href="mailto:hello@verifyfirst.co">hello@verifyfirst.co</a>.
          </p>
          <p className="text-xs text-muted-foreground">
            This is a placeholder policy. Replace with your final legal text before launch.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  ),
});
