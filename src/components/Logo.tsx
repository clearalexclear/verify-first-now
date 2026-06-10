import { Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2 font-bold text-navy ${className}`}>
      <span className="grid h-8 w-8 place-items-center rounded-md bg-navy text-navy-foreground">
        <ShieldCheck className="h-5 w-5" />
      </span>
      <span className="text-lg tracking-tight">VerifyFirst</span>
    </Link>
  );
}
