import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Logo } from "./Logo";
import { supabase } from "@/integrations/supabase/client";

export function SiteHeader() {
  const [isStaff, setIsStaff] = useState(false);

  useEffect(() => {
    let active = true;
    async function check(userId: string | undefined) {
      if (!userId) { if (active) setIsStaff(false); return; }
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      const roles = (data ?? []).map((r: any) => r.role);
      if (active) setIsStaff(roles.includes("admin") || roles.includes("analyst"));
    }
    supabase.auth.getUser().then(({ data }) => check(data.user?.id));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      check(session?.user?.id);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
          <Link to="/" hash="pricing" className="hover:text-foreground">Pricing</Link>
          <Link to="/" hash="how" className="hover:text-foreground">How it works</Link>
          <Link to="/sample-report" className="hover:text-foreground">Sample report</Link>
          <Link to="/" hash="faq" className="hover:text-foreground">FAQ</Link>
          {isStaff && (
            <Link to="/admin" className="text-foreground hover:text-primary">Admin</Link>
          )}
        </nav>
        <Button asChild size="sm" className="bg-navy text-navy-foreground hover:bg-navy/90">
          <Link to="/order" search={{ tier: "standard" }}>Verify a supplier</Link>
        </Button>
      </div>
    </header>
  );
}
