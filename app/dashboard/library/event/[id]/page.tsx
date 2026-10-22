"use client";

import { useQuery } from "convex/react";
import { notFound } from "next/navigation";
import { use } from "react";

import PageShell from "@/components/dashboard/page-shell";
import { api } from "@/convex/_generated/api";

export default function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const event = useQuery(api.events.get, { id });
  const sessions = useQuery(api.sessions.list, { eventId: id });

  if (event === undefined) {
    return (
      <PageShell>
        <p className="text-sm text-muted-foreground">Loading event…</p>
      </PageShell>
    );
  }
  if (!event) notFound();

  const rows = [
    {
      label: "Sessions",
      value: sessions === undefined ? event.sessions.length : sessions.length,
    },
    { label: "Start time", value: `${event.startDate} ${event.startTime}` },
  ];

  return (
    <PageShell>
      <div className="max-w-2xl overflow-hidden rounded-[2px] border border-border/60 bg-card">
        <div className="border-b border-border/60 px-4 py-3">
          <p className="text-xs text-muted-foreground">Event</p>
          <h1 className="text-lg font-medium">{event.name}</h1>
        </div>
        <dl className="divide-y divide-border/60 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex gap-4 px-4 py-2.5">
              <dt className="w-32 shrink-0 text-muted-foreground">
                {row.label}
              </dt>
              <dd className="min-w-0 truncate">{row.value}</dd>
            </div>
          ))}
          {sessions?.map((session) => (
            <div key={session.id} className="flex gap-4 px-4 py-2.5">
              <dt className="w-32 shrink-0 text-muted-foreground">
                {session.name}
              </dt>
              <dd className="min-w-0 truncate">
                {session.url ? (
                  <a
                    href={session.url}
                    className="text-brand underline-offset-4 hover:underline"
                  >
                    {session.fileName}
                  </a>
                ) : (
                  session.fileName
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </PageShell>
  );
}
