import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMyAccess, claimFirstAdmin } from "@/lib/admin/admin.functions";
import { Button } from "@/components/ui/button";
import { Shield, LayoutDashboard, FileText, Users, ListChecks, LogOut, Activity } from "lucide-react";

export function AdminShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const fetchAccess = useServerFn(getMyAccess);
  const claim = useServerFn(claimFirstAdmin);

  const accessQ = useQuery({
    queryKey: ["my-access"],
    queryFn: () => fetchAccess(),
    staleTime: 30_000,
  });

  // Auto-claim first admin if no admin exists yet
  useEffect(() => {
    if (accessQ.data && !accessQ.data.isStaff) {
      claim().then((r: any) => {
        if (r?.ok) accessQ.refetch();
      }).catch(() => {});
    }
  }, [accessQ.data]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const access = accessQ.data;

  if (accessQ.isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (access && !access.isStaff) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-4">
          <div className="mx-auto h-10 w-10 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center">
            <Shield className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold">No staff access</h1>
          <p className="text-sm text-muted-foreground">
            Your account ({access.email}) does not have a staff role yet. Ask an administrator to grant
            you the analyst or admin role.
          </p>
          <Button variant="outline" onClick={signOut}>Sign out</Button>
        </div>
      </div>
    );
  }

  const nav = [
    { to: "/admin", label: "Cases", icon: LayoutDashboard, exact: true },
    { to: "/admin/templates", label: "Templates", icon: ListChecks, adminOnly: false },
    { to: "/admin/integration-diagnostics", label: "Diagnostics", icon: Activity, adminOnly: true },
    { to: "/admin/users", label: "Users", icon: Users, adminOnly: true },
  ];

  return (
    <div className="min-h-screen flex bg-muted/20">
      <aside className="w-60 border-r bg-card flex flex-col">
        <div className="h-14 flex items-center gap-2 px-4 border-b">
          <div className="h-7 w-7 rounded bg-primary text-primary-foreground flex items-center justify-center">
            <Shield className="h-4 w-4" />
          </div>
          <div className="text-sm font-semibold tracking-tight">VerifyFirst Console</div>
        </div>
        <nav className="p-2 space-y-0.5 flex-1">
          {nav.filter(n => !n.adminOnly || access?.isAdmin).map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <Link key={item.to} to={item.to}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
                }`}>
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t space-y-2">
          <div className="text-xs text-muted-foreground truncate" title={access?.email ?? ""}>
            {access?.email}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {access?.roles.join(" · ") || "staff"}
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={signOut}>
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        {children}
      </main>
    </div>
  );
}
