"use client";

import { useQuery } from "convex/react";
import { useMemo, useState } from "react";

import { api } from "@/convex/_generated/api";
import { Workbench, type Source, type UrlState } from "./Workbench";

/** Public demo recording (Singapore 2026 qualifying on the dev deployment). */
const DEMO_URL =
  process.env.NEXT_PUBLIC_WORKBENCH_DEMO_URL ??
  "https://adept-viper-806.eu-west-1.convex.cloud/api/storage/d3201158-b2f1-492e-ba12-99cad4010c00";

/**
 * /s/[sessionId]: `demo`, `local` (file picker / drop), `?src=<url>`, or a library session id.
 */
export function WorkbenchRoute({ sessionId, src, initial }: { sessionId: string; src?: string; initial: UrlState }) {
  const [file, setFile] = useState<File | null>(null);
  const isLibrary = !src && sessionId !== "demo" && sessionId !== "local";
  const session = useQuery(api.sessions.get, isLibrary ? { id: sessionId } : "skip");

  const url = session?.url;
  const source = useMemo<Source | null>(() => {
    if (file) return { kind: "file", file };
    if (src) return { kind: "url", url: src };
    if (sessionId === "demo") return { kind: "url", url: DEMO_URL };
    if (sessionId === "local") return null;
    return url ? { kind: "url", url } : null;
  }, [file, src, sessionId, url]);

  const missing =
    isLibrary && !file && session === null ? "This session was not found, or you need to sign in to open it." : undefined;
  return <Workbench source={source} initial={initial} onPickFile={setFile} missing={missing} />;
}
