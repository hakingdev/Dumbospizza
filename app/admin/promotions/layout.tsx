"use client";

import { Suspense } from 'react';

export default function PromotionsAdminLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="p-6">Laden…</div>}>{children}</Suspense>;
}
