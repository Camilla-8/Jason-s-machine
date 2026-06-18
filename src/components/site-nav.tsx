"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const activeClass =
  "rounded-md bg-stone-900 px-3 py-1.5 font-medium text-white hover:bg-stone-800";
const inactiveClass =
  "rounded-md px-3 py-1.5 font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900";

export function SiteNav() {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith("/admin");

  return (
    <nav className="flex items-center gap-2 text-sm">
      <Link href="/" className={isAdmin ? inactiveClass : activeClass}>
        Scan Event
      </Link>
      <Link href="/admin" className={isAdmin ? activeClass : inactiveClass}>
        Admin
      </Link>
    </nav>
  );
}
