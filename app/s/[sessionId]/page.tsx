import type { Metadata } from "next";
import { Suspense } from "react";

import { WorkbenchRoute } from "@/components/workbench/WorkbenchRoute";

export const metadata: Metadata = { title: "Workbench · Prisma" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function Route({ params, searchParams }: PageProps<"/s/[sessionId]">) {
  const { sessionId } = await params;
  const q = await searchParams;
  const t = Number(one(q.t));
  const theme = one(q.theme);
  return (
    <WorkbenchRoute
      sessionId={sessionId}
      src={one(q.src)}
      initial={{
        t: Number.isFinite(t) && one(q.t) !== undefined ? t : undefined,
        sel: one(q.sel),
        focus: one(q.focus),
        ref: one(q.ref),
        a: one(q.a),
        b: one(q.b),
        tab: one(q.tab),
        layout: one(q.layout),
        theme: theme === "light" || theme === "dark" ? theme : undefined,
      }}
    />
  );
}

export default function Page(props: PageProps<"/s/[sessionId]">) {
  return (
    <Suspense fallback={null}>
      <Route {...props} />
    </Suspense>
  );
}
