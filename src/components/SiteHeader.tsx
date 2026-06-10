import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Logo } from "./Logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
          <Link to="/" hash="pricing" className="hover:text-foreground">Pricing</Link>
          <Link to="/" hash="how" className="hover:text-foreground">How it works</Link>
          <Link to="/sample-report" className="hover:text-foreground">Sample report</Link>
          <Link to="/" hash="faq" className="hover:text-foreground">FAQ</Link>
        </nav>
        <Button asChild size="sm" className="bg-navy text-navy-foreground hover:bg-navy/90">
          <Link to="/order" search={{ tier: "standard" }}>Verify a supplier</Link>
        </Button>
      </div>
    </header>
  );
}
