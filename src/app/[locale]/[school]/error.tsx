"use client";

import { ErrorScreen } from "@/components/layout/error-screen";

export default function ErrorPage(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen {...props} />;
}
