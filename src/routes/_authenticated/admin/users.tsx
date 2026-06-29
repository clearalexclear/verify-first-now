import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listStaff, setUserRole } from "@/lib/admin/admin.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: UsersPage,
});

function UsersPage() {
  const fn = useServerFn(listStaff);
  const set = useServerFn(setUserRole);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["staff"], queryFn: () => fn() });
  const users = q.data ?? [];

  async function toggle(user_id: string, role: "admin" | "analyst", grant: boolean) {
    await set({ data: { user_id, role, grant } });
    qc.invalidateQueries({ queryKey: ["staff"] });
  }

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Users & roles</h1>
        <p className="text-sm text-muted-foreground">Grant the analyst or admin role to anyone with a signed-up account. Only admins can change roles.</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">All accounts ({users.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-center">Analyst</TableHead>
                <TableHead className="text-center">Admin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u: any) => (
                <TableRow key={u.id}>
                  <TableCell className="text-sm">{u.full_name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{u.email}</TableCell>
                  <TableCell className="text-center">
                    <Switch checked={u.roles.includes("analyst")} onCheckedChange={(v) => toggle(u.id, "analyst", v)} />
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch checked={u.roles.includes("admin")} onCheckedChange={(v) => toggle(u.id, "admin", v)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
