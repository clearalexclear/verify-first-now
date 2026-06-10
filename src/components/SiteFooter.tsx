import { Link } from "@tanstack/react-router";
import { Logo } from "./Logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <Logo />
            <p className="mt-3 text-sm text-muted-foreground">Independent supplier verification.</p>
            <p className="mt-2 text-sm text-muted-foreground">hello@verifyfirst.co</p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground">Service</h4>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li><Link to="/" hash="pricing" className="hover:text-foreground">Pricing</Link></li>
              <li><Link to="/sample-report" className="hover:text-foreground">Sample report</Link></li>
              <li><Link to="/" hash="faq" className="hover:text-foreground">FAQ</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground">Legal</h4>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li><Link to="/privacy" className="hover:text-foreground">Privacy Policy</Link></li>
              <li><Link to="/terms" className="hover:text-foreground">Terms of Service</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-10 border-t border-border pt-6">
          <p className="text-xs text-muted-foreground">
            We accept no payments, commissions or referrals from suppliers. Ever.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">© {new Date().getFullYear()} VerifyFirst. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
