"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const ref = searchParams.get("ref");
  const from = searchParams.get("from");

  return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-stone-200 p-8 text-center">
        <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center bg-emerald-100 text-emerald-600">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-stone-800 mt-4">Payment received</h1>
        <p className="text-stone-600 mt-2">
          {from === "quote"
            ? "Thank you for your deposit. Your quote is confirmed and we will be in touch with next steps."
            : ref
              ? `Payment for ${ref} was successful. Thank you.`
              : "Your payment was successful. Thank you."}
        </p>
      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-stone-100 flex items-center justify-center">
          <div className="text-stone-500">Loading...</div>
        </div>
      }
    >
      <PaymentSuccessContent />
    </Suspense>
  );
}
